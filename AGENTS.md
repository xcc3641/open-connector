# Repository Guidelines

## Architecture

- Keep one clear owner for each fact. Do not repeat provider metadata such as `displayName` in executors when it already belongs to `definition.ts`; pass or inject it from the caller that has the definition/catalog.
- Provider definitions are catalog source code. Build schemas with `src/core/json-schema.ts` helpers, usually imported as `s`, instead of copying generated catalog JSON.
- Keep runtime lazy: catalog generation may import provider definitions, but executor modules should load only when an action or credential validator is actually used.
- Do not create barrel files such as `index.ts`. Import from the concrete module that owns the API.

## Code Style

- Prefer VS Code-style coherent modules: split files by responsibility or abstraction boundary, not by loose categories.
- Prefer `interface` for object-shaped contracts. Keep unions and mapped/utility compositions as `type`.
- Prefer named options/input interfaces over inline object types when a function signature spans multiple lines or crosses module boundaries.
- Avoid temporary ad hoc objects passed through many layers. Prefer explicit interfaces, classes, or top-level functions that match module boundaries.
- Put generic low-level casting/reading helpers in `src/core/cast.ts`; avoid provider-specific wrappers for generic reads.
- Avoid trivial pass-through helpers and conditional object spreads that only hide `undefined` JSON fields.
- Do not manually wrap code to 80 columns. Let `oxfmt` decide formatting.

## Runtime API

- Keep `/v1` response shaping in `src/server/runtime-api.ts`; route handlers should dispatch and validate, not assemble compatibility objects field by field.
- Public runtime fields should have a clear source and consumer. Do not expose local implementation concepts or placeholder fields just because they are easy to add.
- Match existing runtime wire shapes deliberately: catalog index endpoints, action metadata, connection aliases, envelopes, and error codes should stay stable for SDK/CLI clients.
- If an upstream-compatible field has no local source yet, prefer omitting it or returning a documented empty value from the serializer rather than scattering optional fields in routes.

## Providers

- Provider code normally lives in `src/providers/<service>/definition.ts`, `actions.ts`, `executors.ts`, and provider-local runtime helper files when needed.
- Prefer provider-local constants for official scopes, permissions, URLs, and API versions. Action `requiredScopes` should use provider-native scopes/capabilities, not private internal aliases.
- Avoid repeated action-name wiring. Define action handlers once and derive executor maps through shared provider runtime helpers.
- Do not import provider definitions from executor modules just to reuse metadata; inject catalog metadata from the server/loader side when needed.

## TypeScript And Tooling

- Use native Node.js TypeScript execution. Do not add `tsx` or `--experimental-strip-types`.
- `src/`, `scripts/`, and `examples/` each have their own `tsconfig.json`; project checks focus on `src`.
- Exported top-level functions and public types should have explicit return types and useful JSDoc when it explains business meaning.
- Use `oxfmt` and `oxlint`; do not add Prettier.

## Examples And Web

- Examples should be concrete scripts users can run directly with `node examples/...`; do not add every example to `package.json`.
- If an example depends on external credentials, print a clear skip message when environment variables are missing.
- Do not put web UI code under `src/`. The future console should live as a separate Vite package under `web/`.
- Public docs should describe normal OSS usage and may include official SaaS, hosted, or team product paths when they are part of the public product strategy. Do not mention internal compatibility projects or unreleased SDK behavior.

## Commit Hygiene / Secrets

This fork and upstream are **public**. Every commit and push must be reviewed for secrets first. Do not rely on "we can scrub later".

### Never commit

- Real API keys, tokens, passwords, OAuth client secrets, session cookies
- Service-account JSON / PEM private keys (even "just for a quick test")
- Local env files (`.env`, `.env.openconnector`, `*.env.bak*`) and runtime DB under `data/`
- Hosted MCP/runtime bearer tokens from agent configs (e.g. `~/.pi/agent/mcp.json`)
- Real account identifiers when avoidable in tests (prefer `example.com` / `example-*` fixtures)

### Allowed in git

- Placeholder shapes only: `ctx7sk-...`, `fc-...`, `Bearer <TOKEN>`, `oct_...`
- Generated or ephemeral test keys (e.g. `generateKeyPairSync` PEM in unit tests)
- Docs that describe *how* to set a secret, without embedding a live value

### Before every commit

1. `git status` / `git diff` — confirm no `.env*`, key files, or unexpected path
2. Scan the staged diff for live-looking material:
   - `sk-`, `ctx7sk-`, `ghp_`, `xox`, `AIza`, `BEGIN PRIVATE KEY`, long `Bearer ...`
   - real emails / project ids that are not needed for the code change
3. Tests and examples: use fake emails/projects; if a credential env var is missing, skip with a clear message
4. Remember logger redaction (`src/server/logger.ts`) only affects logs — it does **not** protect git history

### Local secrets stay local

| Location | Notes |
|----------|--------|
| `.env.openconnector` | gitignored; Docker/local runtime |
| Docker volume / `OOMOL_CONNECT_DATA_DIR` | encrypted or plaintext creds at rest; never copy into the repo |
| Agent MCP config outside this repo | do not paste tokens into commits or docs |

If a secret is committed by mistake: rotate it immediately, then purge history; do not only delete in a follow-up commit.

## Verification

- Before finishing code changes, run `npm run fix-check`. It runs lint fixes, formatting fixes, and the `src` typecheck.
- Run `npm run build` only when you need a separate no-fix typecheck, for example after generated files changed or for CI parity.
- Run `npm run generate:catalog` when provider definitions or actions change.
- Run provider examples manually when the task changes user-facing example behavior.
- Before every commit/push on this public fork, run the **Commit Hygiene / Secrets** checks above.
