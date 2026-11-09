import type { AiTaskCategory } from '@shared';

export interface TaskClassification {
  category: AiTaskCategory;
  complexity: 1 | 2 | 3 | 4 | 5;
  needsVision: boolean;
  needsTools: boolean;
  needsLongContext: boolean;
  estimatedInputTokens: number;
}

const COMPLEXITY: Record<AiTaskCategory, 1 | 2 | 3 | 4 | 5> = {
  simple_question: 1,
  general_conversation: 2,
  summarization: 2,
  research: 3,
  image_understanding: 3,
  tool_execution: 3,
  coding: 4,
  long_context: 4,
  planning: 4,
  complex_reasoning: 5,
};

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * Local, deterministic classification. It deliberately does not spend a model
 * call just to decide which model should receive the task.
 */
export function classifyTask(content: string): TaskClassification {
  const text = content.trim();
  const lower = text.toLowerCase();
  const bytes = Buffer.byteLength(text, 'utf8');
  const codeSignals = countMatches(lower, /```|(?:^|\s)(?:function|const|let|class|select|import|def|npm|typescript|javascript|python|react|sql)(?:\s|$)/g);
  const reasoningSignals = countMatches(lower, /trade-?off|architecture|prove|root cause|step by step|multi-step|compare.*(?:approaches|options)|why.*(?:fail|work)|analyse|analyze/g);
  const planSignals = countMatches(lower, /plan|roadmap|organize|schedule|break.*down|milestone|prioriti[sz]e/g);
  const researchSignals = countMatches(lower, /research|sources?|cite|latest|current|look up|compare|investigate|news/g);
  const summarySignals = countMatches(lower, /summari[sz]e|summary|tl;?dr|condense|key points/g);
  const toolSignals = countMatches(lower, /use (?:a )?tool|search my|find in my|calculate|open (?:the )?(?:file|note|page)|create (?:a )?(?:note|page|file)|update (?:a )?(?:note|page|file)/g);
  const imageSignals = countMatches(lower, /image|photo|screenshot|diagram|picture|chart/g);
  const simpleQuestion =
    text.length <= 280 &&
    /\?$/.test(text) &&
    codeSignals === 0 &&
    reasoningSignals === 0 &&
    planSignals === 0;

  let category: AiTaskCategory = 'general_conversation';
  if (bytes > 30_000) category = 'long_context';
  else if (imageSignals > 0) category = 'image_understanding';
  else if (codeSignals > 0) category = 'coding';
  else if (reasoningSignals > 0) category = 'complex_reasoning';
  else if (planSignals > 0) category = 'planning';
  else if (toolSignals > 0) category = 'tool_execution';
  else if (researchSignals > 0) category = 'research';
  else if (summarySignals > 0) category = 'summarization';
  else if (simpleQuestion) category = 'simple_question';

  const base = COMPLEXITY[category];
  const lengthLift = bytes > 12_000 ? 1 : 0;
  const complexity = Math.min(5, base + lengthLift) as 1 | 2 | 3 | 4 | 5;

  return {
    category,
    complexity,
    needsVision: category === 'image_understanding',
    needsTools: category === 'tool_execution',
    needsLongContext: category === 'long_context',
    // Routing uses a conservative local approximation. It is never displayed
    // or recorded as provider token usage.
    estimatedInputTokens: Math.max(1, Math.ceil(bytes / 4)),
  };
}
