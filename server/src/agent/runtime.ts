interface ActiveAgentRun {
  controller: AbortController;
}

const activeRuns = new Map<string, ActiveAgentRun>();

export function claimAgentRun(runId: string): AbortController | null {
  if (activeRuns.has(runId)) return null;
  const controller = new AbortController();
  activeRuns.set(runId, { controller });
  return controller;
}

export function releaseAgentRun(runId: string): void {
  activeRuns.delete(runId);
}

export function abortAgentRun(runId: string): boolean {
  const active = activeRuns.get(runId);
  if (!active) return false;
  active.controller.abort();
  return true;
}

export function isAgentRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}
