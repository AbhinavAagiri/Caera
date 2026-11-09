# Roadmap

## Phase 1 — Foundation and interface (delivered)

- Local client/server development setup with a typed contract.
- Complete desktop interface: sidebar, conversation workspace, instrument, activity, memory, tools
  and seven settings sections.
- Real local conversation persistence, search, rename, delete, clear.
- Honest system notices instead of fabricated model replies.
- Working theme, density, motion, identity, voice, memory and permission preferences.
- SSE activity stream with real node events.
- Instrument state system with a development preview.

**Explicitly not built in Phase 1:** model calls, streaming assistant tokens, memory capture, voice
capture, tool execution, attachments.

## Phase 2 — Model pipeline, tools, connectors and memory (in progress)

1. **Multi-provider model runtime — delivered.** Server-side adapters for Gemini, OpenAI, Anthropic,
   DeepSeek and loopback Ollama share one streaming contract. The registry, local task classifier,
   automatic router, Economy/Balanced/Maximum modes, manual overrides, opt-in fallback, hard spending
   limits and append-only usage history are implemented. Gemini is one provider rather than the
   foundation. Hosted adapters were verified at protocol level against a local mock; live vendor
   accounts were not available in this environment.
2. **Connector tool framework — delivered.** A standard adapter interface with capability
   discovery, independent read/create/edit/delete grants defaulting to read-only, new-write
   confirmation, destructive-call confirmation, structured tool definitions, strict argument
   validation, permission checks before dispatch, and activity/tool metadata without note content.
   Real adapters now cover Obsidian, Notion, Logseq and Anytype. The Connections page manages
   status, configuration, grants, checks, disconnect and each adapter's knowledge workspace.
3. **Obsidian second-brain connector — delivered.** Direct local vault access with a folder-only
   picker, accessible and excluded folders, default note location, naming rules and trusted
   creation. Search covers titles, content, tags and folder paths with bounded excerpts. Notes
   return frontmatter, tags and resolved internal links. Create shows a path/content preview before
   writing; update and delete always confirm. Traversal, reserved folders and symlink escapes stay
   blocked. The Obsidian Local REST API remains a documented future alternative transport.
4. **Notion, Logseq and Anytype connectors — implemented; live verification pending.** Notion uses
   the official API with cursor pagination and data sources; Logseq uses the desktop local HTTP API
   with version-aware errors; Anytype uses the stable local v1 API and space/property resolution.
   Each has a dedicated workspace, independent grants, rate-limit/auth/API error handling and
   disconnect. No live account, graph or space was available in this environment, so they are not
   marked delivered until real connection checks pass.
5. **Controlled agent runtime — delivered.** A separate persisted agent pipeline now performs task
   understanding, bounded planning, closed tool discovery, live permission checks, exact-action
   confirmation, timeout-limited execution, structured result inspection, cancellation and activity
   reporting. It supports multi-step tasks over connector, web, calculation and local utility tools,
   and cannot execute arbitrary code or shell commands. Live end-to-end verification with a hosted
   provider key is still required in this environment; the no-model path is explicit and does not
   fabricate a run.
6. **Local computer interaction — delivered.** A closed, permissioned Windows layer now supports
   approved `.exe` launching, website opening, approved-directory search/read/create and file
   open/reveal, plus system information. It uses strict real-path containment, no shell or arbitrary
   commands, exact-action approval for consequential actions, and an audited action log. All eight
   operations were exercised against Windows 11. Broader desktop automation remains a non-goal for
   this phase.
7. **Memory — delivered.** Explicit user-approved entries (fact, preference, project, recurring
   context, relationship), a management page with search/edit/delete/pause/clear, local source
   excerpts, one-hop links, and relevance-only retrieval capped at six direct plus two linked
   entries and 1,800 characters. Nothing is captured automatically.
8. **Research.** Public-page reading is available as one agent tool; a dedicated research task with
   source collection, citation checks and progress reporting remains future work.
9. **Unified knowledge index — delivered.** Opt-in SQLite FTS5 retrieval across approved connector
   content, with per-source exclusions, incremental sync, source/tag/date filters, real references,
   read-revocation purging, clear controls and the `knowledge.search` agent tool. Chunk ids and an
   embedding table prepare a later local semantic pass; semantic search is not enabled. Live
   Obsidian content passed the indexing suite; Notion, Logseq and Anytype live cross-application
   verification remains pending until those accounts/services are available.
10. **Intelligent model routing — delivered, live hosted verification pending.** A deterministic
    local classifier, capability-aware router, five provider adapters, manual and automatic modes,
    budget preflight, opt-in fallback and per-request usage history now form a provider-neutral
    layer. The router and adapter protocols passed integration tests against a local compatible
    server. Real OpenAI, Anthropic, DeepSeek and Gemini accounts were unavailable, so live provider
    success, real pricing settlement and provider-specific quota behaviour are not claimed.

## Phase 3 — VoiceStudio

1. **Speech output — delivered.** Health and OpenAPI discovery, loopback-only configuration, voice
   catalog and selection, reply speech with stop, optional auto-speak, test voice, and honest
   unavailable states. `speaking` now follows real playback.
2. **Capture and transcription — delivered.** Push-to-talk microphone capture, 16 kHz mono WAV
   encoding, VoiceStudio batch transcription through the local node, transcript display and
   voice-origin turns whose replies are spoken.
3. **Input-reactive instrument — delivered.** Real analyser levels drive the core and compact
   visuals while recording; no synthetic activity is drawn.
4. **Service lifecycle — delivered.** Documented headless launch from a source checkout, optional
   operator command, boot or first-use startup, managed/external process ownership, readiness
   probing, bounded failure output and manual start/stop in Settings.
5. **Streaming input — future.** A streaming ASR path, wake-word detection and always-listening
   mode remain out of scope until push-to-talk is proven in daily use.

## Phase 4 — Desktop shell

- Tray presence, launch on login, global shortcuts, native window chrome.
- Signed installer with auto-update handled locally.
- Optional per-profile local stores.

## Non-goals

- Hosted accounts, cloud sync or telemetry.
- A generic chatbot transcript layout.
- Fake progress, fake tools, fake research or placeholder analytics.
- Model access from the browser.
