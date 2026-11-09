# Gemini automatic routing fix — 2026-11-09

## Outcome

Automatic routing no longer selects Gemini 3.8 Flash by default. It uses the
verified, configurable automatic preference `gemini/gemini-3.6-flash` and
restricts automatic primary/fallback selection to curated models with verified
metadata and streaming support. A cached automatic route now resolves to 3.6
Flash in about 3.7 seconds instead of the previous 3.8 route measured at 106.2
seconds.

The fallback path was exercised with real requests: a stale 2.5 Flash model
failed with `PROVIDER_MODEL_NOT_FOUND`, and CAERA completed the same turn with
3.6 Flash. The same mechanism was exercised through the agent with
2.5 Flash → 3.5 Flash-Lite, including exactly one successful local tool call.

Automatic fallback remains opt-in (`fallbackEnabled` is currently false). The
setting is preserved because enabling it can spend additional tokens; it was
tested enabled and then restored to the user's previous value.

## Root cause

1. `server/src/ai/router.ts` assigned Gemini 3.8 Flash a hard-coded quality score
   of 88. In Balanced and Maximum modes that made it the top-ranked automatic
   model regardless of observed latency or operational reliability.
2. Discovery only established that a model appeared in Gemini's `/models`
   response with `supportedGenerationMethods: generateContent`. It did not prove
   that the model could complete a generation reliably. The discovery merge
   therefore left 3.8 listed as `available` with curated capabilities even when
   real requests timed out or returned upstream 5xx responses.
3. `CAERA_MODEL` defaulted to `gemini-3.8-flash`, and the automatic preference
   did not exist. There was no way to select a reliable automatic principal
   without turning automatic routing off and manually choosing a model.
4. Fallback was disabled by default. Its candidate pool included discovered
   models whose capabilities and prices were unknown. When enabled, it retried
   every provider error type, including deterministic auth/configuration
   failures.
5. Google's current documentation identifies Gemini 3.5 Flash as deprecated and
   automatically routed to Gemini 3.6 Flash. The earlier "3.5 Flash works"
   observation was therefore a 3.6 result. Gemini 3.6 Flash is the previous
   generation, stable production model; 3.8 Flash is the newest model but was
   operationally slow/failed in this environment.
6. Agent JSON calls relied only on prompt instructions. One 3.6 agent attempt
   returned 112 output tokens that could not be parsed as JSON, after which no
   plan or tool ran. The provider's native JSON response mode was not used.

## Files changed

- `shared/src/ai.ts` — added configurable `autoPreferredModel`.
- `server/src/ai/settings.ts` — default automatic preference is
  `gemini/gemini-3.6-flash`; old settings without the field receive that default.
- `server/src/ai/registry.ts` — added verified Gemini 3.6 Flash metadata:
  1,048,576 input tokens, 65,536 output tokens, streaming/vision/tools/JSON,
  pricing and official model/pricing sources.
- `server/src/ai/router.ts` — automatic eligibility is restricted to curated,
  verified, streaming models; verified preference selection; verified-only
  fallback; corrected no-verified-model error.
- `server/src/ai/generation.ts` — retry only retryable failures before emitted
  text; log fallback decisions; recheck budget; single stopped-attempt record;
  no fallback after abort/partial text; retain free/local-to-paid guard.
- `server/src/ai/aiService.ts` — preference validation, cleanup when a provider
  is removed, accurate primary provider status, default preference merge.
- `server/src/agent/model.ts` — sends JSON MIME type/schema for agent JSON calls.
- `server/src/providers/types.ts` — optional JSON response fields.
- `server/src/providers/geminiProvider.ts` — passes native JSON MIME/schema to
  Gemini.
- `server/src/routes/ai.ts` — accepts and persists `autoPreferredModel`.
- `server/src/config/env.ts` and `.env.example` — `CAERA_MODEL` default changed
  to `gemini-3.6-flash`.
- `client/src/components/settings/ModelUsageSection.tsx` — adds the
  "Automatic model preference" selector, displays a stale preference as ignored,
  and documents verified-only fallback behavior.

## Verified model metadata

- Gemini 3.6 Flash: `gemini-3.6-flash`, stable production model, streaming,
  vision, function calling, structured outputs, 1,048,576 input / 65,536 output,
  $0.75 / $3.75 / $0.075 list price per 1M input/output/cached input.
  Sources:
  `https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash`,
  `https://ai.google.dev/gemini-api/docs/pricing`.
- Gemini 3.8 Flash remains available for manual selection and fallback. It is
  not the automatic preference.
- Gemini 3.5 Flash was not used as a target: Google documents it as deprecated
  and aliases it to 3.6 Flash.
- Discovered-only models remain manual choices and are never automatic primary
  or fallback candidates.

## Real tests and results

| Test | Result |
| --- | --- |
| Pre-fix automatic chat | 3.8 Flash, 106,201 ms for a short reply |
| Automatic chat after fix | 3.6 Flash, 3,698 ms; usage `automatic` |
| Automatic long streaming | 3.6 Flash, 15,826 ms, 5 `assistant_delta` events |
| Manual 3.6 Flash | 2,338 ms, usage `manual` |
| Multi-turn context | `ORCHID-7319` retained across two automatic turns; 3,785 ms + 37,449 ms (first attempt: two transient 3.6 503s; fresh repeat passed) |
| Invalid model identifier | Rejected before provider request in 2 ms with `AI_MODEL_UNAVAILABLE`; no usage row |
| Listed unavailable model | 2.5 Flash returned `PROVIDER_MODEL_NOT_FOUND` in 127 ms; no silent success |
| Fallback enabled | 2.5 Flash failed, 3.6 Flash completed in 1,855 ms; two usage rows, one `manual` failure and one `fallback` completion |
| Agent tool execution | 3.5 Flash-Lite completed with exactly one `local.current_time` call |
| Agent fallback + tool | Five 2.5 Flash failures each fell back to 3.5 Flash-Lite; run completed with exactly one local tool call |
| Agent timeout | 3.8 Flash stopped at 45,001 ms; `AGENT_MODEL_FAILED`, zero tools, one `stopped` usage row |
| Configurable preference | Clearing it made the same preview select 3.8; restoring 3.6 restored 3.6 |
| Unverified preference | `gemini/gemini-3.5-flash` was rejected with HTTP 409 |
| Spending preflight | A zero limit removed the route; restoring null limits restored 3.6 |
| Provider rate limiting | Real 3.6 Flash 429 responses were observed and surfaced as `PROVIDER_RATE_LIMITED`; no crash or fabricated success |
| Typecheck | `npm run typecheck` passed for shared, server and client |
| Production build | `npm run build` passed; Vite emitted only its existing chunk-size warning |

## Failed or blocked checks

- The first multi-turn attempt failed twice with `PROVIDER_UNAVAILABLE` (3.6
  upstream 503) at 447 ms and 552 ms. A fresh identical test passed. This is
  recorded as a real transient failure, not hidden as a pass.
- Before JSON hardening, a 3.6 agent attempt returned 112 output tokens that did
  not parse as JSON, giving `AGENT_INVALID_MODEL_OUTPUT` before any plan or tool.
  Native JSON mode was added; the same path passed on 3.5 Flash-Lite.
- The final 3.6 Flash agent rerun against the new native-JSON-mode code was
  blocked by repeated provider 429 responses after the test burst. The 3.6 agent
  had completed a real `local.current_time` tool run before that quota window,
  but the new JSON mode itself was validated on 3.5 Flash-Lite rather than on 3.6.
- A real timeout test was completed against 3.8 Flash, not against 3.6. No tool
  executed and no duplicate usage record was written.
- Rate-limit fallback was not exercised because the account was already being
  rate-limited; rate-limit detection and recording were exercised.
- Only Gemini is configured in this environment. Cross-provider paid fallback
  was not exercised. The existing free/local-to-paid guard remains in place.
- Native provider function calling is not used by this agent. The agent's tools
  are constrained local tools selected through validated JSON; that path was
  tested.
- The new settings selector compiled successfully but was not visually inspected
  in a browser.
- There is no Git repository under `caera/`, so no commit was created.

## Cleanup

All temporary conversations, agent runs, AI usage rows and `.audit-*` helper
scripts used for this investigation were removed after the tests. The final
settings are Auto/balanced, automatic preference 3.6 Flash, fallback off, and no
spending limits.
