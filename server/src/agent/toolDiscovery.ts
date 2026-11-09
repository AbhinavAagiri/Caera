import type { AgentToolCatalog, AgentToolDescriptor } from '@shared';
import { listComputerAgentTools } from './tools/computer';
import { listConnectorAgentTools } from './tools/connectors';
import { listKnowledgeAgentTools } from './tools/knowledge';
import { calculationTool } from './tools/calculation';
import { currentTimeTool, textStatsTool } from './tools/localUtility';
import { webResearchTool } from './tools/webResearch';
import { toAgentToolDescriptor, type AgentTool } from './types';

const BASE_TOOLS: AgentTool[] = [
  webResearchTool,
  calculationTool,
  currentTimeTool,
  textStatsTool,
];

/**
 * Discovery is the only source of executable agent tools. A model receives
 * descriptors; it cannot add a method, URL or shell command to the registry.
 */
export function listAgentTools(): AgentTool[] {
  const tools = [
    ...listConnectorAgentTools(),
    ...listKnowledgeAgentTools(),
    ...listComputerAgentTools(),
    ...BASE_TOOLS,
  ];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate agent tool name: ${tool.name}`);
    }
    seen.add(tool.name);
  }
  return tools;
}

export function listAgentToolDescriptors(): AgentToolDescriptor[] {
  return listAgentTools().map(toAgentToolDescriptor);
}

export function agentToolCatalog(): AgentToolCatalog {
  return {
    tools: listAgentToolDescriptors(),
    updatedAt: new Date().toISOString(),
  };
}

export function findAgentTool(name: string): AgentTool | null {
  return listAgentTools().find((tool) => tool.name === name) ?? null;
}

export function toolPromptCatalog(tools: AgentTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    permission: tool.permission,
    requiresConfirmation: tool.requiresConfirmation,
    inputSchema: tool.inputSchema,
  }));
}
