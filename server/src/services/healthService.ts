import type { Capability, HealthReport, MemoryStatus, VoiceStatus } from '@shared';
import { env } from '../config/env';
import { databaseStatus } from '../db/database';
import { conversationStats } from '../db/repositories/conversations';
import { listConnectedApplications } from '../db/repositories/connectors';
import { primaryProviderStatus } from '../ai/aiService';
import { memoryStatus } from './memoryService';
import { getVoiceStatus } from './voiceService';
import { getComputerSnapshot } from './computerService';
import { knowledgeSnapshot } from './knowledgeService';

const startedAt = new Date();

function voiceCapability(voice: VoiceStatus): Capability {
  const version = voice.version ? ` ${voice.version}` : '';

  const inputDetail =
    voice.transcription.state === 'ready'
      ? 'push-to-talk transcription is available'
      : 'speech recognition is not exposed by this build';

  if (voice.state === 'ready' && voice.enabled) {
    return {
      id: 'voice',
      label: 'Voice',
      state: 'available',
      detail: `VoiceStudio${version} is running locally; ${inputDetail}, and assistant replies can be spoken.`,
    };
  }

  if (voice.state === 'ready') {
    return {
      id: 'voice',
      label: 'Voice',
      state: 'unavailable',
      detail: `VoiceStudio is running and ${inputDetail}, but voice output is switched off in Settings → Voice.`,
    };
  }

  if (voice.state === 'unreachable' || voice.state === 'starting') {
    return {
      id: 'voice',
      label: 'Voice',
      state: 'unavailable',
      detail: `VoiceStudio is ${voice.state === 'starting' ? 'still starting' : 'not reachable'} at ${voice.url}. Replies stay text-only.`,
    };
  }

  if (voice.state === 'incompatible') {
    return {
      id: 'voice',
      label: 'Voice',
      state: 'unavailable',
      detail: 'VoiceStudio is running an API build CAERA cannot use. Update it in Settings → Voice.',
    };
  }

  return {
    id: 'voice',
    label: 'Voice',
    state: 'unavailable',
    detail:
      voice.state === 'error'
        ? voice.detail
        : 'VoiceStudio has not been checked yet. Replies stay text-only.',
  };
}

function capabilitiesFor(voice: VoiceStatus, memory: MemoryStatus): Capability[] {
  const connectedConnectors = listConnectedApplications().filter(
    (application) => application.status === 'connected',
  ).length;

  const computer = getComputerSnapshot().settings;
  const knowledge = knowledgeSnapshot();

  return [
    {
      id: 'model',
      label: 'Model responses',
      state: 'available',
      detail: 'Configured model providers stream through this local node. API keys stay on this machine.',
    },
    voiceCapability(voice),
    {
      id: 'memory',
      label: 'Memory',
      state: 'available',
      detail:
        memory.state === 'paused'
          ? `Memory collection is paused; ${memory.entries} approved ${memory.entries === 1 ? 'entry remains' : 'entries remain'} available.`
          : `${memory.entries} approved ${memory.entries === 1 ? 'entry' : 'entries'} stored locally. Only relevant entries are sent to the selected model provider.`,
    },
    {
      id: 'tools',
      label: 'Tool calling',
      state: 'available',
      detail:
        'The agent executes schema-validated connector, web, calculation and local utility tools with explicit confirmation for writes and deletes. It cannot run arbitrary code.',
    },
    {
      id: 'computer',
      label: 'Local computer',
      state: computer.enabled ? 'available' : 'unavailable',
      detail: !computer.enabled
        ? 'Local computer access is disabled in Tools and permissions.'
        : `${computer.applications.length} approved ${computer.applications.length === 1 ? 'application' : 'applications'} and ${computer.directories.length} approved ${computer.directories.length === 1 ? 'directory' : 'directories'}; no shell or arbitrary command execution.`,
    },
    {
      id: 'knowledge',
      label: 'Knowledge index',
      state: knowledge.settings.enabled ? 'available' : 'unavailable',
      detail: !knowledge.settings.enabled
        ? 'Cross-application indexing is disabled. No connector content is being indexed.'
        : `${knowledge.stats.documents} documents from ${knowledge.stats.sources} sources stored in local SQLite FTS5; semantic retrieval is not enabled.`,
    },
    {
      id: 'connectors',
      label: 'Connections',
      state: env.connectors.enabled ? 'available' : 'unavailable',
      detail: !env.connectors.enabled
        ? 'Connections are disabled by CAERA_CONNECTORS_ENABLED=false.'
        : connectedConnectors === 0
          ? 'No external applications are connected. Open Connections to link a local vault.'
          : `${connectedConnectors} external ${connectedConnectors === 1 ? 'application is' : 'applications are'} connected with independent permission grants.`,
    },
  ];
}

export function nodeStartedAt(): string {
  return startedAt.toISOString();
}

export async function buildHealth(): Promise<HealthReport> {
  const stats = conversationStats();
  const voice = getVoiceStatus();
  const memory = memoryStatus();

  return {
    service: 'caera-local',
    version: env.version,
    phase: 'phase-2',
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)),
    platform: `${process.platform} ${process.arch}`,
    provider: primaryProviderStatus(),
    voice,
    memory,
    database: databaseStatus(),
    storage: {
      conversations: stats.conversations,
      messages: stats.messages,
      dataDirectory: env.dataDir,
      persisted: true,
    },
    capabilities: capabilitiesFor(voice, memory),
  };
}
