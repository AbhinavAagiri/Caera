import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolves to `server/` both from `src/config` (tsx) and from the bundled
 * `dist/index.js` output. The marker is the server's own `src` folder.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const twoUp = path.resolve(moduleDir, '..', '..');
const serverRoot =
  existsSync(path.join(twoUp, 'src')) && existsSync(path.join(twoUp, 'package.json'))
    ? twoUp
    : path.resolve(moduleDir, '..');

function configurationError(message: string): never {
  throw new Error(`[caera] Invalid configuration: ${message}`);
}

export function normalizeHostname(value: string): string {
  return value.trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

function isLoopbackHostname(value: string): boolean {
  const hostname = normalizeHostname(value);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function parseHost(raw: string | undefined): string {
  const value = normalizeHostname(raw ?? '127.0.0.1');
  if (value === 'localhost' || value === '127.0.0.1') return '127.0.0.1';
  if (value === '::1') return '::1';
  return configurationError(
    `CAERA_HOST must be 127.0.0.1, ::1 or localhost. CAERA never binds to a public interface (received "${raw ?? ''}").`,
  );
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '' || raw.trim() === '0') return 5174;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return configurationError(`CAERA_PORT must be an integer between 1 and 65535 (received "${raw}").`);
  }
  return port;
}

function parseInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return configurationError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return configurationError(`${name} must be true or false (received "${raw}").`);
}

function parseVoiceStartMode(raw: string | undefined): 'on-demand' | 'startup' {
  const value = raw?.trim().toLowerCase();
  if (!value) return 'startup';
  if (value === 'on-demand' || value === 'demand' || value === 'lazy') return 'on-demand';
  if (value === 'startup' || value === 'boot') return 'startup';
  return configurationError(
    `VOICESTUDIO_START_MODE must be startup or on-demand (received "${raw}").`,
  );
}

function parseOrigins(raw: string | undefined, name: string): string[] {
  if (!raw?.trim()) return [];

  const origins: string[] = [];
  for (const entry of raw.split(',')) {
    const value = entry.trim();
    if (!value) continue;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return configurationError(`${name} contains an invalid origin: "${value}".`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return configurationError(`${name} only accepts http or https origins.`);
    }

    if (!isLoopbackHostname(url.hostname)) {
      return configurationError(
        `${name} only accepts loopback origins (localhost, 127.0.0.1 or ::1). Received "${value}".`,
      );
    }

    if (url.pathname !== '/' || url.search || url.hash) {
      return configurationError(`${name} entries must be origins without paths or queries: "${value}".`);
    }

    origins.push(url.origin);
  }

  return [...new Set(origins)];
}

function parseApprovedDirectories(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];

  const directories: string[] = [];
  for (const entry of raw.split(/[,;]/)) {
    const value = entry.trim();
    if (!value) continue;

    const resolved = path.resolve(value);
    try {
      if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
        console.warn(`[caera] Ignoring CAERA_APPROVED_DIRS entry (not a directory): ${resolved}`);
        continue;
      }
    } catch {
      console.warn(`[caera] Ignoring CAERA_APPROVED_DIRS entry (unreadable path): ${resolved}`);
      continue;
    }

    if (!directories.includes(resolved)) directories.push(resolved);
  }

  return directories;
}

function parseOptionalDirectory(raw: string | undefined, name: string): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const resolved = path.resolve(value);
  try {
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      console.warn(`[caera] ${name} does not point to an existing directory; connector stays unconfigured.`);
      return null;
    }
  } catch {
    console.warn(`[caera] ${name} could not be read; connector stays unconfigured.`);
    return null;
  }

  return resolved;
}

function parseOptionalLoopbackUrl(raw: string | undefined, name: string): string | null {
  const value = raw?.trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return configurationError(`${name} must be a valid URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return configurationError(`${name} must use http or https.`);
  }

  if (!isLoopbackHostname(url.hostname)) {
    return configurationError(`${name} must point to a loopback address; CAERA keeps local services local.`);
  }

  return url.toString().replace(/\/+$/, '');
}

const host = parseHost(process.env.CAERA_HOST);
const port = parsePort(process.env.CAERA_PORT ?? process.env.PORT);

const dataDir = process.env.CAERA_DATA_DIR
  ? path.resolve(process.env.CAERA_DATA_DIR)
  : path.join(serverRoot, '.data');

const clientOrigins = parseOrigins(
  process.env.CAERA_CLIENT_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173',
  'CAERA_CLIENT_ORIGINS',
);

const serverOrigins = [
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
  `http://[::1]:${port}`,
];

const systemInstruction = process.env.CAERA_SYSTEM_INSTRUCTION?.trim() || null;
if (systemInstruction && systemInstruction.length > 8000) {
  configurationError('CAERA_SYSTEM_INSTRUCTION must be 8000 characters or fewer.');
}

export const env = {
  serviceName: 'caera-local' as const,
  version: '0.1.0',
  phase: 'phase-2' as const,
  host,
  port,
  serverRoot,
  dataDir,
  databaseFile: path.join(dataDir, 'caera.db'),
  clientDist: path.resolve(serverRoot, '..', 'client', 'dist'),
  clientOrigins,
  security: {
    allowedOrigins: [...new Set([...clientOrigins, ...serverOrigins])],
    allowedHostnames: ['127.0.0.1', 'localhost', '::1'] as string[],
  },
  provider: {
    id: 'gemini' as const,
    label: 'Gemini',
    endpoint: 'https://generativelanguage.googleapis.com',
    apiKey: process.env.GEMINI_API_KEY?.trim() || null,
    model: process.env.CAERA_MODEL?.trim() || 'gemini-3.6-flash',
    systemInstruction,
    timeoutMs: parseInteger(
      process.env.CAERA_PROVIDER_TIMEOUT_MS,
      120_000,
      'CAERA_PROVIDER_TIMEOUT_MS',
      5_000,
      300_000,
    ),
    checkTimeoutMs: 15_000,
    maxOutputTokens: parseInteger(
      process.env.CAERA_MAX_OUTPUT_TOKENS,
      8_192,
      'CAERA_MAX_OUTPUT_TOKENS',
      256,
      32_768,
    ),
    contextMessages: parseInteger(
      process.env.CAERA_CONTEXT_MESSAGES,
      40,
      'CAERA_CONTEXT_MESSAGES',
      2,
      200,
    ),
    contextChars: parseInteger(
      process.env.CAERA_CONTEXT_CHARS,
      60_000,
      'CAERA_CONTEXT_CHARS',
      2_000,
      400_000,
    ),
  },
  ai: {
    checkTimeoutMs: 15_000,
    ollamaUrl:
      parseOptionalLoopbackUrl(process.env.OLLAMA_URL, 'OLLAMA_URL') ??
      'http://127.0.0.1:11434',
    environmentKeys: {
      openai: process.env.OPENAI_API_KEY?.trim() || null,
      anthropic: process.env.ANTHROPIC_API_KEY?.trim() || null,
      deepseek: process.env.DEEPSEEK_API_KEY?.trim() || null,
    },
    defaults: {
      openai: 'gpt-5.5',
      anthropic: 'claude-opus-5-5',
      deepseek: 'deepseek-flash',
    },
  },
  voice: {
    engine: 'voicestudio' as const,
    enabled: parseBoolean(process.env.VOICESTUDIO_ENABLED, false, 'VOICESTUDIO_ENABLED'),
    endpoint:
      parseOptionalLoopbackUrl(process.env.VOICESTUDIO_URL, 'VOICESTUDIO_URL') ??
      'http://localhost:3900',
    timeoutMs: parseInteger(
      process.env.VOICESTUDIO_TIMEOUT_MS,
      120_000,
      'VOICESTUDIO_TIMEOUT_MS',
      5_000,
      300_000,
    ),
    transcriptionTimeoutMs: parseInteger(
      process.env.VOICESTUDIO_TRANSCRIBE_TIMEOUT_MS,
      90_000,
      'VOICESTUDIO_TRANSCRIBE_TIMEOUT_MS',
      5_000,
      300_000,
    ),
    healthTimeoutMs: 2_500,
    discoveryTimeoutMs: 4_000,
    catalogTimeoutMs: 6_000,
    maxInputChars: 4_096,
    autoStart: parseBoolean(process.env.VOICESTUDIO_AUTO_START, true, 'VOICESTUDIO_AUTO_START'),
    startMode: parseVoiceStartMode(process.env.VOICESTUDIO_START_MODE),
    studioDir: parseOptionalDirectory(process.env.VOICESTUDIO_DIR, 'VOICESTUDIO_DIR'),
    startTimeoutMs: parseInteger(
      process.env.VOICESTUDIO_START_TIMEOUT_MS,
      120_000,
      'VOICESTUDIO_START_TIMEOUT_MS',
      5_000,
      600_000,
    ),
    stopTimeoutMs: parseInteger(
      process.env.VOICESTUDIO_STOP_TIMEOUT_MS,
      5_000,
      'VOICESTUDIO_STOP_TIMEOUT_MS',
      1_000,
      30_000,
    ),
  },
  connectors: {
    enabled: parseBoolean(process.env.CAERA_CONNECTORS_ENABLED, true, 'CAERA_CONNECTORS_ENABLED'),
    obsidianVault: parseOptionalDirectory(process.env.CAERA_OBSIDIAN_VAULT, 'CAERA_OBSIDIAN_VAULT'),
  },
  filesystem: {
    approvedDirectories: parseApprovedDirectories(process.env.CAERA_APPROVED_DIRS),
  },
  limits: {
    messageChars: parseInteger(
      process.env.CAERA_MESSAGE_MAX_CHARS,
      8000,
      'CAERA_MESSAGE_MAX_CHARS',
      100,
      100_000,
    ),
    titleChars: 80,
    requestTimeoutMs: parseInteger(
      process.env.CAERA_REQUEST_TIMEOUT_MS,
      20_000,
      'CAERA_REQUEST_TIMEOUT_MS',
      1_000,
      120_000,
    ),
    headersTimeoutMs: parseInteger(
      process.env.CAERA_HEADERS_TIMEOUT_MS,
      10_000,
      'CAERA_HEADERS_TIMEOUT_MS',
      1_000,
      60_000,
    ),
    keepAliveTimeoutMs: parseInteger(
      process.env.CAERA_KEEP_ALIVE_TIMEOUT_MS,
      5_000,
      'CAERA_KEEP_ALIVE_TIMEOUT_MS',
      500,
      60_000,
    ),
    jsonLimit: '1mb' as const,
  },
} as const;
