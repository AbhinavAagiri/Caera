import { randomUUID } from 'node:crypto';
import type {
  AiTaskCategory,
  AiUsageRecord,
  RoutingMethod,
  SpendingSummary,
} from '@shared';
import { getDatabase } from '../db/database';

interface UsageInput {
  conversationId: string | null;
  provider: AiUsageRecord['provider'];
  model: string;
  taskCategory: AiTaskCategory;
  complexity: number;
  routingMethod: RoutingMethod;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  estimatedCostUsd: number | null;
  pricingSourceUrl: string | null;
  durationMs: number;
  status: AiUsageRecord['status'];
  errorCode: string | null;
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === 'bigint' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null;
}

function mapRow(row: Record<string, unknown>): AiUsageRecord {
  return {
    id: String(row.id),
    conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    provider: String(row.provider) as AiUsageRecord['provider'],
    model: String(row.model),
    modelRef: `${String(row.provider)}/${String(row.model)}`,
    taskCategory: String(row.task_category) as AiTaskCategory,
    complexity: Number(row.complexity),
    routingMethod: String(row.routing_method) as RoutingMethod,
    inputTokens: numberOrNull(row.input_tokens),
    outputTokens: numberOrNull(row.output_tokens),
    cachedTokens: numberOrNull(row.cached_tokens),
    estimatedCostUsd: numberOrNull(row.estimated_cost_usd),
    pricingSourceUrl: typeof row.pricing_source_url === 'string' ? row.pricing_source_url : null,
    durationMs: Number(row.duration_ms),
    status: String(row.status) as AiUsageRecord['status'],
    errorCode: typeof row.error_code === 'string' ? row.error_code : null,
    createdAt: String(row.created_at),
  };
}

export function insertUsage(input: UsageInput): AiUsageRecord {
  const record: AiUsageRecord = {
    id: randomUUID(),
    modelRef: `${input.provider}/${input.model}`,
    ...input,
    createdAt: new Date().toISOString(),
  };

  getDatabase()
    .prepare(
      `INSERT INTO ai_usage (
         id, conversation_id, provider, model, task_category, complexity,
         routing_method, input_tokens, output_tokens, cached_tokens,
         estimated_cost_usd, pricing_source_url, duration_ms, status,
         error_code, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.conversationId,
      record.provider,
      record.model,
      record.taskCategory,
      record.complexity,
      record.routingMethod,
      record.inputTokens,
      record.outputTokens,
      record.cachedTokens,
      record.estimatedCostUsd,
      record.pricingSourceUrl,
      record.durationMs,
      record.status,
      record.errorCode,
      record.createdAt,
    );

  return record;
}

export function listUsage(limit = 30): AiUsageRecord[] {
  const bounded = Math.min(Math.max(limit, 1), 100);
  const rows = getDatabase()
    .prepare('SELECT * FROM ai_usage ORDER BY created_at DESC LIMIT ?')
    .all(bounded);
  return rows.map((row) => mapRow(row as Record<string, unknown>));
}

export function spendingSummary(): SpendingSummary {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  const row = getDatabase()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN estimated_cost_usd END), 0)
           AS spent_today,
         COALESCE(SUM(CASE WHEN substr(created_at, 1, 7) = ? THEN estimated_cost_usd END), 0)
           AS spent_month,
         SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN 1 ELSE 0 END) AS today_requests,
         SUM(CASE WHEN substr(created_at, 1, 7) = ? THEN 1 ELSE 0 END) AS month_requests,
         SUM(CASE WHEN substr(created_at, 1, 7) = ? AND estimated_cost_usd IS NULL
                  THEN 1 ELSE 0 END) AS unpriced_month
       FROM ai_usage
       WHERE status = 'completed'`,
    )
    .get(day, month, day, month, month) as Record<string, unknown> | undefined;

  return {
    dailyLimitUsd: null,
    monthlyLimitUsd: null,
    spentTodayUsd: Number(row?.spent_today ?? 0),
    spentThisMonthUsd: Number(row?.spent_month ?? 0),
    todayRequests: Number(row?.today_requests ?? 0),
    monthRequests: Number(row?.month_requests ?? 0),
    unpricedRequestsThisMonth: Number(row?.unpriced_month ?? 0),
  };
}
