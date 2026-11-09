# Release status and final test matrix

Version under review: `0.1.0` source preview. Target platform: Windows 11, x64, local only.

## Release gate

| Gate | Status | Evidence / blocker |
| --- | --- | --- |
| TypeScript compiles | Pass | `npm run typecheck` across shared, server and client |
| Production build | Pass | `npm run build`; Vite reports only its existing >500 kB chunk warning |
| Dependency audit | Pass | `npm audit --omit=dev`: 0 low/moderate/high/critical |
| Starts from a fresh data directory | Pass | Isolated node, migrations 1–7, loopback health |
| Model routing and provider protocol | Partial | Router unit/integration checks and a local OpenAI-compatible/Anthropic-protocol mock passed; no live vendor account was available |
| Text chat with a real provider key | **Not run** | No external Gemini/OpenAI/Anthropic/DeepSeek credential was supplied to this audit |
| Voice capture and spoken reply | **Not run** | VoiceStudio was not installed/running; health correctly reports unavailable |
| Obsidian connect and knowledge sync | Pass | Real temporary vault, opt-in FTS index and source revocation purge |
| Memory create/list | Partial | Three entries created through the real API and rendered in the Memory page; live hosted-model recall not run without a provider key |
| Memory edit/delete | **Not run** | Existing UI paths were not exercised in this final audit |
| Conversation create/list | Partial | One conversation created through the real API and listed in the workspace |
| Conversation rename/delete | **Not run** | Existing UI paths were not exercised in this final audit |
| Agent tool catalog | Pass | Closed registry rendered; live hosted model plan not run without a key |
| Notion/Logseq/Anytype live connection | **Not run** | No account or running local service |
| Disconnect integrations | Pass | Obsidian disconnect removes link/grants and purges indexed rows |
| Install on a separate clean Windows machine | **Not run** | Only the development Windows host was available |
| Desktop installer | Not produced | Packaging deliberately deferred; see [PACKAGING.md](PACKAGING.md) |
| Public showcase | Built, **not hosted** | Static artefact ready; Cloudflare account/token unavailable |

## Source installation test

The production artefact was started on this machine with a blank data directory:

```bash
npm run typecheck
npm run build
CAERA_DATA_DIR=<empty-directory> npm start
```

The node applied all migrations, bound to loopback and served the built client. The health endpoint
reported database schema 7, provider `not-configured`, VoiceStudio unavailable and the expected
capability map. No key, credential or private vault was used. A separate isolated run configured a
mock loopback provider through the real AI API and exercised discovery, streaming, token usage,
manual routing, fallback, rate-limit errors, hard-zero budgets and provider removal.

## What is still required before a public binary release

1. Run the complete matrix on a fresh Windows 11 VM with no global Node installation.
2. Configure owner-funded Gemini, OpenAI, Anthropic and DeepSeek test keys and verify live streaming,
   stop, quota errors, model discovery and key rotation through the real adapters.
3. Install VoiceStudio separately and verify health discovery, speech, push-to-talk and clean shutdown.
4. Verify Notion, Logseq and Anytype against live accounts or running applications.
5. Decide and add the project license; see [LICENSING.md](LICENSING.md).
6. Create the public Git repository and replace placeholder repository references in the showcase.
7. Record a genuine interaction video; do not present a slideshow as an interactive demo.
8. Publish the static showcase through Cloudflare Pages with the owner's account.
9. Decide whether to pursue the deferred Electron shell after these gates pass.

## Known limitations

- No installer or portable executable yet; users need Node.js 22.13+.
- The clean Windows installation requirement is not satisfied by a single-machine test.
- VoiceStudio and its models are separate downloads with their own licenses.
- The source preview depends on the selected provider's quota, pricing and network access.
- Hosted provider integrations passed protocol-level tests only; live vendor accounts were unavailable.
- Notion, Logseq and Anytype remain labelled live-test-pending.
- Desktop packaging would add a substantial new security boundary and is intentionally absent.
- The showcase has no video and says so; screenshots are real UI with sample data.
