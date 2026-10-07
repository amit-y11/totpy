# Contributing to Totpy

Thanks for helping! Bug reports, fixes, docs, translations and new sync providers are all
welcome. By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

> [!IMPORTANT]
> Found a security problem? Please **don't open an issue**. Follow [SECURITY.md](SECURITY.md)
> instead.

## Ways to contribute

- **Report a bug** or **suggest a feature** with the
  [issue templates](https://github.com/amit-y11/totpy/issues/new/choose).
- **Pick up an issue** labelled `good first issue` or `help wanted`. Comment first so nobody
  duplicates work.
- **Improve the docs.** Typos and unclear instructions are worth fixing.
- **Larger changes** (new features, new permissions, format changes): open an issue to discuss
  the approach before writing code.

## Development setup

You need [Node.js](https://nodejs.org/) 22.18 or newer and Google Chrome.

```bash
git clone https://github.com/amit-y11/totpy.git
```

```bash
cd totpy && npm install
```

```bash
npm run dev
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the
`dist/` folder. `npm run dev` rebuilds on every change; click the reload icon on the extension
card to pick it up.

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Rebuilds on change, with source maps                 |
| `npm run build`     | Production build into `dist/`                        |
| `npm run typecheck` | Strict TypeScript check                              |
| `npm test`          | Unit tests (Node's test runner, TypeScript directly) |
| `npm run check`     | Type check, tests and formatting check               |
| `npm run format`    | Formats everything with Prettier                     |
| `npm run package`   | Builds and zips `dist/` into `release/`              |

## Project structure

```
src/
  manifest.json
  background.ts          service worker: auto-lock, sync, menus, automatic copies
  lib/
    types.ts             shared data shapes (Entry, Envelope, SyncProvider, …)
    base32.ts totp.ts    RFC 4648 / 4226 / 6238
    otpauth.ts           otpauth:// parsing
    migration.ts         Google Authenticator export (protobuf) parsing
    crypto.ts            vault encryption (see docs/security.md)
    vault.ts             data model and merge
    store.ts             extension storage, lock/unlock, recovery
    sync.ts              sync engine
    providers/           chrome-sync, google-drive
    match.ts             suggests accounts for the current site
    menus.ts page.ts     right-click menu and the function injected into pages
    backups.ts           automatic daily copies
    clock.ts             clock-drift check
  popup/                 toolbar popup
  options/               settings page
  ui/                    shared styles, DOM helpers, QR decoding
tests/                   unit tests
scripts/                 build, package and icon scripts
docs/                    design docs and images
```

## Guidelines

- **Security first.** Secrets must stay encrypted anywhere outside memory: local storage, sync
  providers, automatic copies and exports (except the explicitly labelled plain-text export).
  Read [docs/security.md](docs/security.md) before touching `crypto.ts`, `store.ts` or
  `sync.ts`.
- **Strict TypeScript.** No `any`. Validate untrusted input (sync copies, backup files, page
  data) at the boundary, like `validateEnvelope` does.
- **Never put user data into `innerHTML`.** Use the `h()` helper in `src/ui/dom.ts`.
- **Functions injected into pages** (`src/lib/page.ts`) must be self-contained: no imports or
  outer variables.
- **Keep runtime dependencies rare.** Everything in `dependencies` is bundled into the
  extension and must be justified, audited and license-compatible (add its license to `STATIC`
  in `scripts/build.ts`). Dev tooling is fine.
- **Keep permissions minimal.** Explain any new permission in your pull request.
- **Test logic in `src/lib/`** with unit tests in `tests/`. `tests/helpers/chrome.ts` provides
  an in-memory `chrome.*` that can simulate several devices sharing Chrome sync.
- **Match the UI.** Use the existing CSS variables in `src/ui/common.css`, and check light and
  dark mode.

## Adding a sync provider

1. Create `src/lib/providers/<name>.ts` implementing `SyncProvider` from `src/lib/types.ts`.
   Providers only store and return the opaque encrypted envelope; merging and encryption are
   handled for you.
2. Register it in `src/lib/providers/index.ts` and add its id to `ProviderId` and the default
   settings in `src/lib/store.ts`.
3. Add any host permissions to `src/manifest.json` and explain them in your pull request.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), checked by
commitlint:

```
feat: add WebDAV sync provider
fix(popup): keep search focus after copying a code
docs: clarify Google Drive setup
```

Husky runs Prettier on staged files when you commit, and the type check and tests before you
push.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests where it makes sense.
3. Run `npm run check`.
4. Load `dist/` in Chrome and try your change in both light and dark mode.
5. Open a pull request and fill in the template. Screenshots help for UI changes.

## Releases

Maintainers release by updating the version in `src/manifest.json` and `package.json`, adding
an entry to [CHANGELOG.md](CHANGELOG.md), and pushing a `vX.Y.Z` tag. The release workflow
builds the extension and attaches the zip to a GitHub release.
