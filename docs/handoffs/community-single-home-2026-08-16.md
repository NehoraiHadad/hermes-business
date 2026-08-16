# Tachles community — single-home migration handoff

Date: 2026-08-16 (Asia/Jerusalem). Supersedes
[community-release-2026-08-16.md](community-release-2026-08-16.md).

## The user's architecture decision (authoritative)

Two Hermes runtimes/homes are REJECTED. Tachles is a thin wrapper that
introduces settings and tools to the user's ONE Hermes — it is never a second
installation. Guiding principle (user, 2026-08-16): use Hermes' own
capabilities wherever they exist; add or simplify ONLY where Hermes has no
native mechanism.

Target: one Hermes installation, one gateway, one WhatsApp connection, one
`HERMES_HOME`, using native profiles + `profile_routes`, scoped tools, and the
existing `state.db`.

## Native-mechanism audit (verified against 0.20.1 source)

Native and therefore USED as-is: `hermes profile create/delete/list/switch`
(full lifecycle incl. `--no-alias --no-skills`), `hermes config set` (nested
dotted keys, list indices, env-key routing to `.env` with rotation),
`profile_routes` + `multiplex_profiles` + `_profile_runtime_scope`,
`get_process_hermes_home()` (lets the archive plugin read the ROOT `state.db`
from routed turns), skills/SOUL.md conventions, Hermes Cron.

Verified NOT native (the only things Tachles adds): a routes/fences
declarative apply+verify (a missing profile config silently reopens the FULL
default toolset — fences must be deterministic, never LLM-assembled), the
scoped `community_archive` read-only tool, and WhatsApp passive observation
(exists only for Telegram; `gateway/config.py:1639` gates it to
`Platform.TELEGRAM`).

`managed_scope` exists but is POSIX-first (v1 `/etc/hermes`; Windows only via
`HERMES_MANAGED_DIR`, filesystem-permission enforcement) — not used now.

## Engine strategy (user chose option A)

Official install + pinned overlay. Facts verified:

- The official installer does `git clone` + `uv pip install -e .` (editable,
  `scripts/install.ps1:2089,2565`) — a checkout takes effect with NO reinstall.
- The fork `community-engine-v0.2.2` =
  `af04eb8bb85e0a5b6333cd0104921b7e49bcf1f9` is official `v2026.8.13` (0.20.1)
  + 4 commits, ZERO dependency drift. It touches core gateway files
  (`gateway/run.py`, `session.py`, `turn_context.py`, `authz_mixin.py`,
  `slash_access.py`) so it CANNOT ship as a plugin — that is why the overlay
  exists at all.
- The overlay: `git fetch <fork-url> refs/tags/community-engine-v0.2.2` +
  `git checkout --detach <sha>` in the SAME official checkout. Idempotent, no
  remote bookkeeping. `electron/hermes-compat.cjs` `isPinnedGitInstall`
  classifies detached/non-upstream as 'pinned' and REFUSES auto-update.
- When upstream PR #85490 merges into an official release: delete the overlay
  step; `git checkout main` restores stock.
- UNVERIFIED RISK: whether official installer re-runs (`-Ensure`, update
  flows) reset the checkout off the pinned SHA. Check before shipping.

## What was implemented in this migration

- DELETED the two-runtime wrapper (preserved on `archive/two-runtime-506c378`):
  `electron/community-runtime{,-config}.cjs` + tests,
  `src/lib/hermes/community-provider.ts` + test, ProviderModal/
  WhatsappConnect/useWhatsappOnboarding community branches (reverted to
  `28d2452` versions), the `.tachles-community.json` activation marker, IPC
  handlers `hermes:community:*`, preload bridges, `CommunityRuntimeState`.
- `scripts/lib/community/generate.mjs` — ADDITIVE root ownership:
  - allow/admin lists + `mention_patterns`: UNION with existing, never replace;
  - `dm_policy`, `platform_toolsets.whatsapp` (ADMIN_TOOLSET),
    `memory/skills.write_approval`, `history_backfill{,_limit}`: set ONLY if
    absent;
  - OWNED exact fences: `group_policy: allowlist`, `require_mention`,
    `group_user_allowed_commands: []`, `observe_*` (retention list = exact
    non-isolated contract groups, never unioned);
  - `profile_routes`: foreign routes survive; whatsapp routes claimed by the
    contract (our space slugs or contract group ids) are regenerated;
  - root NO LONGER disables `session_search` (owner keeps it); profiles still
    disable it and pin fenced toolsets.
- `scripts/lib/community/verify.mjs` — FIXPOINT verification:
  `expectedOwnedView(contract, diskText)` = re-running the generator on the
  disk config must be a no-op on owned keys. Owner additions verify clean; a
  dropped admin/fence breaks the fixpoint → drift. Unparseable YAML → drift,
  not throw. Root owned view no longer asserts session_search-disabled.
- `scripts/lib/community/provision.mjs` — new plan: `official-install` gate
  (no commands; ZIP/non-git installs fail closed) → `engine-overlay` →
  `profile-create:<slug>` per space (native `hermes profile create`) →
  `home-generate` → `gateway-service`; report-only auth/pairing unchanged.
  Layout: `homeDir` = the real HERMES_HOME; `engineDir` =
  `<home>/hermes-agent`; venv = `<engine>/venv` (official names). No clone, no
  venv-create, no pip, no npm, no python discovery. Forbidden roots now
  protect the dev checkouts (`hermes-agent`, `-community-release`,
  `-upstream-audit`, pilot) — NOT `%LOCALAPPDATA%\hermes`, which is the target.
- `scripts/community-provision.mjs` CLI: `--home` (defaults to
  `%HERMES_HOME%` then `%LOCALAPPDATA%\hermes`), `--engine-dir` override,
  `--root` removed; parses+validates the contract and passes `spaces` into the
  plan; only external tool needed is git.
- `installer/lib/BusinessInstall.ps1`: community skills render against the ONE
  home (`{{HOME_DIR}}`=$HermesHome, `{{INSTALL_ROOT}}`=<home>\hermes-agent,
  contract at `<home>\tachles\community.yaml`); TachlesCommunity removed.
- Skill templates + docs updated to single-home language.
- KEPT unchanged and still valid: `hermes-plugin/community-archive/` (reads
  process-root state.db — correct in single-home), persona/contract/apply,
  model mirroring into profiles, packaged payload staging (NSI +
  extraResources + plugin-install.cjs + e2e bootstrap scripts), compat
  widening to `>=0.19.0 <0.21.0` @ 0.20.1, `isPinnedGitInstall` (now protects
  the user's ONLY Hermes), `Hashing.ps1` framework-direct SHA-256.

Validation: tsc clean; full unit 206 files / 2,119 passed, 1 skipped;
community lib 189 passed (fixpoint + additive semantics covered).

## Remaining work, in priority order

1. Commit the single-home migration (exclude `.artifacts/`, `.claude/`,
   `docs/evidence/forensics/live-mutation-49104.json`, `promo-video/*` —
   user-owned untracked paths).
2. Verify the unresolved overlay risk: does an official installer re-run /
   `hermes update` path reset the pinned SHA? (`isPinnedGitInstall` covers the
   desktop updater; the bootstrap `-Ensure` path is the open question.)
3. Fresh-home first-boot smoke: official install → overlay → contract apply →
   prove the routed shared profile exposes `community_archive`, an isolated
   profile does not, and the business owner's existing toolset/model survive.
4. Real-account pilot E2E (unchanged list from the previous handoff): ambient
   observe with zero outbound, restart persistence, cross-group archive
   retrieval with provenance, deterministic unique-sender count, non-admin
   slash denial, disallowed group silent.
5. Recapture release evidence from real runs only; rerun
   `npm run package:win:pilot`; never hand-edit fingerprints. The
   0.4.0-alpha.4 installer predates this migration — it is now DOUBLY stale
   and must not be promoted.
6. Maintain upstream PRs #85490 / #85832 / #87626; drop the overlay when the
   observer lands in an official release.

## Guardrails (carried forward + new)

- No second runtime/home/DB/dashboard/RAG; no Vercel deploys.
- Community config merges must stay ADDITIVE on shared keys; never overwrite
  an owner's explicit configuration; fences stay generator-owned and
  deterministic.
- No `auth.json` copying, ever.
- No release-readiness claims without live WhatsApp/OAuth evidence.
