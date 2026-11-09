import type { AgentTool } from '../types';
import {
  knowledgeIndexEnabled,
  searchKnowledge,
} from '../../services/knowledgeService';

function list(value: unknown, max: number): string[] {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))].slice(0, max);
}

export const knowledgeSearchTool: AgentTool = {
  name: 'knowledge.search',
  label: 'Search the local knowledge index',
  description:
    'Search indexed, user-approved Obsidian, Notion, Logseq and Anytype content in one local request. Supports keywords, quoted phrases, source/tag/date filters and returns real excerpts with source references. Only cite results returned by this tool; if nothing is returned, say that no indexed document matched. Never invent a document, title, path or citation.',
  source: 'knowledge',
  sourceLabel: 'Local knowledge index',
  permission: 'read',
  risk: 'low',
  requiresConfirmation: false,
  timeoutMs: 20_000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: {
        type: 'string',
        description: 'Keywords or a quoted phrase. Example: "launch decision" or roadmap local-first.',
        maxLength: 300,
      },
      sources: {
        type: 'string',
        description: 'Optional comma-separated source ids, for example obsidian,notion.',
        maxLength: 300,
      },
      tags: {
        type: 'string',
        description: 'Optional comma-separated tag filter. Every listed tag must be present.',
        maxLength: 300,
      },
      updatedFrom: {
        type: 'string',
        description: 'Optional inclusive lower date bound, YYYY-MM-DD or ISO date.',
        maxLength: 40,
      },
      updatedTo: {
        type: 'string',
        description: 'Optional inclusive upper date bound, YYYY-MM-DD or ISO date.',
        maxLength: 40,
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of distinct documents to return, 1 to 20.',
        minimum: 1,
        maximum: 20,
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const result = searchKnowledge({
      query: String(args.query ?? ''),
      sources: list(args.sources, 20),
      tags: list(args.tags, 10),
      ...(typeof args.updatedFrom === 'string' ? { updatedFrom: args.updatedFrom } : {}),
      ...(typeof args.updatedTo === 'string' ? { updatedTo: args.updatedTo } : {}),
      ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
    });

    const sourceCount = new Set(result.hits.map((hit) => hit.source)).size;
    return {
      summary:
        result.hits.length === 0
          ? 'No indexed document matched in the enabled knowledge sources.'
          : `Found ${result.total} matching document${result.total === 1 ? '' : 's'} across ${sourceCount} source${sourceCount === 1 ? '' : 's'}; returning ${result.hits.length} excerpt${result.hits.length === 1 ? '' : 's'}.`,
      data: {
        query: result.query,
        total: result.total,
        truncated: result.truncated,
        retrieval: result.retrieval,
        results: result.hits.map((hit) => ({
          source: hit.source,
          sourceLabel: hit.sourceLabel,
          title: hit.title,
          documentId: hit.documentId,
          path: hit.path,
          url: hit.url,
          tags: hit.tags,
          updatedAt: hit.updatedAt,
          excerpt: hit.excerpt,
          reference: hit.reference,
        })),
      },
    };
  },
};

/**
 * The tool is absent while indexing is disabled. That keeps the model from
 * proposing a search it has no permission to run, and the permission check
 * revalidates the live setting before execution.
 */
export function listKnowledgeAgentTools(): AgentTool[] {
  return knowledgeIndexEnabled() ? [knowledgeSearchTool] : [];
}
