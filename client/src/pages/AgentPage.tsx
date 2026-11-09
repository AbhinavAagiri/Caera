import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  AgentRun,
  AgentRunStatus,
  AgentRunStep,
  AgentToolCatalog,
  AgentToolDescriptor,
} from '@shared';
import { MarkdownMessage } from '@/components/conversation/MarkdownMessage';
import { Icon } from '@/components/icons/Icon';
import { ModulePage } from '@/components/layout/ModulePage';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Controls';
import { Chip } from '@/components/ui/Indicators';
import { Note, Panel, PanelHeader, SectionHeading } from '@/components/ui/Panel';
import { useToast } from '@/components/ui/Toast';
import { formatRelative } from '@/lib/format';
import { api, isAbortError, toApiError } from '@/services/api';

const RUN_TONE: Record<AgentRunStatus, 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'> = {
  queued: 'accent',
  running: 'accent',
  awaiting_confirmation: 'warn',
  completed: 'ok',
  failed: 'danger',
  cancelled: 'neutral',
};

const RUN_LABEL: Record<AgentRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_confirmation: 'Awaiting approval',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STEP_TONE: Record<AgentRunStep['status'], 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'> = {
  pending: 'neutral',
  running: 'accent',
  awaiting_confirmation: 'warn',
  completed: 'ok',
  failed: 'danger',
  skipped: 'neutral',
};

const RUNNING_STATUSES: AgentRunStatus[] = ['queued', 'running'];

function prettyArguments(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return 'Arguments could not be displayed.';
  }
}

function StepCard({ step }: { step: AgentRunStep }): React.JSX.Element {
  return (
    <li className="border-t border-line px-4 py-3 first:border-t-0">
      <div className="flex items-start gap-3">
        <span className="mt-[1px] grid size-[22px] shrink-0 place-items-center rounded-full border border-line bg-base font-mono text-[9px] text-ink-3">
          {step.position}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[12.5px] font-medium text-ink">{step.title}</h4>
            <Chip tone={STEP_TONE[step.status]}>{step.status.replaceAll('_', ' ')}</Chip>
          </div>
          <p className="mt-1 text-[11.5px] leading-[1.6] text-ink-3">{step.objective}</p>
          {step.summary ? <p className="mt-1.5 text-[11.5px] text-ink-2">{step.summary}</p> : null}
          {step.error ? <p className="mt-1.5 text-[11.5px] text-danger">{step.error}</p> : null}

          {step.toolRuns.length ? (
            <div className="mt-2 space-y-2">
              {step.toolRuns.map((toolRun) => (
                <div key={toolRun.id} className="rounded-[6px] border border-line bg-base/50 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[9px] text-ink-4">{toolRun.toolName}</span>
                    <Chip
                      tone={
                        toolRun.status === 'completed'
                          ? 'ok'
                          : toolRun.status === 'failed'
                            ? 'danger'
                            : toolRun.status === 'awaiting_confirmation'
                              ? 'warn'
                              : 'neutral'
                      }
                    >
                      {toolRun.status.replaceAll('_', ' ')}
                    </Chip>
                  </div>
                  {toolRun.summary ? (
                    <p className="mt-1 text-[11px] leading-[1.5] text-ink-2">{toolRun.summary}</p>
                  ) : null}
                  {toolRun.error ? (
                    <p className="mt-1 text-[11px] leading-[1.5] text-danger">{toolRun.error}</p>
                  ) : null}
                  {toolRun.resultPreview ? (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer font-mono text-[8.5px] uppercase tracking-[0.06em] text-ink-4">
                        Inspect recorded result
                      </summary>
                      <pre className="mt-1.5 max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-[4px] border border-line bg-surface p-2 font-mono text-[9px] leading-[1.55] text-ink-3">
                        {toolRun.resultPreview}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ToolRow({ tool }: { tool: AgentToolDescriptor }): React.JSX.Element {
  return (
    <li className="flex items-start justify-between gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="truncate text-[11.5px] text-ink">{tool.label}</p>
        <p className="mt-0.5 truncate font-mono text-[8.5px] text-ink-4">{tool.name}</p>
        <p className="mt-1 text-[10.5px] leading-[1.5] text-ink-3">{tool.sourceLabel}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Chip tone={tool.permission === 'read' || tool.permission === 'network' || tool.permission === 'local' ? 'neutral' : 'warn'}>
          {tool.permission}
        </Chip>
        <span className="font-mono text-[8px] text-ink-4">
          {Math.round(tool.timeoutMs / 1_000)}s{tool.requiresConfirmation ? ' · confirm' : ''}
        </span>
      </div>
    </li>
  );
}

export function AgentPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { push } = useToast();
  const [task, setTask] = useState('');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [tools, setTools] = useState<AgentToolCatalog | null>(null);
  const [starting, setStarting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const pollFailures = useRef(0);

  const loadTools = useCallback(async (signal?: AbortSignal) => {
    try {
      setTools(await api.agentTools(signal));
      setToolError(null);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setToolError(toApiError(cause).message);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadTools(controller.signal);
    void api
      .listAgentRuns(controller.signal)
      .then((result) => {
        const latest = result.runs[0] ?? null;
        setRun((current) => current ?? latest);
      })
      .catch(() => {
        // The start form remains usable if history cannot be loaded.
      });
    return () => controller.abort();
  }, [loadTools]);

  useEffect(() => {
    if (!run || !RUNNING_STATUSES.includes(run.status)) return;

    let alive = true;
    const timer = window.setInterval(() => {
      void api
        .getAgentRun(run.id)
        .then((result) => {
          if (!alive) return;
          pollFailures.current = 0;
          setRun(result.run);
        })
        .catch((cause) => {
          if (!alive || isAbortError(cause)) return;
          pollFailures.current += 1;
          if (pollFailures.current >= 3) {
            setError('The local node stopped answering while this task was running.');
            window.clearInterval(timer);
          }
        });
    }, 900);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [run]);

  const start = async (): Promise<void> => {
    const request = task.trim();
    if (!request || starting) return;
    setStarting(true);
    setError(null);
    try {
      const result = await api.startAgentRun(request);
      setRun(result.run);
      setTask('');
      push('Agent task queued', {
        detail: 'Understanding, planning and tool execution begin on this node.',
        tone: 'success',
      });
    } catch (cause) {
      const apiError = toApiError(cause);
      setError(apiError.hint ? `${apiError.message} ${apiError.hint}` : apiError.message);
    } finally {
      setStarting(false);
    }
  };

  const decide = async (approve: boolean): Promise<void> => {
    if (!run || deciding) return;
    setDeciding(true);
    setError(null);
    try {
      const result = await api.decideAgentRun(run.id, approve);
      setRun(result.run);
      push(approve ? 'Action approved' : 'Action rejected', {
        detail: approve
          ? 'The exact approved action will run now.'
          : 'Nothing was executed and the run was cancelled.',
        tone: approve ? 'success' : 'warning',
      });
    } catch (cause) {
      const apiError = toApiError(cause);
      setError(apiError.hint ? `${apiError.message} ${apiError.hint}` : apiError.message);
    } finally {
      setDeciding(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!run) return;
    try {
      const result = await api.cancelAgentRun(run.id);
      setRun(result.run);
      push('Cancellation requested', { tone: 'warning' });
    } catch (cause) {
      const apiError = toApiError(cause);
      setError(apiError.hint ? `${apiError.message} ${apiError.hint}` : apiError.message);
    }
  };

  const active = run ? RUNNING_STATUSES.includes(run.status) || run.status === 'awaiting_confirmation' : false;
  const latestRun = run;
  const runningStep = useMemo(
    () => latestRun?.steps.find((step) => step.status === 'running' || step.status === 'awaiting_confirmation') ?? null,
    [latestRun],
  );

  return (
    <ModulePage
      kicker={
        <>
          Controlled execution <span className="slash">/</span> <span className="accent">Agent</span>
        </>
      }
      title="Agent operations"
      description="Give CAERA a multi-step task. It plans, chooses only registered tools, checks live permissions and stops for approval before any write or delete. Every result below comes from a real operation."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {run ? <Chip tone={RUN_TONE[run.status]}>{RUN_LABEL[run.status]}</Chip> : null}
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            onClick={() => {
              void loadTools();
              if (run) void api.getAgentRun(run.id).then((result) => setRun(result.run)).catch(() => undefined);
            }}
          >
            Refresh
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader
              title="New task"
              description="The agent plans before acting. Writes and deletes pause here with their exact validated arguments."
              action={<Chip tone="accent">Bounded run</Chip>}
            />
            <div className="space-y-3 px-4 py-4">
              <TextAreaField
                label="Task"
                hideLabel
                value={task}
                onChange={setTask}
                rows={4}
                maxLength={8000}
                placeholder="Example: Read my latest project note, summarize it, and calculate the remaining budget from these figures…"
                disabled={starting || active}
                hint="Up to 8,000 characters. No arbitrary code or shell command can be requested as a tool."
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[10.5px] leading-[1.55] text-ink-3">
                  {run?.limits.maxSteps ?? 5} plan steps · {run?.limits.maxToolCalls ?? 8} tool calls ·{' '}
                  {Math.round((run?.limits.maxRunMs ?? 180000) / 1000)}s active time
                </p>
                <div className="flex gap-2">
                  {active ? (
                    <Button size="sm" variant="ghost" icon="stop" onClick={() => void cancel()}>
                      Cancel task
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="primary"
                    icon="send"
                    disabled={!task.trim() || starting || active}
                    onClick={() => void start()}
                  >
                    {starting ? 'Queueing…' : 'Start task'}
                  </Button>
                </div>
              </div>
              {error ? (
                <Note tone="danger" icon={<Icon name="warning" size={13} />}>
                  {error}
                </Note>
              ) : null}
            </div>
          </Panel>

          {run?.confirmation ? (
            <Panel className="border-[color-mix(in_oklab,var(--c-warn)_36%,transparent)]">
              <PanelHeader
                title="Approval required"
                description="The agent proposed this action and stopped before running it. Inspect the exact tool and arguments."
                action={<Chip tone="warn">{run.confirmation.risk} risk</Chip>}
              />
              <div className="space-y-3 px-4 py-4">
                <div>
                  <p className="text-[13px] font-medium text-ink">{run.confirmation.toolLabel}</p>
                  <p className="mt-1 font-mono text-[9px] text-ink-4">{run.confirmation.toolName}</p>
                  <p className="mt-1.5 text-[11.5px] leading-[1.65] text-ink-3">
                    {run.confirmation.explanation}
                  </p>
                </div>
                <div>
                  <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-ink-4">
                    Exact validated arguments
                  </p>
                  <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words rounded-[5px] border border-line bg-base p-3 font-mono text-[10px] leading-[1.6] text-ink-2">
                    {prettyArguments(run.confirmation.arguments)}
                  </pre>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <p className="max-w-[52ch] text-[10.5px] leading-[1.55] text-ink-3">
                    Approval applies to this single action. Any later write or delete asks again.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" disabled={deciding} onClick={() => void decide(false)}>
                      Reject and stop
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon="check"
                      disabled={deciding}
                      onClick={() => void decide(true)}
                    >
                      {deciding ? 'Deciding…' : 'Approve exact action'}
                    </Button>
                  </div>
                </div>
              </div>
            </Panel>
          ) : null}

          {latestRun ? (
            <>
              <section>
                <SectionHeading
                  title="Plan"
                  description={runningStep ? `Current step: ${runningStep.title}` : 'All planned steps.'}
                  aside={<Chip tone={RUN_TONE[latestRun.status]}>{RUN_LABEL[latestRun.status]}</Chip>}
                />
                <Panel>
                  {latestRun.steps.length ? (
                    <ol>
                      {latestRun.steps.map((step) => (
                        <StepCard key={step.id} step={step} />
                      ))}
                    </ol>
                  ) : (
                    <p className="px-4 py-4 text-[11.5px] text-ink-3">
                      The agent is understanding the task and building a plan.
                    </p>
                  )}
                </Panel>
              </section>

              {latestRun.answer ? (
                <section>
                  <SectionHeading title="Outcome" description="Reported from recorded run evidence." />
                  <Panel>
                    <div className="px-4 py-4">
                      <MarkdownMessage content={latestRun.answer} />
                    </div>
                  </Panel>
                </section>
              ) : null}

              {latestRun.error ? (
                <Note tone="danger" icon={<Icon name="warning" size={13} />}>
                  <strong>{latestRun.error.message}</strong>
                  {latestRun.error.hint ? ` ${latestRun.error.hint}` : ''}
                </Note>
              ) : null}

              <p className="text-[10px] leading-[1.55] text-ink-4">
                Started {formatRelative(latestRun.createdAt)} · {latestRun.usage.toolCalls} tool{' '}
                {latestRun.usage.toolCalls === 1 ? 'call' : 'calls'} ·{' '}
                {Math.round(latestRun.usage.elapsedMs / 1000)}s active execution
              </p>
            </>
          ) : (
            <Panel>
              <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
                <span className="mb-3 grid size-10 place-items-center rounded-full border border-line text-ink-3">
                  <Icon name="cpu" size={17} />
                </span>
                <p className="font-serif text-[22px] leading-tight text-ink">No agent run yet</p>
                <p className="mt-1.5 max-w-[46ch] text-[11.5px] leading-[1.65] text-ink-3">
                  A task will appear here with its real plan, current step, tool calls, confirmation requests and outcome.
                </p>
              </div>
            </Panel>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader
              title="Execution guardrails"
              description="Checked by the local executor on every action."
              action={<Chip tone="ok">Enforced</Chip>}
            />
            <ul className="divide-y divide-line px-4 py-1.5 text-[11px] leading-[1.55] text-ink-3">
              <li className="py-2.5">Closed tool registry; no arbitrary code execution.</li>
              <li className="py-2.5">Connector permissions rechecked immediately before execution.</li>
              <li className="py-2.5">All connector writes and deletes require exact-action approval.</li>
              <li className="py-2.5">Per-tool timeouts, 8 tool calls, 5 steps and 180s active time.</li>
              <li className="py-2.5">Failed tools are recorded as failed and never rewritten as success.</li>
            </ul>
          </Panel>

          <Panel>
            <PanelHeader
              title="Registered tools"
              description="Only these names can be selected. Connector tools appear when their app is connected."
              action={<Chip tone="neutral">{tools?.tools.length ?? 0}</Chip>}
            />
            {toolError ? (
              <div className="px-3.5 py-3">
                <Note tone="danger">{toolError}</Note>
              </div>
            ) : tools && tools.tools.length > 0 ? (
              <ul className="max-h-[400px] overflow-y-auto">
                {tools.tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </ul>
            ) : (
              <p className="px-3.5 py-3 text-[11px] text-ink-3">Loading the closed tool catalog…</p>
            )}
          </Panel>

          <Note icon={<Icon name="shield" size={13} />}>
            This runtime cannot run PowerShell, JavaScript or arbitrary file operations. Those surfaces remain separate and unimplemented.
          </Note>
          <Button size="sm" variant="secondary" icon="tools" onClick={() => navigate('/tools')}>
            Review permissions
          </Button>
        </aside>
      </div>
    </ModulePage>
  );
}
