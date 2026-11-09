# CAERA showcase

A self-contained static portfolio page for CAERA. It has no Worker, API, analytics, forms or
hosted backend. All screenshots are captures of the real local interface using an isolated
demonstration database; the page itself cannot run the assistant.

## Files

- `index.html` — the one-page showcase
- `site.css` — visual system and responsive layout
- `site.js` — nav state and reveal animation only
- `_headers` — Cloudflare Pages security and cache headers
- `assets/` — five 1440×960 interface captures plus self-hosted OFL font files

The hero, Memory, Knowledge, Connections and Agent captures are real UI. They are sample data,
not claims that a model key, VoiceStudio or a live external account was connected.

No demonstration video is included. A real recording still needs to be made after the clean-machine
and voice tests; the showcase does not substitute a slideshow or mock interaction.

## Publish with Cloudflare Pages

Cloudflare Pages is static hosting; it does not require Workers or a paid backend.

1. Create a Git repository and connect it to Cloudflare Pages, or use direct upload.
2. Set the project name to `caera-showcase`.
3. Build command: leave empty. Output directory: `showcase`.
4. Publish. `_headers` is applied automatically.

Direct upload from this folder, once authenticated with Cloudflare:

```bash
npx wrangler@latest pages deploy . --project-name caera-showcase
```

This artefacts set was prepared but not published from the build environment because no
Cloudflare account or API token was available. Do not substitute a Workers deployment: the
showcase is intentionally static.

## Before publishing

- Replace the GitHub profile links with the public CAERA repository once it exists.
- Record a real interaction video after the clean-machine test; none is included or implied here.
- Re-capture screenshots if the interface changes.
- Review the release claims in `docs/RELEASE.md`.
