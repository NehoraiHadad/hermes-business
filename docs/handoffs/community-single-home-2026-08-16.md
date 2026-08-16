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
- OVERLAY-RESET RISK — RESOLVED 2026-08-16 by source reading:
  * Tachles bootstrap re-run: SAFE — `Install-LatestCompatibleHermes` runs
    only when `Find-Hermes` finds nothing (bootstrap.ps1:100); an existing
    install is used as-is.
  * Desktop-UI update: SAFE — `isPinnedGitInstall` → 'pinned' → refusal.
  * Manual/agent `hermes update` in a terminal: UNPINS (update_cmd.py:4096 —
    detached HEAD → warns and switches to main). Mitigated in depth: the
    community-admin skill now forbids engine-moving commands outright, and
    provisioning verify detects HEAD≠SHA (engine-overlay check) with apply
    re-pinning as the sanctioned recovery.
  * Manual official `install.ps1 -Tag` on an existing checkout: would unpin
    (fetch + `checkout --detach refs/tags/<tag>`); nothing in the product
    invokes it when Hermes exists — documented residual.

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

## DM model (2026-08-16, later same day: "מי אמר ש-DM == מנהל")

DM == admin was a two-home-era assumption and is DEAD. The model now:
- A third routed space `profiles/admin/` (reserved slug): each contract
  admin's DM (`<msisdn>@s.whatsapp.net`) routes there — ADMIN_TOOLSET,
  management skills, archive, session_search kept (scoped to that home).
  Routing on DMs is engine-native (`_profile_name_for_source`, run.py:26022 —
  chat_id match with no group precondition).
- `community.dms` contract field chooses between two NATIVE intake postures
  (whatsapp_common.py: dm_policy gates at intake, strangers never reach the
  model): 'admins' (DEFAULT — dm_policy=allowlist, unknown senders filtered
  mechanically) or 'open' (explicit opt-in — residents' DMs route via a
  platform-only fallback route to the fenced `village` persona: same scoped
  tools and knowledge as the groups, in private).
- The ROOT config no longer seeds any toolset and no DM ever lands in the
  owner's default profile; root keeps session_search and its own toolset.
- A business "public agent" DM model is explicitly deferred (user decision).

## Fresh-home smoke — PASSED 2026-08-16 (scratch, no live account)

Real official checkout (v2026.8.13) + venv + `pip install -e .` in a scratch
HERMES_HOME; pre-existing owner config (model, toolset, DM contact) seeded
first. Results: generator merged ADDITIVELY (owner keys survived, admins
unioned); provision plan gated correctly; apply executed ONLY engine-overlay
(fetch fork tag by URL + detach → HEAD == pinned SHA; observer code live in
the editable checkout; idempotent re-run does nothing); per-scope engine-level
proof: archive plugin files+registration+check_fn PASS for root/village/admin,
all three absent/disabled for the isolated space. Minor finding: the
gateway-service `is_installed` check was satisfied on the scratch home —
likely the dev machine's Startup-fallback registration is not home-scoped;
re-verify on a clean machine.

## Live-machine findings (2026-08-16, evening)

- WhatsApp pairing on the live home is ALIVE: number 972552610571 ("Test_1",
  `me_id 972552610571:44@s.whatsapp.net`), QR-scanned before 2026-08-04,
  survived 12 days offline — gateway started 2026-08-16 16:21 and the bridge
  reports connected with `WHATSAPP_DM_POLICY=pairing` (strangers filtered).
  No rescan needed for the pilot E2E. (Note: linked devices expire around ~14
  offline days — keep the gateway's auto-start registered so it never idles
  that long again.)
- The live engine is an official SHALLOW clone at 0.19.1 (`main`, grafted)
  with a 0.19.1-pinned venv. The overlay is based on 0.20.1 — and the
  dependency pins MOVED between those versions (cryptography 48.0.1→50.0.0,
  Pillow 12.2.0→12.3.0, nemo-relay 0.6→0.7.1). A checkout alone would run
  0.20.1 code on 0.19.1 deps. FIXED in the provisioner: new `engine-deps`
  step after `engine-overlay` — when the venv's install-time dist metadata
  version != the checkout's pyproject version, it re-runs the OFFICIAL
  installer command `uv pip install -e .` (uv preferred from `<home>\bin\
  uv.exe` then PATH — it honors the pyproject's `[tool.uv]`
  override-dependencies, which plain pip cannot; venv pip is the last-resort
  fallback). Idempotent; on a fresh 0.20.1 install the step is skipped.
- The live checkout has local modifications in `website/i18n/**` docs (likely
  line-ending noise) — verify `git checkout --detach` is not blocked by them
  before the live overlay; if it is, stash is acceptable (docs-only paths).

## Live pilot E2E (2026-08-16 evening) — CORE ASSERTIONS PASSED

Confirmed live on the real account (bot 972552610571, admin 972547401660,
group 120363428948689789@g.us):
1. Ambient message without the wake word → SILENT + durably observed.
2. "הרמס בדיקה" → routed village turn → real reply SENT to the group
   ("הבדיקה התקבלה 🙂 אני פעיל.").
3. Admin DM (LID-presenting) → routed to the ADMIN space, management
   persona replied, community-admin skill loaded — never the owner profile.
4. Archive query "הרמס מה נכתב בקבוצה?" → community_archive recent →
   full provenance + untrusted_evidence marker → reply LISTING the silently
   observed message. Observe→archive→retrieval chain proven end-to-end.
5. Family group (NOT in the contract): user confirmed ZERO bot responses
   all day — the negative fence holds.
Still pending (non-blocking follow-ups): full-restart persistence (several
restarts already survived incl. pairing), non-admin slash denial,
deterministic count, dms:open resident flow (known egress-gate gap). THREE live-only fixes were required (below) — all committed
(f7e59c6, cb6fbb0, 2da8b55) and re-verified by tests (203 community lib).

Operational notes: WHATSAPP_DEBUG diag flag added and REMOVED from root
.env; gateway returned to normal service mode. Bridge-zombie pattern: a
gateway restart can leave the old bridge holding port 3000 while the new
spawn briefly connects to WhatsApp and invalidates the survivor's socket —
messages then queue server-side and later arrive as 'append' (deliberately
ignored as stale). Remedy: kill the orphan bridge + one clean start;
worth an upstream issue. Offline-redelivered ('append') messages are
intentionally not dispatched.

### The three live-only fixes (why unit/smoke could not catch them)
1. EGRESS: the companion gate (business-whatsapp-policy) governs ALL
   WhatsApp outbound; community chats needed generator-owned
   community_sources (owner surface untouched).
2. INTAKE AUTHZ: triggered group messages carry NO user_id (shared
   transcript strips sender identity); only chat-scoped
   WHATSAPP_GROUP_ALLOWED_USERS authorizes them, read from the PROCESS env
   (the check runs before the profile secret scope exists) — generator now
   owns it in the ROOT .env + per-space profiles/<slug>/.env; env
   verification is contract-aware (static-only view masked the gap).
   UPSTREAM-WORTHY: config whatsapp.group_allow_from is not consulted by
   authz_mixin for routed turns.
3. LID ROUTING: DM chat_ids present as <lid>@lid; route matching is exact
   string compare (profile_routing.py:102). Generator reads the engine's
   own lid-mapping-<msisdn>.json (best-effort) and emits a second admin
   route in LID form + LID grants in the egress gate and admin env.
   UPSTREAM-WORTHY: routing should resolve LIDs via the engine's mapping.

## E2E session log (earlier same evening — kept for context)

Contract applied to the LIVE home (user-authorized): group "נסיון - הרמס -
תכלס קהילה" `120363428948689789@g.us` → village, admin 972547401660 → admin
space, dms=admins; the family group `972523664504-1386456762@g.us` is
deliberately OUT of the contract (negative test). Overlay + engine-deps ran
exactly as designed (0.19.1→0.20.1, cryptography 48→50). Gateway restarted:
whatsapp+telegram connected, multiplex ticks default/admin/village.

VERIFIED LIVE: ambient group message observed with no trigger (session
`20260816_180504_aaa4d41c`, profile_name=village, NO_REPLY stored).

FOUND+FIXED live: the companion business-whatsapp-policy egress gate skipped
the first triggered reply (`pre_gateway_dispatch skip:
business_whatsapp_read_only`) — the owner-surface policy (selected_chats/
monitor + stale placeholder sources) governs ALL WhatsApp egress and community
turns share the gateway process. Fix: new generator-owned `community_sources`
section in `business/whatsapp-policy.json` (exact contract groups + admin
DMs, regenerated each apply, owner mode/behavior/sources preserved verbatim,
unparseable file refused) + plugin `can_process`/`can_reply` grant community
chats regardless of owner mode. KNOWN GAP: dms 'open' resident PRIVATE
replies cannot be enumerated → still egress-blocked (groups unaffected);
needs a dm-open grant flag if/when a community opts into open DMs.

Group-discovery note: Tachles' native mechanism (readWhatsappDirectory ←
official channel_directory.json) was consulted FIRST and was legitimately
empty (Hermes only lists processed channels; groups were never allowed
before). Bootstrap fallback used: user sends a message in the group, JID
recovered from the Baileys session sender-key files
(platforms/whatsapp/session/sender-key-<jid>--*.json) + bridge /chat/:id for
the friendly name. After first processed group turn the directory lists it.

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
   observer lands in an official release. 2026-08-16 evening status: all
   three OPEN + MERGEABLE, each carries an AI review (author-optional).
   Posted: full live-E2E validation on #85490 (with commitments: collapse
   body newlines, document native-bridge-only backfill, watermark/merge
   comments) and the routing-layer LID gap on #87626 (offered a follow-up
   PR: route matching should expand WhatsApp aliases). Filed issues:
   #87830 (routed-turn authz ignores config group_allow_from — env-only,
   silent drop), #87833 (restart orphans the bridge → silent inbound loss,
   Windows), #87834 (bridge /groups listing endpoint for discovery).
   #85832's review points (lazy private import + ""-as-DM, regex vs scope
   gate duality, identity-compare fragility) are noted as fork follow-ups.

## Negative-control fence test — PASSED with positive evidence (21:02)

The "disallowed group stays silent" assertion now has AFFIRMATIVE proof, not
just absence of a reply. Test group: "נסיון 2" (`120363418867938143@g.us`,
only the admin + bot as members — replaces the family group as the negative
control; created fresh, deliberately NOT added to the contract).

- Pre-check: the JID appears NOWHERE in config.yaml, .env, profile_routes,
  business/whatsapp-policy.json, profiles/**, or community.yaml.
- Arrival proven: the gateway ran foreground `-vv` (full DEBUG); the admin
  sent a wake-word message ("הרמס …") in נסיון 2 at 21:02:08 — the Baileys
  sender-key ratchet file for that JID advanced at exactly that time, i.e.
  our bridge received and decrypted the message.
- Zero processing proven: the full DEBUG log contains NOT ONE line mentioning
  the JID — dropped before even the `inbound message:` log point (adapter
  group gate). No session file, no community/ archive row, no outbound send.
- Positive control in the same minute: the same wake-word in the contract
  trial group was routed to the village profile, processed (11.0s, 1 API
  call) and replied — so the pipeline was demonstrably live while נסיון 2
  was refused.

## Operational findings 2026-08-16 evening (post-E2E)

- Gateway died with the closing terminal session a THIRD time, and the
  Startup login item turned out to be a STALE QA LEAK: Hermes_Gateway.vbs in
  the user's real Startup folder pointed at a deleted temp QA home
  (`hermes-qa-home-wMWeiM`) and quit silently — so logon recovery was dead
  too. Root cause to chase: the packaged-E2E QA runtime override ran
  `gateway install` against the QA home and overwrote the real login item.
  Fixed live via official `hermes gateway install` (Startup-folder fallback;
  Scheduled Task needs UAC). FOLLOW-UP: make the QA harness suppress/redirect
  gateway install, and add a check that the login item targets the live home.
- Orphan-bridge pattern (#87833) reproduced again on `gateway stop`: port
  3000 still held by a dead run's bridge; killed before clean restart.

- No second runtime/home/DB/dashboard/RAG; no Vercel deploys.
- Community config merges must stay ADDITIVE on shared keys; never overwrite
  an owner's explicit configuration; fences stay generator-owned and
  deterministic.
- No `auth.json` copying, ever.
- No release-readiness claims without live WhatsApp/OAuth evidence.
