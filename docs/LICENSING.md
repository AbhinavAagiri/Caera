# Licensing and distribution notes

This is an engineering audit, not legal advice. Re-check dependency licences and external terms
before each published release.

## Project license: owner decision required

No `LICENSE` file has been selected for CAERA. Without one, the source remains copyright-protected
and is **not formally open source**, even if the repository is public. Choose a license (MIT and
Apache-2.0 are compatible candidates for this dependency set), add the exact text, and update the
README before calling the release open source. Do not infer a license from this document.

Copyright in CAERA's original source and design remains with its owner/contributors.

## npm dependency audit

Audit run against `package-lock.json` on 2026-11-08:

- Production dependency tree: 217 packages.
- `npm audit --omit=dev`: 0 known vulnerabilities.
- Licence scan: no GPL, AGPL, LGPL or unknown third-party production licenses.
- Observed third-party licenses include MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD,
  MPL-2.0, CC-BY-4.0 and OFL-1.1. The local workspace packages are private and have no declared
  license; that is separate from the project-license decision above.
- Fonts are self-hosted under the SIL Open Font License 1.1. Keep their license texts when
  redistributing a packaged build.
- `@google/genai` is Apache-2.0; Express is MIT; dotenv is BSD-2-Clause; React and related packages
  are MIT.

Generate a package-by-package report before release if the dependency graph changes:

```bash
npx license-checker --production --summary
```

Do not add a package with a copyleft or unknown licence without reviewing the distribution model.

## VoiceStudio

[VoiceStudio](https://github.com/debpalash/VoiceStudio) is a separate application licensed
**AGPL-3.0**. CAERA communicates with an independently installed instance over its loopback HTTP
API and does not include VoiceStudio source, binaries, installers or model files.

- Never redistribute a VoiceStudio installer or a modified VoiceStudio build from a CAERA release
  without satisfying AGPL-3.0, including source-offer obligations.
- If CAERA were ever shipped as a combined work or a modified network service based on VoiceStudio,
  obtain legal review first. The current integration is a separate local HTTP client.
- Do not imply that VoiceStudio is bundled or that CAERA owns its code.

## Models, weights and voices

Voice models, ASR models, voice profiles, reference audio and generated audio have separate terms.
Terms vary by model and may restrict commercial use, cloning or redistribution. CAERA:

- does not download or bundle weights;
- does not include voice profiles or samples;
- reads the user's installed VoiceStudio catalogue at runtime;
- never silently installs an ASR or speech model.

Users must review the licence shown for each model in VoiceStudio before use. A voice clone must
have the speaker's permission and comply with local law. No model or voice asset is included in the
showcase or source release.

## External integrations and their terms

- **Obsidian:** local Markdown files. CAERA is not affiliated with Obsidian; no installer or theme
  is redistributed.
- **Notion:** official HTTPS API under the user's Notion account and integration terms. Users create
  their own internal integration token and share specific pages.
- **Logseq:** local HTTP API; the user enables it and creates the token. Respect Logseq's license and
  the user's graph permissions.
- **Anytype:** local API under the user's Anytype installation and API-key terms.
- **Google Gemini, OpenAI, Anthropic and DeepSeek:** requests use the user's own account/key and
  are subject to that provider's API terms, quotas, pricing and data handling. CAERA does not sell,
  resell or sublicense model access.
- **Ollama and local model weights:** local inference is provided by software and model files the
  user installs separately. Model weights, licences and acceptable-use terms belong to their
  respective publishers; CAERA does not redistribute them.
- **GitHub:** source hosting and release distribution are subject to GitHub's terms.

No third-party installer, model weight, API key or voice sample is redistributed in this release.

## Showcase assets

The screenshots are captures of CAERA with synthetic demonstration data. The interface fonts are
self-hosted under OFL-1.1. Product names and marks belong to their respective owners. No VoiceStudio
brand asset is used as CAERA branding.
