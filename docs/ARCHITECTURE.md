# Architecture

CAERA is two local processes, one typed contract and one local SQLite database.

```
React client (Vite, :5173)
   │  typed fetch + EventSource, proxied /api
   ▼
Express node (:5174, loopback only)
   ├── security gate ── host, origin, local peer, timeouts
   ├── routes ── services ── repositories ── node:sqlite (server/.data/caera.db)
   ├── migrations + one-time JSON import
   ├── activity bus ── SSE /api/events
   └── AI router + provider adapters ── selected provider over HTTPS/loopback
```

`shared/src` holds type-only modules. Both sides import them with `import type`, so the contract is
one source of truth with no runtime package to build or resolve. The client reaches it through the
`@shared` alias; the server through a `tsconfig` path.

## Why this split

- The browser never holds provider keys or filesystem access. The node owns every privileged
  operation, which is where the permission gate lives.
- Conversations survive a browser reset because the node persists them in SQLite.
- The activity stream is real transport, not client-side theatre. Future tool and provider events
  publish through the same channel without changing the panel.
- The node is a plain Express app. It runs as a normal local process on Windows, not a serverless
  runtime, and can later be wrapped by a desktop shell without rewriting the backend.
- SQLite gives the local node transactions, constraints and a migration path without a database
  service. The `node:sqlite` module avoids a native dependency build on Windows.

## Local API

All responses use one envelope: `{ ok: true, data }` or `{ ok: false, error: { code, message, hint? } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Version, uptime, provider/voice/memory state, database schema, storage counts, capabilities |
| GET | `/api/health/meta` | Node identity, bind address, data folder, database file and schema version |
| GET | `/api/conversations?q=` | History summaries, optional title/content filter |
| POST | `/api/conversations` | Create; an optional `firstMessage` stores the user turn only |
| DELETE | `/api/conversations` | Clear all conversations |
| GET | `/api/conversations/:id` | Full conversation |
| PATCH | `/api/conversations/:id` | Rename |
| DELETE | `/api/conversations/:id` | Delete one |
| POST | `/api/conversations/:id/messages` | Legacy JSON append; stores a user turn without generating |
| POST | `/api/conversations/:id/turns` | Store the user turn and stream one routed model reply; accepts `mode` and `model` |
| GET | `/api/memory?q=&kind=` | Approved memories, optional content/subject/reason filter |
| POST | `/api/memory` | Create an approved memory, optionally with verified message provenance |
| GET | `/api/memory/settings` | Pause state and active entry count |
| PUT | `/api/memory/settings` | Pause or resume new approved entries |
| PATCH | `/api/memory/:id` | Edit kind, content, subject, reason or relations |
| DELETE | `/api/memory/:id` | Delete one approved memory |
| DELETE | `/api/memory` | Clear the approved memory store |
| GET | `/api/connectors` | Catalog, connection status, grants and registered connector tools |
| POST | `/api/connectors/:id/connect` | Validate configuration and save a connection; grants start read-only |
| POST | `/api/connectors/:id/test` | Re-check a configured application and update health |
| PUT | `/api/connectors/:id/permissions` | Replace independent grants; new write access needs explicit confirmation |
| GET | `/api/connectors/:id/directories?path=` | Folder-only listing for the local vault picker |
| POST | `/api/connectors/:id/draft` | Build a note path/content preview without writing |
| DELETE | `/api/connectors/:id` | Disconnect and remove stored configuration and grants |
| GET | `/api/connectors/tools` | Structured tool definitions for connected adapters only |
| POST | `/api/connectors/tools/:toolId/execute` | Validate arguments, check grants and execute one registered operation |
| GET | `/api/agent/tools` | Closed agent tool catalog with schemas, permissions and timeouts |
| GET | `/api/agent/runs` | Recent persisted agent runs |
| POST | `/api/agent/runs` | Validate a task and queue a background run |
| GET | `/api/agent/runs/:id` | Poll a run, its plan, evidence and pending confirmation |
| POST | `/api/agent/runs/:id/decision` | Approve or reject the exact pending action |
| POST | `/api/agent/runs/:id/cancel` | Abort an active run or cancel a pending one |
| GET | `/api/knowledge` | Knowledge settings, source status, index counts and retrieval capabilities |
| PUT | `/api/knowledge/settings` | Save opt-in source rules and exclusions |
| POST | `/api/knowledge/sync` | Incrementally sync selected or enabled connected sources |
| POST | `/api/knowledge/search` | FTS5 keyword/phrase search with source, tag and date filters |
| DELETE | `/api/knowledge` | Clear all indexed content or one source |
| GET | `/api/computer` | Computer settings, closed operation catalog and recent action log |
| PUT | `/api/computer/settings` | Validate and save approved apps, roots, operations and confirmation policy |
| GET | `/api/computer/directories?path=` | Folder-only picker for approved directories |
| POST | `/api/computer/operations/preview` | Validate one operation and return its exact proposed action |
| POST | `/api/computer/operations` | Execute one operation; consequential calls need `confirmed: true` |
| GET | `/api/ai` | Providers, verified models, routing settings, spending, usage, instruction and limits |
| PUT | `/api/ai/settings` | Save mode, default model, preferences, exclusions, fallback and confirmed spending limits |
| PUT | `/api/ai/providers/:id/credential` | Save one provider credential or loopback Ollama endpoint and discover models |
| DELETE | `/api/ai/providers/:id/credential` | Remove one saved credential, its models and a default bound to it |
| POST | `/api/ai/providers/:id/test` | Re-run discovery as a connection test; sends no prompt |
| POST | `/api/ai/route/preview` | Classify a turn and show the route without calling a provider |
| GET | `/api/provider` | Legacy compatibility status; primary provider is derived from the AI registry |
| GET | `/api/provider/config` | Shared system instruction and legacy Gemini configuration, never a key |
| PUT | `/api/provider/config` | Save the shared instruction or legacy Gemini key/model |
| DELETE | `/api/provider/key` | Remove the saved legacy Gemini key and fall back to the environment |
| POST | `/api/provider/check` | Legacy Gemini model lookup; sends no prompt |
| GET | `/api/permissions` | Tool catalog with stored levels |
| PUT | `/api/permissions/:toolId` | Set `allow`, `ask` or `block` |
| GET | `/api/events` | SSE: `hello` replay followed by `activity` events, 20s heartbeat |

Unknown `/api` routes return the error envelope with `NOT_FOUND`, never the SPA shell. Foreign
origins, non-loopback hosts and non-local peers are rejected before routing with
`403 FORBIDDEN_ORIGIN`.

### Streaming turns

`POST /api/conversations/:id/turns` is a POST response framed as server-sent events, because
`EventSource` cannot send a JSON prompt or abort upstream work. The node stores the user message,
classifies it, selects one configured model, then sends `turn_started`, zero or more
`assistant_delta` events, and finally `assistant_done` or `turn_error`. It sends a comment heartbeat
every 15 seconds. The client parses frames with `fetch` and `ReadableStream`; the fetch `AbortSignal`
is the Stop button. The node listens for the response closing, aborts the single provider request,
and keeps any partial assistant text in SQLite. A provider timeout produces a persisted error
notice and `turn_error`. Fallback is attempted only before the first text delta, so a reply is never
a splice of two models.

## Storage

`server/src/db/database.ts` owns one synchronous SQLite connection for the node. It enables WAL,
foreign keys, a 5-second busy timeout, normal synchronous writes and `secure_delete`, then runs
ordered migrations before the server listens.

Tables:

| Table | Purpose |
| --- | --- |
| `schema_migrations` | Applied migration ids and timestamps |
| `conversations` | Conversation identity, title and timestamps |
| `messages` | Ordered turns with role, kind, markdown content and optional notice JSON |
| `tool_permissions` | Per-tool `allow`/`ask`/`block` levels |
| `user_settings` | JSON-valued local settings, including the legacy import marker |
| `memory_entries` | User-approved facts with kind, subject, reason, local source excerpt and usage counts |
| `memory_links` | Directed, one-hop relations between approved entries |
| `memory_settings` | Singleton pause flag for new entries |
| `connected_applications` | Connector status, scopes, non-secret per-adapter configuration (Obsidian vault policy, Notion API version, Logseq endpoint/graph, Anytype endpoint/space/type), server-only credential JSON and health timestamps |
| `connector_permissions` | Per-connector, per-scope grants enforced before every tool execution |
| `tool_executions` | Audit trail of connector operation ids, status and result summaries, never note content or paths |
| `agent_runs` | Persisted agent task, plan steps, tool evidence, pending exact action, bounded answer/error and usage counters |
| `computer_settings` | Singleton JSON policy for local computer access: operation enablement/confirmation, approved applications and approved directories |
| `knowledge_settings` | Global opt-in switch and per-source indexing/exclusion rules |
| `knowledge_documents` | Authorized document metadata, source timestamp, fingerprint and content hash |
| `knowledge_document_tags` | Normalized tag filter rows |
| `knowledge_chunks` | Bounded searchable chunks with stable ids for future embeddings |
| `knowledge_fts` | FTS5 virtual table over title, tags and chunk content |
| `knowledge_sync_state` | Per-source attempt/success/error and incremental scan counters |
| `knowledge_embeddings` | Reserved vector table; not populated by keyword indexing |
| `ai_usage` | Per-request provider/model, task category, complexity, routing method, provider-reported tokens, estimated list-price cost, duration and status; indexed by time/model |

Repositories in `server/src/db/repositories/` are the only code that issues SQL. They use prepared
statements with bound parameters; no query is assembled from user input. Conversation create and
message append run inside `BEGIN IMMEDIATE`/`COMMIT` transactions.

CAERA remains single-user. If it later supports multiple local profiles, each profile gets its own
database file and every query is scoped by the server-side profile — never by a client-supplied id.

### Migrations

Schema changes are ordered entries in `server/src/db/migrations.ts`. `runMigrations()` records each
id in `schema_migrations` inside the same transaction as its schema change. Startup and
`npm run db:migrate` call the same runner. Applied migrations are immutable; a schema change is a new
migration id. A failed migration rolls back and stops startup rather than serving a half-migrated
database.

### Legacy JSON import

The Phase 1 store at `server/.data/store.json` is imported once after migrations when the
conversations table is empty. Conversations, messages, notices and permission levels are validated,
written through the repositories, and marked in `user_settings` (`migrations.store_json_v1`). The
original file is left in place. Only aggregate counts are logged; titles and message contents never
reach the terminal.

## Security boundary

`server/src/config/env.ts` validates the environment at import time and refuses to start on invalid
settings. Notable rules:

- `CAERA_HOST` accepts only `127.0.0.1`, `::1` or `localhost`. The node never binds publicly.
- Client origins must be loopback origins without paths. The node's own origin is added
  automatically, so the built client works same-origin while Vite works through its proxy.
- `server/src/middleware/security.ts` checks the `Host` header (DNS-rebinding defense), the socket
  peer address and the `Origin` header (CORS plus explicit rejection), then sets baseline security
  headers and `Cache-Control: no-store` on API responses.
- `server/src/middleware/timeout.ts` returns a `REQUEST_TIMEOUT` envelope if a handler exceeds its
  budget. The activity SSE route and streaming turn route are exempt; turns use
  `CAERA_PROVIDER_TIMEOUT_MS` and also pass the timeout to the SDK. JSON bodies are capped at 1 MB.
- Request logs contain method, sanitized path, status and duration. Query strings, bodies, headers,
  provider keys and message content are not logged.
- A key saved in Settings is written by the node to `server/.data/provider.json` with owner-only
  permissions where the OS supports them. The API returns only `hasStoredKey`/`keySource`; the key
  is never returned, logged or written to browser storage.
- There is no arbitrary filesystem, shell, application-launch or screen-capture endpoint. The only
  process CAERA can launch is its configured VoiceStudio headless launcher; the source folder must
  contain the expected VoiceStudio files. The connector surface is adapter-scoped: Obsidian accepts
  only Markdown within the connected vault, rejects traversal and reserved folders, and checks real
  paths before reads or writes. Local computer operations use only approved `.exe` paths and real
  roots, with no shell or argument injection. Notion is fixed to `https://api.notion.com` over HTTPS and only sees
  resources shared with the integration. Logseq and Anytype addresses are validated as loopback
  origins before their tokens are used. `CAERA_APPROVED_DIRS` is not consulted by the current local
  computer layer; only directories explicitly approved in Tools are roots.
- Connector HTTP calls use a bounded timeout, paced requests and safe retry behavior. Notion cursor
  pagination and data-source pagination are capped; Logseq and Anytype calls never leave loopback.
  429 responses wait for `Retry-After` where provided and retry a bounded number of times. Error
  messages omit credentials and body content.
- Connector configuration and credentials are written by the node. Connector management
  responses expose only non-secret configuration and `hasCredentials`; secret JSON never leaves the
  server. Every
  connection has independent grants, defaults to read-only, and destructive operations require a
  separate per-call confirmation in addition to their grant.

## Conversation semantics

The node stores the user turn before contacting a provider, so the transcript is real even if the
request fails. With a configured key, the assistant turn streams in and is persisted only after it
completes. Stopping the request preserves the partial assistant text. If no key is configured, or
the provider rejects the request, the node appends a **system notice** that states what happened,
whether a provider was attempted, and the safe next step. Notices are markdown and can carry
client-resolved actions such as opening provider settings. The model never authors a notice, and
the node never fabricates a successful assistant reply.

Context is bounded by `CAERA_CONTEXT_MESSAGES` and `CAERA_CONTEXT_CHARS`, excludes notices, drops a
leading assistant message, and always ends with the current user turn. The node does not retry a
generation automatically.

## Activity stream and WebSockets

`server/src/services/eventBus.ts` keeps the last 120 real events. SSE clients receive recent history
on connect and live events afterwards. The node publishes only things that happened: node start,
conversation create/rename/delete, message stored, reply streaming/completed/stopped/failed,
provider configuration/check, voice checks/settings/speech/transcription, approved memory
create/edit/delete/clear/pause and recall selection, connector connect/check/disconnect/permission
changes, connector tool results, agent start/plan/step/tool/confirmation/finish events, and computer
tool permission changes. The client adds its own
transport events (`source: "client"`) for stream connected/disconnected.

No WebSocket server is included. The only live requirement today is server→client activity, which
SSE already provides with automatic reconnect and a heartbeat. A WebSocket would duplicate that
channel without a client→server realtime feature to justify it. If a future streaming assistant
needs bidirectional messages, it must pass the same loopback, host, origin and timeout checks and
publish through the same event bus; it must not open a second unguarded port.

## Instrument state

`useInstrumentState` derives `idle`, `listening`, `transcribing`, `thinking`, `speaking`,
`interrupted`, `error` or `offline` from the browser capture state, transcription request state,
routed model request state, the shared VoiceStudio audio player and node health. `listening` is set only
while `getUserMedia` is recording; `speaking` only while an audio element is actually playing.
`usePreferences().visualizerPreview` still overrides the state for development.

The instrument receives the analyser's real 0–1 RMS as a `--audio-level` custom property while
recording. Nothing synthesises activity when the input is quiet, muted or denied. No wake word or
always-listening loop runs in this build.

## Integration points

### Provider-independent model runtime

The runtime is split into `server/src/providers/`, `server/src/ai/` and `server/src/services/`:

1. `providers/types.ts` defines one `AiProvider` contract: streaming reply events, usage, discovery,
   connection probing and normalized errors. Gemini, OpenAI-compatible (OpenAI/DeepSeek/Ollama) and
   Anthropic adapters each implement it independently; a different adapter id cannot inherit
   another provider's endpoint or key.
2. `ai/registry.ts` contains only verified curated seats plus display metadata. Live discovery is
   merged without inventing unknown context limits, capabilities or prices. Curated prices carry a
   source URL and checked date and are always treated as estimates.
3. `ai/providerStore.ts` stores per-provider credentials and discovery state server-side. Gemini
   continues through the legacy `provider.json` key file; the other providers use
   `ai-providers.json` with restricted permissions. Ollama endpoints are loopback-only. No API
   response serializes a credential.
4. `ai/classifier.ts` performs local deterministic task classification and complexity estimation.
   `ai/router.ts` filters by availability, exclusions, required capabilities and a conservative
   worst-case budget reservation, then ranks by mode, preferred providers, quality and cost.
5. `ai/generation.ts` streams exactly one selected model, records provider-reported usage and the
   list-price estimate, and may try a fallback only before text is emitted. Free/local failures
   never silently become paid requests.
6. `services/turnService.ts` stores the user turn, builds bounded context, streams deltas, persists
   the final or partial assistant turn, and writes safe notices/activity on failure. The Agent's
   `agent/model.ts` uses the same router and completion path.
7. `providers/personality.ts` holds the configurable CAERA system instruction shared by all
   providers. It requires honest separation of completed, proposed and unavailable actions.

### Controlled agent runtime

The agent is a separate, explicit pipeline under `server/src/agent/`; ordinary conversation turns
still do not receive tools. The stages are task understanding (`taskUnderstanding.ts`), bounded
planning (`planning.ts`), schema-constrained next-action selection (`executionDecision.ts`), closed
tool discovery (`toolDiscovery.ts`), live permission checking (`permissionCheck.ts`), exact-action
confirmation (`confirmation.ts`), timeout and schema validation (`toolExecution.ts`),
structured result inspection (`resultInspection.ts`), safe errors (`errorHandling.ts`) and activity
publication (`activity.ts`). `orchestrator.ts` is the only loop; `runService.ts` owns the
queued/running/awaiting-confirmation lifecycle.

A run is inserted into `agent_runs`, answered with `202`, and executed in the background by a
claimed worker. The client polls state, so the ordinary 20-second request timeout never interrupts
planning or a tool. The loop is bounded to five steps, eight tool calls, three decision rounds per
step and 180 seconds of active execution, with a 20-second per-tool timeout and a 45-second model
call timeout. The model returns only JSON. Its selected name is resolved against
`listAgentTools()`; arguments are validated against primitive-only schemas and unknown fields are
rejected. If a tool needs confirmation, the orchestrator persists the exact pending tool run and
returns before execution. Approval resumes that persisted run with the same arguments; rejection
and cancellation execute nothing.

Tool output is inserted as untrusted evidence, never instructions. Every tool run records completed
or failed, a bounded preview and error; the final answer is told to report only recorded outcomes,
and any recorded failure is appended deterministically. A process restart marks queued/running runs
failed and retains pending confirmations for an explicit decision. There is no shell, arbitrary
code evaluation, general filesystem or screen-capture tool.

### Local computer interaction

`shared/src/computer.ts` defines the closed Windows operation list and policy contract.
`db/repositories/computerSettings.ts` validates and stores approved real executable paths and
folder roots plus per-operation enable/confirmation flags. Drive roots, non-`.exe` applications,
missing paths and invalid folder shapes are rejected.

`services/computerService.ts` is the only executor. Every file target is normalized, checked against
reserved Windows path forms, resolved with `realpathSync` and contained with `path.relative`; symlink
escapes are rejected. Reads are capped at 256 KB and reject binary data. Searches skip symlinks and
are bounded by entries and elapsed time. Creation uses exclusive `wx` writes, never overwrites, and
revalidates the real parent. Application launch accepts only a registered approved `.exe` and uses
`spawn` with `shell: false` and no arguments. Explorer/reveal and default-browser opening use fixed
Windows executables and argument arrays, never a shell. System information comes from `node:os`.

Actions are recorded in `tool_executions` with operation, status, short summary and error code, and
published to Activity. Read content and created-file content are not written to the audit summary.
The agent exposes the same operations as schema-validated tools; discovery omits disabled operations
and the agent permission check reloads the live policy immediately before execution. Consequential
operations always pause in the agent confirmation flow or return
`COMPUTER_CONFIRMATION_REQUIRED` to the direct API.

### Local knowledge index

The index is deliberately downstream of the connector boundary. A source is indexable only if it
is connected, has read permission, is globally enabled and is enabled by the user. The sync engine
calls the adapter's own `search` with an empty query, applies exclusions before reading, then calls
`read` for each candidate. It never copies arbitrary connector storage and never runs automatically.

Document ids are stable hashes; the source timestamp and a metadata/excerpt fingerprint skip
unchanged documents. A complete scan removes documents no longer returned upstream. Capped scans
are marked truncated and retain stale rows rather than asserting deletion. Chunking is bounded at
1,600 characters with overlap, 250 KB per document and 200 chunks. Source label, title, path, URL,
tags, folder/type, size, truncation and timestamps are stored; no content is written to Activity.

Search quotes every parsed term, supports explicit phrases, joins normalized tags with AND semantics
and uses `bm25(knowledge_fts, 8, 4, 1)` for title/tag/content ranking. Source, tag and ISO/date
filters are applied in SQL. Results deduplicate chunks to distinct documents and return real path,
document id and source label references. A separate table reserves embedding vectors; retrieval
still advertises `keyword` with `semanticAvailable: false`.

Settings changes purge disabled sources or newly excluded documents immediately. Disconnect and
read-revocation also purge the source. Temporary connection errors leave the local index available,
while sync reports disconnected sources as skipped. The agent exposes `knowledge.search` only while
indexing is enabled, and the execution-time permission check revalidates that state.

### VoiceStudio (speech input and output)

1. `server/src/voice/voiceStudioClient.ts` probes `GET /health`, then fetches and validates the live
   `GET /openapi.json` before any operation. It requires the voices path, the speech path and the
   `SpeechRequest` fields (`input`, `model`, `voice`, `response_format`, `speed`); an incompatible
   service is reported instead of guessed at.
2. `services/voiceConfigService.ts` stores a loopback-only URL, enabled flag, voice, speed, format,
   auto-speak, auto-start mode and optional absolute source folder in `server/.data/voice.json`
   (atomic, 0600). Credentials and non-loopback hosts are rejected; the saved folder must already
   exist and is only used as the documented launcher's working directory.
3. `services/voiceService.ts` owns cached health, the catalog, markdown-to-speech conversion,
   sentence-boundary truncation, synthesis and `voice` activity events. Reply text is never logged.
4. `routes/voice.ts` exposes configuration, check, voices, test, speech and transcription. Speech is
   returned as raw audio bytes; transcription accepts raw 16 kHz mono WAV up to 25 MB and returns
   JSON. The browser never connects to VoiceStudio and port 3900 stays on loopback.
5. The client uses `hooks/useVoiceSettings.ts` and one shared `services/voicePlayback.ts` player.
   Stop aborts the fetch and pauses/releases the blob. The deck, per-message controls and automatic
   reply speech all use that player, so only one reply speaks at a time.
6. `services/voiceCapture.ts` owns browser capture: `getUserMedia`, an analyser for real RMS,
   `MediaRecorder` for WebM/Opus, Web Audio decoding, and a 16 kHz mono PCM WAV encoder.
   `hooks/usePushToTalk.ts` owns hold/release, permission state, duration, cancellation and cleanup.
7. `pages/WorkspacePage.tsx` orchestrates capture → `POST /api/voice/transcribe` → routed model
   streaming → automatic spoken reply. A spoken turn answers aloud even when automatic reply speech is off,
   unless output is muted. Starting capture while a reply is generating or speaking barges in:
   the request or audio is aborted and the state becomes `interrupted`.
8. Transcription is probed separately from synthesis against the live OpenAPI document. A build
   without the endpoint or without an active ASR model reports `unsupported` or a 409 mapping; no
   model is downloaded automatically. There is deliberately no browser Web Speech fallback, because
   it can send microphone audio to the browser vendor.
9. `services/voiceLifecycleService.ts` probes `/health` before spawning. It can launch only the
   documented source-checkout launcher (`bun run dev:api`) or an operator-supplied
   `VOICESTUDIO_LAUNCH_CMD`; the desktop GUI is never launched. It records the child PID, waits for
   readiness, captures a bounded output tail, and exposes `unavailable`, `stopped`, `starting`,
   `managed`, `external` or `failed` state. Stop and node shutdown terminate only the tracked child
   tree, never a process that was already running.

### Approved memory and connectors

Memory is explicit, not distilled. `services/memoryService.ts` validates every entry, verifies that
a supplied source message belongs to the supplied conversation, and stores a bounded local excerpt
for provenance. The same service owns search, edits, one-hop relations, pause state, clearing and
recall.

Before a provider turn, `turnService.ts` builds the bounded context, checks that at least one model
is eligible and then calls `recallMemories` with the current user message. Selection is local keyword scoring (subject and content, with preference
and project entries slightly favored), capped at six direct entries plus two one-hop linked entries
and 1,800 characters. Only those entries' kind, subject and content are appended to the system
instruction; reasons, source excerpts and the full store are never sent. A recall failure is logged
and the turn continues without memory.

### Connector and tool framework

`shared/src/connectors.ts` is the contract: connector descriptors, the seven capabilities
(`search`, `read`, `create`, `append`, `update`, `delete`, `open`), independent grants, connection
status, activation configuration and model-safe tool definitions. A planned integration declares no
capabilities or operations, so it cannot accidentally advertise or execute a feature it does not
have.

`server/src/connectors/types.ts` defines the adapter boundary: `prepareConfig`, `test`, `execute`
with a bounded operation id, optional `previewCreate` for guided writes and optional
`requiresConfirmation` when confirmation depends on saved configuration. `registry.ts` is the only
place adapters are registered. The real adapters are `obsidian.ts`, `notion.ts`, `logseq.ts` and
`anytype.ts`. The three HTTP adapters share `http.ts` for timeouts, paced requests, safe errors and
bounded `Retry-After` handling; `planned.ts` now has no entries. Adding an application means
implementing the interface and registering one adapter, not changing the permission or tool
platform.

`services/connectorService.ts` owns lifecycle. Connect validates and probes a candidate runtime
before saving it, so a failed reconfiguration leaves the prior connection intact. It stores only
non-secret configuration in API-visible state and keeps credentials in server-side JSON. New grants
come from `ensureConnectorPermissions` with read allowed and every write blocked; updating grants
requires a new write to be explicitly confirmed. Disconnect deletes the connection row and all of
its grants after optional adapter cleanup.

`services/connectorToolService.ts` builds definitions only for connected adapters, namespaced as
`connector.operation`. Before dispatch it checks the node kill switch, connection status, registered
tool id, the exact `ConnectorPermissionKind` grant and a separate `confirmed: true`. The adapter's
`requiresConfirmation` decides whether confirmation is needed: destructive operations always require
it, and Obsidian creation requires it unless trusted creation is enabled for that vault. It validates
raw arguments against the generated schema and rejects unknown fields, then verifies the adapter's
result discriminator matches the declared capability. Only after success are `last_used_at`, a
`tool_executions` row and an activity event written. Failure writes a failed execution record and
event; both use operation metadata and counts, not note contents or paths. The agent reaches this
registry only through the controlled loop described above, after an independent live grant check
and, for writes or deletes, exact-action approval.

Obsidian's adapter enforces a second boundary beneath the tool layer: `resolveVaultRoot` resolves and
checks a real directory, rejects a drive root, and `resolveNotePath` normalizes separators, rejects
absolute paths and `..`, blocks reserved directories, requires a Markdown extension and verifies
real-path containment. Accessible folders restrict every operation to approved vault subtrees;
excluded folders are pruned from traversal and rejected on direct paths. Directory traversal skips
symlinks, hidden entries and reserved directories, with a short file-list cache that is invalidated
by adapter writes. Reserve paths are checked again before creating parent folders.

Search parses frontmatter, tags and internal links without a YAML dependency, scores title, path, tag
and body matches, and returns bounded excerpts. Read builds a note index to resolve `[[wikilinks]]`
and internal Markdown links to vault-relative paths. `previewCreate` applies the configured folder and
naming rule, reports an existing target, and never writes. Create uses an exclusive file flag, append
preserves the existing file, update replaces one explicit note only after confirmation, and delete
removes one explicit path.

`services/directoryBrowserService.ts` backs the vault picker. It is available only for local-folder
adapters, returns directory names only (never files or contents), starts from the home folder and
known roots, resolves every path, refuses files and relative paths, and lists at most 400 folders per
request. It is called by the local client through the same loopback host/origin gate; it is not a
tool and is never offered to a model.

## Failure modes covered

- **Database cannot open or migrate:** the node logs `database_init_failed`, refuses to listen and
  exits, rather than silently running without persistence.
- **Database locked:** SQLite waits up to 5 seconds, then the request fails through the error
  envelope.
- **Node offline:** health polling flips the sidebar, instrument and composer into offline states
  with a real retry.
- **Slow or aborted request:** Stop aborts the fetch; the node may still have persisted the turn, so
  the client refetches instead of pretending nothing happened.
- **Provider rejected the key or rate-limited the request:** the node stores a safe system notice,
  publishes a failed activity event, exposes an error state in provider status, and never includes
  the key or raw SDK message in the response.
- **Provider timeout:** a local timer aborts the stream, keeps partial text, appends a timeout
  notice and returns `PROVIDER_TIMEOUT` through the turn stream.
- **Missing conversation:** the route renders a local error panel, not a blank screen.
- **Memory recall fails:** the turn still runs; the node logs `memory_recall_failed` and sends no
  memory rather than failing the reply. The CAPTURE side is explicit only, so a broken recall cannot
  create or modify entries.
- **Corrupt legacy store file:** the node logs a warning and continues with an empty legacy import;
  the original file is untouched.
- **VoiceStudio unavailable:** health is marked unreachable, the speak control explains why, speech
  routes return an actionable 503 and text chat is untouched. No audio is fabricated.
- **VoiceStudio contract drift:** `/openapi.json` is validated on every cold check; missing paths or
  request fields produce `VOICE_UNSUPPORTED` with the missing names, not a guessed request.
- **VoiceStudio startup fails:** the lifecycle records the failure and a bounded output tail, keeps
  CAERA running, and exposes Start again in Settings. Text chat remains available.
- **VoiceStudio was already running:** it is reported as external, Stop is disabled, and CAERA exit
  leaves it untouched.
- **SSE drop:** the browser reconnects with a 3s retry; the panel says `reconnecting` and records the
  transport event.
