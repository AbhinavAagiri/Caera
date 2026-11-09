# Contributing

CAERA is a local-first Windows application. Contributions should preserve the loopback-only
boundary, explicit approvals, honest error states and the closed tool registry.

## Before opening a pull request

```bash
npm install
npm run typecheck
npm run build
```

- Keep provider keys, connector tokens, private vault paths and personal data out of commits,
  screenshots, fixtures, logs and issues.
- Add a migration instead of editing an applied schema migration.
- Do not add a shell, arbitrary command execution, general filesystem access or a hidden network
  data path.
- New tools must have a bounded schema, a permission decision, a timeout and a failure path that is
  recorded rather than rewritten as success.
- Connector claims must distinguish implemented, live-tested and pending. Do not invent a provider
  success in documentation or UI.
- Add tests or a reproducible verification command where practical. This repository currently has
  no dedicated test suite; typecheck and build are not substitutes for live integration checks.

## Reporting security issues

Do not publish secrets or exploit details in a public issue. Contact the repository owner privately
until a security policy and private reporting channel are configured.

## Licensing contributions

By contributing, you agree that your contribution can be distributed under the project license once
one is selected. The project license is currently unresolved; see [LICENSING.md](docs/LICENSING.md).
Do not contribute third-party code, models, fonts, images or installers unless their license is
compatible and the required notice is included.
