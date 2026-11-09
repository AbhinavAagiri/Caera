# Packaging evaluation

**Decision: defer desktop packaging.** The current release is a source-run local application.
A desktop installer should not be published until the clean-machine and live-service tests in
[RELEASE.md](RELEASE.md) pass. This document compares the two serious options without adding either
dependency.

CAERA is not a static frontend with a thin API. It depends on a long-lived Express process, the
Node 22.13+ `node:sqlite` module, filesystem containment, provider streaming and a separately
installed loopback speech service. That backend shape dominates the packaging decision.

| Criterion | Tauri 2 | Electron |
| --- | --- | --- |
| Windows compatibility | Strong. Uses WebView2, which is present on current Windows 11 systems and is evergreen. Rust toolchain and WebView2 bootstrapper are required to build. | Strong. Bundles Chromium, so the rendering engine is identical across machines. Large, mature Windows code-signing and installer ecosystem. |
| Installation size | Small shell, but CAERA still needs a Node sidecar. Expect roughly 3–10 MB for the Tauri shell plus 50–100 MB for a Node runtime and app files. WebView2 may add system-managed runtime weight. | Roughly 90–160 MB compressed in typical builds because Chromium and Node are bundled. Size can be reduced by omitting devtools/assets, but Electron remains materially larger. |
| Local backend support | Requires sidecar process management, port lifecycle, graceful shutdown, crash recovery and bundling of Node plus Express dependencies. Rust adds a second runtime to maintain. | Best fit for the existing architecture: Electron's main process is Node. The Express node can be started as a child process or utility process, with mature lifecycle APIs and Windows process-tree handling. |
| Filesystem access | Capability-scoped Rust commands are strong, but every existing Node filesystem policy would need a parallel Tauri IPC surface or remain behind the sidecar API. Two permission models increase drift risk. | Node APIs are already used by the Express node. Existing realpath containment and approval logic can remain unchanged; the renderer still talks only to loopback HTTP. |
| VoiceStudio communication | Both can call `http://127.0.0.1:3900`; mixed-content rules are irrelevant for a loopback HTTP request made by the local backend. Tauri's native HTTP client would create a second request path. | The existing node already owns VoiceStudio discovery, process lifecycle and audio proxying. No renderer network privileges are needed. |
| Maintainability | Smaller runtime, but requires Rust/Tauri expertise, sidecar packaging, WebView2 version handling and a second permission boundary. Tauri auto-update and signing are viable but add release infrastructure. | One Node runtime, one HTTP contract and the existing test/build pipeline. Larger binaries and Chromium security patch cadence are the costs. |

## Recommendation

Use **Electron** if a desktop shell is pursued after the release gates pass. It has the lowest
architectural risk for CAERA's Node backend, filesystem policy and VoiceStudio lifecycle. Keep the
renderer sandboxed, disable `nodeIntegration`, enable `contextIsolation`, expose no general IPC
filesystem bridge, and start the existing loopback node on an ephemeral port. The browser UI
should continue to use the typed local API rather than gain direct OS access.

Reconsider Tauri only if installation size becomes the dominant constraint and a dedicated
sidecar lifecycle can be maintained without duplicating the filesystem policy. A Tauri shell that
still ships Node is not a small application; it is a small shell around a large sidecar.

## Explicit non-decisions

- No Tauri or Electron dependency has been added.
- No installer, portable archive or auto-updater is produced.
- No WebView is allowed to call a model provider or VoiceStudio directly; all credentials and
  network calls stay in the local node.
- No external VoiceStudio installer, model weights or voice samples are bundled.
- Code signing and Windows SmartScreen reputation require an owner-controlled certificate and
  release account; they cannot be completed in this repository alone.

The recommended packaging spike, once unblocked, is an unsigned Electron development build that
starts the existing built node, verifies graceful shutdown and validates that the renderer has no
Node API. Signing and publishing are separate release decisions.
