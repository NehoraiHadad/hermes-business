# Tachles community WhatsApp — Claude Code handoff

Date: 2026-08-16 (Asia/Jerusalem)

> **SUPERSEDED (2026-08-16, same day):** the user rejected the two-runtime
> architecture described below. The authoritative continuation is
> [community-single-home-2026-08-16.md](community-single-home-2026-08-16.md):
> ONE Hermes installation, one gateway, one WhatsApp connection, one
> HERMES_HOME. The two-runtime implementation is preserved on branch
> `archive/two-runtime-506c378`. Sections below describing
> `%LOCALAPPDATA%\TachlesCommunity`, the activation marker, and the community
> provider bridge are historical.

## Objective and product contract

Finish a pilot-downloadable Tachles community system while keeping Hermes as
the brain and infrastructure. Tachles remains a thin conversational wrapper:
no community dashboard, no custom RAG/vector database, and no inference on
every incoming group message.

Approved public WhatsApp groups are observed passively into Hermes' existing
`state.db`. Passive observation must never dispatch the agent or produce
typing/read receipts/outbound. When a resident addresses the agent, it receives
one bounded window of nearby context and can use the scoped
`community_archive` tool to search/count across approved public groups. The
raw `session_search` tool is disabled. Sensitive/isolated groups are refused in
the shared MVP and require a separate deployment.

Retrieval is on demand. Optional background curation should use Hermes Cron at
low frequency over deltas with provenance; do not build a second worker or run
an LLM for each inbound message.

## Repositories and authoritative engine pin

- Product workspace: `C:\projects\hermes-business-poc`
- Community engine worktree: `C:\projects\hermes-agent-community-release`
- Upstream observer PR worktree: `C:\projects\hermes-agent-upstream-audit`
- Authoritative immutable engine tag: `community-engine-v0.2.2`
- Peeled commit: `af04eb8bb85e0a5b6333cd0104921b7e49bcf1f9`
- Official base: Hermes `v2026.8.13`, package version `0.20.1`

The tag exists remotely at that exact commit. Older tags `v0.2.0` and
`v0.2.1` were not moved.

## Implemented engine behavior

- One durable `observed=True` row per approved ambient WhatsApp group message,
  with original timestamp/message id and sender/chat provenance.
- No agent dispatch on passive observation.
- Addressed non-command turns share the group session; commands retain real
  sender identity for slash authorization.
- Text debounce is keyed by raw `(profile, chatId, senderId)`, so different
  residents cannot merge into one turn.
- Observed rows are always excluded from replay as user requests.
- Only an observer-marked addressed group turn may render the last 50 observed
  rows as context-only. Markerless cron/send_message/non-adapter dispatch gets
  no observed chatter.
- Durable mode suppresses the duplicate RAM context. The legacy RAM backfill
  remains when durable observation is inactive for the chat.

Engine validation: 174 passed, 2 skipped; Ruff and diff-check clean.

## Implemented product behavior

- Separate `%LOCALAPPDATA%\TachlesCommunity` root/home/engine/contract.
- Exact tag and SHA verification; desktop updater refuses pinned/fork mutation.
- `community-archive` plugin reads only process-root `state.db`, read-only,
  with exact server policy allowlist. Actions: recent/search/count, group/date
  filters, keyset pagination, unique senders, provenance/evidence.
- Plugin files and registration are mirrored into the shared routed profile;
  isolated profiles get neither the files nor the tool.
- `session_search` is disabled in root and profiles.
- Generated `home/.tachles-community.json` is the explicit activation marker.
  Missing/malformed/inactive markers fall back to business Hermes, so stale
  directories cannot hijack QR/OAuth.
- QR/provider UI displays the exact target: main business Hermes or isolated
  community Hermes. Provider UI waits for target resolution. Business catalog
  failure retains static API-key fallback; active community startup failure
  blocks instead of leaking a key to business.
- Community provider bridge exposes only QR + OAuth/device flow + model set;
  it does not expose generic `/api/env` and never copies/symlinks `auth.json`.
- After model set, canonical generation mirrors the root model to profiles and
  restarts the hash-scoped gateway.
- Gateway start failures are retryable and `gatewayStarted` is enforced.
- Generator uses `process.execPath` with `ELECTRON_RUN_AS_NODE=1`.
- `whatsapp.group_user_allowed_commands=[]` is owned and drift-checked.
- Packaged js-yaml includes `dist/**/*`; argparse includes `argparse.js`.

Canonical execution plan:
`docs/specs/community-whatsapp-execution-plan.md`.

## Validation already completed

- Full unit: 211 files, 2,138 passed, 1 skipped.
- `npm run test:contract`: Python business policy 74, dashboard 7,
  community archive 15, plugin contract, and bootstrap 114/114 passed.
- `npx tsc -b --pretty false`: passed.
- `npm run build`: passed (only existing >500 kB chunk warning).
- `npm run build:test-packaged`: passed; produced `release/win-unpacked`.
- Real packaged payload imports succeeded for
  `resources/business-bootstrap/community/node_modules/js-yaml/dist/js-yaml.mjs`
  and `argparse/argparse.js`.
- Local NSIS pilot candidate built successfully:
  `C:\projects\hermes-business-poc\release\Tachles-Setup-0.4.0-alpha.4.exe`
  - size: 104,264,189 bytes
  - SHA-256: `523DB19446CAE2015C4CC57928BCCDEDF6F68BDFF5C79D037E14A2B9C8F826C1`

This installer is a local **unpromoted pilot candidate**. The official
`package:win:pilot` release gate still rejects stale committed live-evidence
fingerprints from the previous Hermes compatibility range. Do not bypass that
gate or describe the candidate as fully attested.

## Current upstream PR state

- #85490 OPEN, mergeable, head `fc07f59e49`: durable WhatsApp observer plus
  exactly-once bounded immediate context.
- #85832 OPEN, mergeable, head `2d28fd5554`: keep operator notices out of groups.
- #87626 OPEN draft, mergeable, head `75ce097c7e`: routed LID + slash identity.
- #75743 OPEN, mergeable: earlier device-suffix normalization PR.
- #78441 OPEN, mergeable: earlier/broader Codex poll retry.
- #63649 OPEN, mergeable: earlier/broader Baileys getMessage fix.
- Our duplicate drafts #87632 and #87633 were closed on 2026-08-16 with clear
  comments in favor of #78441 and #63649 after maintainer triage.

Use thread-aware GitHub review reads before replying. Do not reopen duplicate
PRs. Watch #85490/#85832/#87626 and address justified review feedback with
focused tests.

## Working tree and ownership warning

The product tree is intentionally dirty with the full implementation and has
not been committed yet. Preserve all relevant modified/new community files.
Do not include or delete unrelated user-owned untracked paths:

- `.artifacts/`
- `.claude/`
- `docs/evidence/forensics/live-mutation-49104.json`
- `promo-video/hermes-handoff/`
- `promo-video/public/`

Use `git diff --check` and review the complete scoped diff before an intentional
commit. Do not reset/checkout user changes.

## Remaining work, in priority order

1. Review the complete product diff for cohesion/security and commit the
   intended implementation without the unrelated untracked paths above.
2. Run a fresh-home first-boot smoke against the pinned engine proving the
   routed shared profile actually exposes `community_archive`, while an
   isolated profile does not.
3. Run real-account pilot E2E when credentials/phone are available:
   provider OAuth, QR pairing, approved ambient message => zero outbound,
   restart persistence, addressed question in another group => archive tool
   retrieval with provenance, deterministic unique-sender count, non-admin
   slash denial, disallowed group => neither archive nor response.
4. Recapture/update release evidence only from those real runs. Then rerun the
   official `npm run package:win:pilot`; do not hand-edit fingerprints merely
   to make the gate pass.
5. If live credentials are not available, keep the current installer clearly
   labelled unpromoted and report exactly which E2E assertions remain unproven.
6. Continue maintaining the three non-duplicate upstream PRs and keep the
   product pin until their required changes land in an official Hermes release.

## Guardrails

- No Vercel deploy/redeploy.
- No new dashboard.
- No second DB/vector store/RAG service.
- No auth.json copying between business and community homes.
- No claims of full release readiness without live WhatsApp/OAuth evidence.
- Prefer Hermes skills/tools/Cron and small replaceable adapters.

