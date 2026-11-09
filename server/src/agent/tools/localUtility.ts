import { AgentError } from '../errorHandling';
import type { AgentTool } from '../types';

function invalid(message: string): AgentError {
  return new AgentError('AGENT_TOOL_ARGUMENTS_INVALID', message, { status: 400 });
}

export const currentTimeTool: AgentTool = {
  name: 'local.current_time',
  label: 'Read the current date and time',
  description:
    'Return the current date, time and IANA time zone on this computer. An optional time zone can be supplied, for example Europe/Amsterdam.',
  source: 'local',
  sourceLabel: 'Local utility',
  permission: 'local',
  risk: 'low',
  requiresConfirmation: false,
  timeoutMs: 2_000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      timeZone: {
        type: 'string',
        description: 'Optional IANA time zone. Defaults to this computer zone.',
        maxLength: 64,
      },
    },
    required: [],
  },
  async execute(args) {
    const requested = typeof args.timeZone === 'string' ? args.timeZone.trim() : '';
    let zone = requested || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let formatted: string;

    try {
      formatted = new Intl.DateTimeFormat('en-CA', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: zone,
      }).format(new Date());
    } catch {
      throw invalid('That time zone is not recognized. Use an IANA name such as Europe/Amsterdam.');
    }

    if (!requested) {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }

    const now = new Date();
    return {
      summary: `Current local time: ${formatted}`,
      data: {
        formatted,
        iso: now.toISOString(),
        timeZone: zone,
        epochMs: now.getTime(),
      },
    };
  },
};

export const textStatsTool: AgentTool = {
  name: 'local.text_stats',
  label: 'Measure text',
  description:
    'Count characters, words and lines in text. It reads the supplied text only and performs no file or clipboard access.',
  source: 'local',
  sourceLabel: 'Local utility',
  permission: 'local',
  risk: 'low',
  requiresConfirmation: false,
  timeoutMs: 2_000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: {
        type: 'string',
        description: 'Text to measure. It is not stored by this tool.',
        maxLength: 20_000,
      },
    },
    required: ['text'],
  },
  async execute(args) {
    const text = String(args.text ?? '');
    const words = text.match(/\S+/g)?.length ?? 0;
    const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
    return {
      summary: `Measured ${text.length} characters, ${words} words and ${lines} lines`,
      data: {
        characters: text.length,
        words,
        lines,
        nonWhitespaceCharacters: text.replace(/\s/g, '').length,
      },
    };
  },
};
