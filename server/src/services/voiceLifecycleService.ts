import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { IsoTimestamp, VoiceConfiguration, VoiceLifecycle } from '@shared';
import { env } from '../config/env';
import { logger } from './logger';
import { probeHealth, VoiceClientError } from '../voice/voiceStudioClient';

const READY_POLL_MS = 400;
const FAILURE_THROTTLE_MS = 10_000;
const OUTPUT_LINE_CHARS = 300;
const OUTPUT_LINES = 8;
const COMMAND_MAX_ARGS = 32;
const COMMAND_MAX_CHARS = 2_048;
const EXTERNAL_STARTING_GRACE_MS = 30_000;

const SOURCE_MARKERS = ['backend/main.py', 'scripts/dev-backend.mjs', 'package.json'];

type StartSource = 'boot' | 'demand' | 'manual';
type LauncherKind = 'source-checkout' | 'command';

interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  launcher: LauncherKind;
  label: string;
}

interface LaunchResolution {
  plan: LaunchPlan | null;
  error: string | null;
}

interface ManagedProcess {
  child: ChildProcess;
  pid: number;
  startedAt: IsoTimestamp;
  launcher: LauncherKind;
  output: string[];
  stopping: boolean;
  exited: boolean;
  /** Set only when CAERA itself decided the start failed. */
  failureReason: string | null;
}

export interface StopVoiceStudioResult {
  stopped: boolean;
  pid: number | null;
  message: string | null;
}

let managed: ManagedProcess | null = null;
let startPromise: Promise<boolean> | null = null;
let lastError: string | null = null;
let lastFailureAt = 0;
let externalStartingUntil = 0;
let shuttingDown = false;

function isDirectory(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function parseLaunchCommand(raw: string | undefined): { argv: string[] } | { error: string } | null {
  const text = raw?.trim();
  if (!text) return null;

  let argv: unknown;
  if (text.startsWith('[')) {
    try {
      argv = JSON.parse(text);
    } catch {
      return { error: 'VOICESTUDIO_LAUNCH_CMD starts with [ but is not valid JSON.' };
    }
  } else {
    argv = text.split(/\s+/);
  }

  if (!Array.isArray(argv) || argv.length === 0) {
    return { error: 'VOICESTUDIO_LAUNCH_CMD must contain an executable.' };
  }
  if (!argv.every((entry): entry is string => typeof entry === 'string' && entry.length > 0)) {
    return { error: 'VOICESTUDIO_LAUNCH_CMD must contain only non-empty strings.' };
  }
  if (argv.length > COMMAND_MAX_ARGS) {
    return { error: 'VOICESTUDIO_LAUNCH_CMD has too many arguments.' };
  }
  if (argv.join(' ').length > COMMAND_MAX_CHARS) {
    return { error: 'VOICESTUDIO_LAUNCH_CMD is too long.' };
  }

  return { argv };
}

function resolveCommandCwd(config: VoiceConfiguration): { cwd: string | null; error: string | null } {
  const raw = process.env.VOICESTUDIO_LAUNCH_CWD?.trim() || config.voiceStudioDir || env.serverRoot;
  const candidate = path.resolve(raw);
  if (!isDirectory(candidate)) {
    return { cwd: null, error: `The VoiceStudio launch folder does not exist: ${candidate}.` };
  }
  return { cwd: candidate, error: null };
}

/**
 * A launch plan is only produced from a documented headless entrypoint:
 * `bun run dev:api` in a prepared source checkout, or an explicit command
 * supplied by the operator. The desktop app has no documented headless flag,
 * so CAERA never opens its GUI as a side effect of starting the service.
 */
export function resolveLaunchPlan(config: VoiceConfiguration): LaunchResolution {
  const override = parseLaunchCommand(process.env.VOICESTUDIO_LAUNCH_CMD);
  if (override && 'error' in override) {
    return { plan: null, error: override.error };
  }
  if (override) {
    const cwd = resolveCommandCwd(config);
    if (!cwd.cwd) return { plan: null, error: cwd.error };

    return {
      plan: {
        command: override.argv[0]!,
        args: override.argv.slice(1),
        cwd: cwd.cwd,
        launcher: 'command',
        label: 'configured headless command',
      },
      error: null,
    };
  }

  const sourceDir = config.voiceStudioDir ?? env.voice.studioDir;
  if (!sourceDir) {
    return {
      plan: null,
      error:
        'No VoiceStudio headless launcher is configured. Choose a VoiceStudio source checkout folder, or set VOICESTUDIO_LAUNCH_CMD for another documented headless setup.',
    };
  }

  const resolved = path.resolve(sourceDir);
  if (!isDirectory(resolved)) {
    return { plan: null, error: `The VoiceStudio source folder does not exist: ${resolved}.` };
  }

  const missing = SOURCE_MARKERS.filter((marker) => !existsSync(path.join(resolved, marker)));
  if (missing.length > 0) {
    return {
      plan: null,
      error: `The configured folder is not a VoiceStudio source checkout (missing ${missing.join(', ')}).`,
    };
  }

  const python =
    process.platform === 'win32'
      ? path.join(resolved, '.venv', 'Scripts', 'python.exe')
      : path.join(resolved, '.venv', 'bin', 'python');
  if (!existsSync(python)) {
    return {
      plan: null,
      error:
        'The VoiceStudio source checkout has no prepared Python environment. Run "bun run setup:api" in that folder once, then start the service.',
    };
  }

  return {
    plan: {
      command: 'bun',
      args: ['run', 'dev:api'],
      cwd: resolved,
      launcher: 'source-checkout',
      label: 'VoiceStudio source checkout',
    },
    error: null,
  };
}

function portFor(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === 'https:' ? 443 : 80;
}

function bindHostFor(url: string): string {
  const hostname = new URL(url).hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (hostname === '::1') return '::1';
  return '127.0.0.1';
}

function childEnvironment(config: VoiceConfiguration): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OMNIVOICE_PORT: String(portFor(config.url)),
    OMNIVOICE_BIND_HOST: bindHostFor(config.url),
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
  };

  // The desktop shell uses stdin as a liveness channel. CAERA is not that
  // shell, so a backend must not inherit a stale containment flag.
  delete childEnv.OMNIVOICE_DESKTOP_CONTAINED;
  // A speech backend has no reason to see CAERA's provider credential.
  delete childEnv.GEMINI_API_KEY;
  return childEnv;
}

function appendOutput(record: ManagedProcess, chunk: Buffer | string): void {
  const clean = String(chunk)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[^\S\r\n]+/g, ' ');
  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim().slice(0, OUTPUT_LINE_CHARS);
    if (line) record.output.push(line);
  }
  if (record.output.length > OUTPUT_LINES) {
    record.output.splice(0, record.output.length - OUTPUT_LINES);
  }
}

function outputTail(record: ManagedProcess): string {
  return record.output.slice(-3).join(' | ').slice(0, 900);
}

function taskkillExecutable(): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  return path.join(root, 'System32', 'taskkill.exe');
}

/** Kills only the process tree identified by this record's child PID. */
function killTree(record: ManagedProcess): void {
  if (record.exited || !record.child.pid) return;

  if (process.platform === 'win32') {
    try {
      const result = spawnSync(
        taskkillExecutable(),
        ['/PID', String(record.child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', timeout: 5_000 },
      );
      if (!result.error && result.status === 0) return;
    } catch {
      // Fall through to ChildProcess.kill for environments without taskkill.
    }
    try {
      record.child.kill();
    } catch {
      // Best effort; the process may already be gone.
    }
    return;
  }

  try {
    process.kill(-record.child.pid, 'SIGTERM');
  } catch {
    try {
      record.child.kill('SIGTERM');
    } catch {
      // Best effort; the process may already be gone.
    }
  }
}

function waitForExit(record: ManagedProcess, timeoutMs: number): Promise<boolean> {
  if (record.exited) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    record.child.once('exit', () => finish(true));
  });
}

async function waitForReady(
  config: VoiceConfiguration,
  record: ManagedProcess,
): Promise<boolean> {
  const deadline = Date.now() + env.voice.startTimeoutMs;

  while (!shuttingDown && !record.exited && Date.now() < deadline) {
    try {
      await probeHealth(config.url);
      return true;
    } catch {
      // Not ready yet, or still loading a model. The deadline is authoritative.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  return false;
}

function lifecycleDetail(
  config: VoiceConfiguration,
  phase: VoiceLifecycle['phase'],
  plan: LaunchPlan | null,
  resolutionError: string | null,
  current: ManagedProcess | null,
): string {
  if (phase === 'managed') {
    return 'VoiceStudio is running under CAERA supervision. CAERA will stop this process when it exits.';
  }
  if (phase === 'external') {
    return 'VoiceStudio is running independently. CAERA did not start it and will leave it running when CAERA exits.';
  }
  if (phase === 'starting') {
    return current
      ? `Starting VoiceStudio with ${plan?.label ?? 'the configured launcher'}…`
      : 'VoiceStudio is already starting outside CAERA.';
  }
  if (phase === 'failed') {
    return lastError ?? 'VoiceStudio could not be started.';
  }
  if (phase === 'unavailable') {
    return resolutionError ?? 'No supported VoiceStudio headless launcher is configured.';
  }

  const auto =
    config.autoStart && config.startMode === 'startup'
      ? 'CAERA will start it with the app.'
      : config.autoStart
        ? 'CAERA will start it when voice is used.'
        : 'Automatic startup is off.';
  return `VoiceStudio is not running. ${auto}`;
}

/** Cheap synchronous description of lifecycle state for status responses. */
export function getVoiceLifecycle(
  config: VoiceConfiguration,
  reachable: boolean,
): VoiceLifecycle {
  const resolution = resolveLaunchPlan(config);
  const current = managed;

  if (reachable) {
    lastError = null;
    lastFailureAt = 0;
    externalStartingUntil = 0;
  }

  let phase: VoiceLifecycle['phase'];
  if (reachable) {
    phase = current ? 'managed' : 'external';
  } else if (startPromise || current) {
    phase = 'starting';
  } else if (externalStartingUntil > Date.now()) {
    phase = 'starting';
  } else if (!resolution.plan) {
    phase = 'unavailable';
  } else if (lastError) {
    phase = 'failed';
  } else {
    phase = 'stopped';
  }

  return {
    phase,
    autoStart: config.autoStart,
    startMode: config.startMode,
    managed: phase === 'managed',
    pid: current?.pid ?? null,
    launcher: resolution.plan?.launcher ?? null,
    detail: lifecycleDetail(config, phase, resolution.plan, resolution.error, current),
    lastError,
    startedAt: current?.startedAt ?? null,
    canStart:
      Boolean(resolution.plan) &&
      phase !== 'managed' &&
      phase !== 'external' &&
      phase !== 'starting',
    // A managed process can be stopped even while it is still loading. An
    // external process never appears here, so its Stop control stays disabled.
    canStop: Boolean(current) && !current?.stopping,
  };
}

async function runStart(config: VoiceConfiguration, source: StartSource): Promise<boolean> {
  if (shuttingDown) return false;
  if (source === 'boot' && (!config.autoStart || config.startMode !== 'startup')) return false;
  if (source === 'demand' && !config.autoStart) return false;

  // Never spawn over a process that is already answering. 503 from /health is
  // an existing service that is still loading, not an absent one.
  try {
    await probeHealth(config.url);
    lastError = null;
    externalStartingUntil = 0;
    return true;
  } catch (cause) {
    if (cause instanceof VoiceClientError) {
      if (cause.code === 'VOICE_UNAVAILABLE') {
        externalStartingUntil = Date.now() + EXTERNAL_STARTING_GRACE_MS;
        return false;
      }
      if (cause.code !== 'VOICE_UNREACHABLE' && cause.code !== 'VOICE_TIMEOUT') {
        return false;
      }
    }
  }

  if (source !== 'manual' && lastError && Date.now() - lastFailureAt < FAILURE_THROTTLE_MS) {
    return false;
  }

  const resolution = resolveLaunchPlan(config);
  if (!resolution.plan) {
    lastError = resolution.error ?? 'No supported VoiceStudio launcher is configured.';
    lastFailureAt = Date.now();
    return false;
  }

  const plan = resolution.plan;
  const startedAt = new Date().toISOString();
  let child: ChildProcess;
  try {
    child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: childEnvironment(config),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    lastError = `Could not start VoiceStudio with ${plan.label}: ${
      cause instanceof Error ? cause.message : String(cause)
    }`;
    lastFailureAt = Date.now();
    return false;
  }

  if (!child.pid) {
    lastError = `Could not start VoiceStudio with ${plan.label}: the process did not start.`;
    lastFailureAt = Date.now();
    return false;
  }

  const record: ManagedProcess = {
    child,
    pid: child.pid,
    startedAt,
    launcher: plan.launcher,
    output: [],
    stopping: false,
    exited: false,
    failureReason: null,
  };
  managed = record;
  lastError = null;
  externalStartingUntil = 0;

  child.stdout?.on('data', (chunk: Buffer) => appendOutput(record, chunk));
  child.stderr?.on('data', (chunk: Buffer) => appendOutput(record, chunk));

  child.once('error', (cause) => {
    if (managed !== record) return;
    record.exited = true;
    managed = null;
    if (record.stopping) return;
    record.failureReason = `VoiceStudio failed to start: ${cause.message}`;
    lastError = record.failureReason;
    lastFailureAt = Date.now();
    logger.warn('voice_lifecycle_spawn_error', { launcher: plan.launcher });
  });

  child.once('exit', (code, signal) => {
    record.exited = true;
    if (managed === record) managed = null;
    if (record.stopping || record.failureReason) return;

    const why = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    const tail = outputTail(record);
    record.failureReason = `VoiceStudio exited unexpectedly (${why})${tail ? `: ${tail}` : '.'}`;
    lastError = record.failureReason;
    lastFailureAt = Date.now();
    logger.warn('voice_lifecycle_exited', { launcher: plan.launcher, code, signal });
  });

  logger.info('voice_lifecycle_starting', {
    pid: record.pid,
    launcher: plan.launcher,
    source,
  });

  const ready = await waitForReady(config, record);
  if (ready) {
    logger.info('voice_lifecycle_ready', { pid: record.pid, launcher: plan.launcher });
    return true;
  }

  if (record.stopping) {
    // A manual stop or node shutdown interrupted startup. Preserve the reason
    // set by that path, and do not turn it into an unexpected-exit error.
    if (record.failureReason) {
      lastError = record.failureReason;
      lastFailureAt = Date.now();
    }
    if (managed === record) managed = null;
    return false;
  }

  if (managed === record && !record.exited) {
    const tail = outputTail(record);
    record.failureReason = `VoiceStudio did not answer its health endpoint within ${Math.round(
      env.voice.startTimeoutMs / 1000,
    )} seconds${tail ? `: ${tail}` : '.'}`;
    lastError = record.failureReason;
    lastFailureAt = Date.now();
    record.stopping = true;
    killTree(record);
    await waitForExit(record, env.voice.stopTimeoutMs);
    if (managed === record) managed = null;
  } else if (!lastError) {
    lastError = 'VoiceStudio exited before it became ready.';
    lastFailureAt = Date.now();
  }

  logger.warn('voice_lifecycle_start_failed', {
    launcher: plan.launcher,
    reason: lastError,
  });
  return false;
}

/**
 * Starts the headless service if needed. Concurrent callers share one attempt;
 * the returned promise resolves true only when /health answers.
 */
export function beginVoiceStudioStart(
  config: VoiceConfiguration,
  source: StartSource,
): Promise<boolean> {
  if (shuttingDown) return Promise.resolve(false);

  if (managed && !managed.exited) {
    if (managed.stopping) return Promise.resolve(false);
    return waitForReady(config, managed);
  }

  if (startPromise) return startPromise;

  const run = runStart(config, source).finally(() => {
    if (startPromise === run) startPromise = null;
  });
  startPromise = run;
  return run;
}

/** Stops only a process CAERA spawned. External services are never touched. */
export async function stopManagedVoiceStudio(): Promise<StopVoiceStudioResult> {
  const current = managed;
  if (!current) {
    return {
      stopped: false,
      pid: null,
      message:
        'CAERA is not managing a VoiceStudio process. A service that was already running is left untouched.',
    };
  }

  current.stopping = true;
  killTree(current);
  let exited = await waitForExit(current, env.voice.stopTimeoutMs);

  if (!exited && !current.exited) {
    try {
      current.child.kill('SIGKILL');
    } catch {
      // The stop result below reports the failure.
    }
    exited = await waitForExit(current, 1_500);
  }

  if (!exited) {
    current.stopping = false;
    lastError = `CAERA could not stop the VoiceStudio process it started (PID ${current.pid}).`;
    lastFailureAt = Date.now();
    return { stopped: false, pid: current.pid, message: lastError };
  }

  if (managed === current) managed = null;
  lastError = null;
  lastFailureAt = 0;
  externalStartingUntil = 0;
  logger.info('voice_lifecycle_stopped', { pid: current.pid });
  return { stopped: true, pid: current.pid, message: null };
}

/**
 * Synchronous shutdown hook. Only the tracked child tree is terminated; a
 * pre-existing VoiceStudio process is never discovered or killed.
 */
export function shutdownVoiceStudio(): void {
  shuttingDown = true;
  const current = managed;
  if (!current || current.exited) {
    managed = null;
    return;
  }

  current.stopping = true;
  killTree(current);
  managed = null;
}
