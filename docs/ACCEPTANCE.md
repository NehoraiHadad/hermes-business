# ACCEPTANCE — העוזר לעסק (Alpha)

Canonical, **tracked** acceptance report for the local Windows business
companion/shell over **Hermes** (the full-access agent engine: runtime, memory,
scheduler, skills, connectors). This is a **local MVP / pilot-ready Alpha** — not
a POC, and not a signed production release.

> **Scope of this file.** This is the durable, source-controlled record of *what
> was validated and how*. The exact build artifacts (installer/app `.exe`,
> `app.asar`, their byte sizes and SHA-256 digests) and the full byte-level
> capture live next to the binaries in **`release/ACCEPTANCE.md`**, which — like
> everything under `release/` — is **git-ignored and local only** (see
> `.gitignore`). Those digests are volatile per build and are deliberately *not*
> duplicated here; regenerate them locally from the release tree when you cut a
> build. This tracked report is the single canonical source for the gate
> semantics, the E2E matrix, and the remaining external gates.

- **Product:** העוזר לעסק — Hermes is described honestly as the engine with full
  access; the product name is **העוזר לעסק**.
- **Version line:** 0.3.x Alpha.
- **Toolchain (reference):** Node 22 · Python 3.13 · Electron 43 ·
  electron-builder 26 · Vite 6 · Vitest 4. Exact patch versions and the git HEAD
  at each acceptance run are recorded in the local `release/ACCEPTANCE.md`.
- **Platform:** Windows 11 x64.

**Secrets discipline.** Every external/live check is redacted before display. No
token, OAuth code, API key, or email address appears in this document or in any
captured log. The only secret-shaped strings in the tree are known fake fixtures
inside redaction unit tests that assert the app strips secret shapes.

---

## 1. Product metadata — POC → honest Alpha

Misleading "POC" labels were removed from **user-facing** metadata and UI while
keeping honest Alpha positioning. The bundled desktop plugin
(`hermes-plugin/business-shell/plugin.js`) was rebuilt from source with **0**
user-facing `POC` occurrences. Remaining `POC` strings are non-user-facing
engineering history (`docs/hermes-integration.md`) and deterministic
test/fixture identifiers (`poc-weekly-lead-summary`, `POC E2E …` markers),
intentionally retained.

The QA demo capability is derived from the Vite build **mode**
(`vite.config.ts`, `--mode qa` → `VITE_ALLOW_DEMO`); there is no `.env.qa` file.
Icon resources are verified against `build/icon.ico` and are embedded in the app
exe, installer, uninstaller, and shortcut.

---

## 2. Deterministic gates — reproducible locally

Run these from a clean checkout; they are the authoritative, non-volatile gates.

| Gate | Command | Expectation |
|---|---|---|
| Unit/integration (incl. e2e-harness tests) | `npm test` (vitest) | All files pass (1 intentional skip) |
| Renderer + main-process compat/update flow | included in `npm test` | Post-update compat re-gate + rollback ordering covered |
| Python policy + installed-contract | `python -m unittest discover … tests` | All tests OK |
| TypeScript + production build | `npm run build` (`tsc -b` + `vite build`) | Clean build, demo baked **off** (`VITE_ALLOW_DEMO:""`) |
| Plugin contract | `npm run verify:plugin` | Shipped `plugin.js` up to date, contract checks pass |
| Bootstrap (deterministic + live report) | `npm run verify:bootstrap` | All deterministic checks pass + external live probe |
| Secret scan (tracked + untracked source) | see §6 | Clean (only redaction-test fixtures) |

**Compatibility policy is single-sourced.** `hermes-compat.json` is the canonical
source of truth for the supported range (`>=0.19.0 <0.20.0`); every mirror
(renderer `src/lib/hermes/compat.ts`, `electron/hermes-compat.cjs`, the plugin
SDK contract, installer/Release) is asserted against it by
`src/lib/hermes-compat-policy.test.ts`, which fails on any drift.

**Update/recovery is fail-closed and re-gated.** The official self-update runs
`preflight → stop → backup → mutate → recover`, and — authoritatively — resolves
the **actually running** Hermes version after update/recovery and enforces
`hermes-compat.json` **before** success is reported
(`electron/hermes-compat.cjs` `assertRunningVersionSupported`,
`electron/hermes-update-flow.cjs`). An unsupported or unresolvable landed version
fails closed and rolls back to the pre-update anchor; user state
(`sessions/`, `skills/`, `memories/`, `state.db`) lives outside the checkout and
is never touched. Covered by `electron/hermes-update-flow.test.ts` and
`electron/hermes-compat.test.ts` (supported / unsupported / unresolvable).

---

## 3. Build artifacts — local & ignored

The production companion installer, the QA (demo-enabled, non-distributable)
build, and the thin bootstrap live under **`release/`**, which is git-ignored.
They are **not** tracked in this repository, and their per-build byte sizes and
SHA-256 digests are recorded in the local `release/ACCEPTANCE.md`, not here.

Durable facts about those artifacts:

- **Production companion** — NSIS one-per-user installer (electron-builder);
  bundle bakes `VITE_ALLOW_DEMO:""` so demo fixtures are **inert**.
- **QA companion** — `vite build --mode qa` + `electron-builder --dir`
  (unpacked only, no installer), the **only** build allowed to serve `?demo=1`
  fixtures; clearly marked `DO-NOT-DISTRIBUTE` and must be deleted before release.
- **Thin bootstrap (production NSIS)** — a **release gate, not produced**:
  `build-bootstrap.ps1` hard-requires `HERMES_BUSINESS_COMPANION_URL` +
  `HERMES_BUSINESS_COMPANION_SHA256`, which are not configured and were not
  invented. Its logic is validated independently by `verify:bootstrap`.
- **Thin bootstrap (QA, host-agnostic)** — **produced** by
  `npm run package:thin-installer:qa` →
  `release/qa-thin-installer-DO-NOT-DISTRIBUTE/` (git-ignored): a small
  portable-zip companion payload (`companion.zip`) plus a
  `companion-release.json` whose `url` is a **placeholder** (`format: "zip"`,
  real SHA-256, plus a deterministic `entrypoint`). It exists only so the
  download→verify→**safe-extract** pipeline can be exercised end-to-end without a
  published endpoint; it is **not** signed and **not** distributable. The
  manifest's `format` field (`nsis` default | `zip`), the required `entrypoint`
  for the `zip` format (a strictly-validated relative path to the app `.exe`),
  and the caller-supplied companion install root are the stable contract that
  makes this host-agnostic path possible without altering production behaviour.
  The `zip` payload is treated as untrusted content: every archive entry is
  validated before any byte is written (absolute/drive/UNC/traversal/colon-ADS/
  reserved-name/symlink entries are refused), extraction lands in a staging
  directory and is atomically promoted only after the whole archive validates,
  and the launched executable is the manifest `entrypoint` — never a scan of the
  archive's contents. The install root is a **caller** parameter and cannot be
  injected via the manifest. NSIS placement is unchanged (its trusted installer
  owns it).

---

## 4. Safe packaged E2Es (isolated temp userData/HERMES_HOME)

| Scenario | Build | Isolation | Result |
|---|---|---|---|
| Production degraded / no-Hermes path | production win-unpacked | temp HERMES_HOME + userData, auto-cleaned | **PASS** — fails closed to install prompt; no fabricated data |
| Production demo-INERT proof | production win-unpacked | temp HERMES_HOME + userData | **PASS** — `?demo=1` yields **no** fabricated reply |
| QA demo-only chat | QA companion | temp userData | **PASS** — demo transport echoes + replies |
| QA demo-only attachment flow | QA companion | temp userData + fixture | **PASS** — pick/remove chip + attachment-only send |
| Partner-sandbox degraded guard (Docker stopped) | unit-covered | n/a | **PASS via unit tests** — Docker request fails closed to local guard |
| **Thin network installer (hermetic)** | portable-zip QA artifact | throwaway temp `install` root + temp `HERMES_HOME`, loopback HTTP server, auto-cleaned | **PASS** — see below |

**Hermetic thin-installer E2E** (`npm run test:e2e:thin-installer`,
`scripts/e2e-thin-network-installer.ps1`). Fully self-contained: it builds small
portable-zip artifacts and serves them + manifests over a **repo-native loopback
static server** (`scripts/lib/static-file-server.ps1`, a TcpListener HTTP/1.1
server — **no Python / no external runtime**; the previous undocumented
`python -m http.server` dependency was removed). The HTTPS contract is enforced
in code; loopback HTTP is allowed only via `-AllowInsecureUrl`, exactly as
production requires `https`. It runs the same `Install-BusinessCompanion` /
`Save-HttpFile` / `Expand-ArchiveSafely` code the real bootstrap uses, never
touches the live per-user profile or Hermes install, and downloads/safe-extracts
into an **isolated** install root with an isolated `HERMES_HOME`. Helpers live in
`scripts/lib/e2e-thin-installer-lib.ps1` to keep the orchestrator small. Proven
cases (all green):

1. **download + verify + safe-extract** — artifact fetched over loopback, exact
   SHA-256 verified, safe-extracted into the isolated root; the launched exe is
   the manifest **`entrypoint`**, asserted **inside** that root.
2. **existing Hermes user state preserved** — a pre-seeded `sessions/state.db` is
   byte-identical (same SHA-256) before and after.
3. **hash mismatch fails closed** — a manifest with a wrong `sha256` raises a
   mismatch/tamper error and produces **no** executable.
4. **network failure fails closed** — a dead endpoint exhausts bounded retries
   and raises guided offline copy; **no** executable is produced.
5. **HTTPS contract enforced** — a plain-HTTP manifest without `-AllowInsecureUrl`
   is rejected with an HTTPS-required error.
6. **non-loopback HTTP rejected** — a plain-HTTP companion URL to a non-loopback
   host is rejected **even with** `-AllowInsecureUrl` (the override is loopback-only).
7. **zip-slip refused** — a hostile archive carrying a traversal entry that
   resembles a Hermes state path (`../../../../hermes-home/sessions/state.db`)
   fails closed; nothing is promoted and the pre-seeded state is byte-unchanged.
8. **manifest cannot inject the install root** — a manifest with `installRoot` /
   `destination` / `path` fields is ignored; extraction uses the **caller's**
   root and the manifest-named path is never created.
9. **deterministic entrypoint** — an archive with a larger decoy `*.exe` resolves
   the small manifest `entrypoint`, proving the old "largest recursive exe wins"
   selection is gone (the decoy is extracted but never selected).

Cleanup is verified: the run directory is removed and no static-server process is
left behind. The offline unit gate `scripts/test-bootstrap-lib.ps1` (part of
`npm run verify:bootstrap`) additionally covers, without any network: MaxBytes
enforcement **during** streaming (an over-ceiling body is rejected mid-stream and
leaves no partial `.part` file), safe-extraction of a benign archive with atomic
promote, zip-slip refusal, the `zip`-requires-`entrypoint` contract, entrypoint
shape validation, and fail-closed when the entrypoint is absent after extraction.

**Not run for safety (mutation risk, not isolatable):** `e2e-installed-partner-ui`
(activates a personality that needs a real Hermes install). Its safety-critical
assertions are covered green by unit tests (`partner-mode`, `sandbox-config`,
`partner-settings`, `business-partner`).

### 4a. Installed-Hermes shared-state E2E (isolated home, official surfaces)

`e2e-hermes` and the new `e2e-hermes-shared-state` are **no longer** excluded for
mutation risk: they now run the **installed** Hermes binary
(`%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe`) against a
**throwaway** `HERMES_HOME` created with `mkdtemp` under the OS temp dir. A
safety guard (`scripts/lib/hermes-shared-home.mjs` → `assertNotLiveHome`,
unit-tested) refuses to start if `HERMES_HOME` is, or is inside, the live profile
`%LOCALAPPDATA%\hermes`; the server is spawned with an offline channel overlay
(`WHATSAPP_/TELEGRAM_/EMAIL_/SLACK_/…_ENABLED=0`) so no Telegram/WhatsApp/email/
Google action can fire. The previous `resolveHermesBinary()` default (which
pointed `HERMES_HOME` at the live profile) was the mutation-risk gap — now fixed.

**One runtime, one isolated home — both the wrapper contract and the official
surfaces.** A single `hermes serve` (headless gateway = the exact backend the
desktop app runs; `hermes_cli/subcommands/dashboard.py`) exposes both the
WebSocket JSON-RPC gateway (`/api/ws`, `tui_gateway/server.py`) and the REST
routers (`hermes_cli/web_routers/{cron,skills,sessions}.py`). The business
companion ("wrapper") speaks exactly these: RPC via `src/lib/hermes/session.ts`
and REST via `src/lib/hermes/rest-*.ts`.

| Requirement | How proven against installed Hermes | Evidence (redacted JSON) |
|---|---|---|
| ONE install + ONE isolated `HERMES_HOME` for both contracts | binary from install tree; home = `%TEMP%\hermes-e2e-home-*`; live home printed as untouched | `one_runtime.{install_root, isolated_home, live_home_untouched}` |
| Session created via wrapper RPC is visible on official surfaces | `session.create` (wrapper RPC) → `GET /api/sessions` (official REST) **and** `session.list` (official RPC) both return the stored id | `session_shared_state.{visible_via_rest, visible_via_rpc_list}=true` |
| Streaming event parsing (official behavior) | `prompt.submit` → real `message.delta` stream + `message.complete`; marker persisted and returned by `session.resume` | `live_transport.streaming.delta_events` (6–10), `marker_streamed_and_persisted=true` |
| Stop/cancel (official behavior) | `session.interrupt` on an in-flight reply | `live_transport.interrupt.status="interrupted"` |
| Tool activity mapped, no competing approval engine | `tool.start`/`tool.complete` (matching `tool_id`) from the official todo tool; wrapper's `respondApproval` delegates to official `approval.respond` (no second engine) | `live_transport.tool.{start_received,complete_received,same_tool_id}=true`; `approval_mapping.competing_engine=false` |
| Skill created via one surface visible via the other | `POST /api/skills` (same `_create_skill` write path as the agent's skill tool) → `skills.manage list` (official RPC) **and** on-disk `skills/business/<name>/SKILL.md` under the isolated home | `skill_shared_state.{visible_via_rpc=true, on_disk_path}`, `skill_count=62` |
| Scheduled task via wrapper REST in official cron state, removable | `POST /api/cron/jobs` (wrapper REST) → `cron.manage list` (official RPC) **and** on-disk `cron/jobs.json` → `DELETE /api/cron/jobs/{id}` → absent in all three | `cron_shared_state.{visible_via_rpc,visible_on_disk,removed}=true`, `disk_file` |
| plugin/profile/memory/workspace paths identical, with evidence | resolved dirs asserted under the isolated home | `path_evidence.paths.*` + `present.{memories,skills,sessions,cron,workspace_db}=true` (all under `%TEMP%\hermes-e2e-home-*`) |
| **business-shell Desktop plugin installed + discovered + enabled** | plugin installed via the **official disk door** (`<home>/desktop-plugins/business-shell/plugin.js` + integrity receipt, same contract as `electron/plugin-install.cjs`), then discovered/loaded through a **faithful reproduction of the shipped runtime loader** (`contrib/runtime-loader.ts` + `sdk/runtime.ts`: integrity → bare-specifier rewrite → module import → validate default `HermesPlugin` → `register`) | `plugin_shared_state.discovery.{business_shell_present,integrity_verified}=true`; `inventory.{status:"loaded",enabled:true}`; `contributions[]` = `/business` route + `sidebar.nav` + `palette` |
| **plugin UI + official surfaces share the isolated state** | the plugin's own `host.request` door (the live gateway) returns the same rows: `session.list` sees the shared session; `cron.manage list` ok; `skills.manage list` sees the contract Skill | `plugin_shared_state.shared_state.{session_visible_via_plugin_host,cron_list_ok,bootstrap_skill_visible}=true` |
| **plugin route serves without a provider** | the `/business` route contribution rendered via `react-dom/server` with **no** model configured | `plugin_shared_state.route_render.{provider_free:true, markup_bytes:~6180}` |
| **plugin vs Skill distinguished** | `business-shell` = Desktop **plugin** (disk door + inventory, absent from the Skill registry); `business-bootstrap` = **Skill** (on-disk `SKILL.md` + `skills.manage`, absent from plugin contributions); `business-whatsapp-policy` = a **separate** plugin, not part of this desktop-plugin contract | `plugin_shared_state.plugin_vs_skill.*` |
| **uninstall/cleanup = zero residue, live home never touched** | `uninstallBusinessShell` removes the plugin folder → re-scan empty; every write confined to the isolated home; temp-home deletion removes all | `plugin_shared_state.uninstall.{disk_door_empty,residue_gone,writes_confined_to_isolated_home}=true` |
| diagnostics redacted, no secrets/content copied | every line via `sanitize`/`safeJson`; only the provider **name** appears, never a key; no transcript content copied to reports | provider shown as `openrouter`; no key/content in output |

**Live vs mock provider (honest).** On this machine a provider (`openrouter`) is
present **via environment**, so streaming/stop-cancel/tool were proven against a
**live** provider with minimal deterministic prompts (a single exact marker; an
interrupt that stops a long reply after the first delta; one todo-tool turn). No
messaging/email/Google action is ever sent — an LLM completion is not an external
channel action. When **no** provider is configured, the suite marks
`live_transport.skipped` with a reason and the provider-free assertions (session/
cron/skill shared-state + path evidence) still pass; those exercise real Hermes
code with **no** model call. Set `HERMES_E2E_NO_LLM=1` to force the provider-free
path even when a key is present.

**Commands & results (this acceptance run):**

```
npm test                              # 49 files, 242 pass / 1 skip (incl. hermes-shared-home guard + plugin-loader tests)
HERMES_E2E_NO_LLM=1 node scripts/e2e-hermes-shared-state.mjs   # ok:true — session+cron+skill shared-state, paths, AND the business-shell plugin: install→discover→enabled→same-state→provider-free route render→uninstall zero residue
node scripts/e2e-hermes-shared-state.mjs   # + live streaming/interrupt when a provider is already available
node scripts/e2e-hermes.mjs           # ok:true — isolated home; streaming+resume+cron cycle green
```

**Cleanup verified:** temp homes removed (0 `hermes-e2e-home-*` left in `%TEMP%`),
the REST-created cron job and skill live only inside the deleted temp home, the
live profile carries **0** `POC E2E`/`poc-e2e-shared` markers afterward, and the
user's real `hermes serve` on port 9119 stays `LISTENING` (untouched). Each run
uses its own port (9131–9135) and its own home, so nothing collides.

**Gap closed — business-shell plugin installed into the isolated home.** The
prior increment (`desktop-plugins/` absent in a fresh home) is now proven end to
end. The suite installs the **real repository** business-shell Desktop plugin via
the **official disk-door contract** — copy `plugin.js` into
`<home>/desktop-plugins/business-shell/` plus an SRI integrity receipt and the
`business-bootstrap` Skill, byte-for-byte what `electron/plugin-install.cjs`
ships — **before** boot, so the gateway scans the Skill at startup. Discovery and
loading then run a **faithful Node reproduction of the shipped renderer pipeline**
(`scripts/lib/probes/hermes/plugin-loader.mjs` ≙ `apps/desktop/src/contrib/
runtime-loader.ts` + `sdk/runtime.ts`): SRI check → bare-specifier rewrite
(`@hermes/plugin-sdk` / `react` → live shim modules) → module import → validate
the default `HermesPlugin` → `register(ctx)` with the same id-scoping/provenance
as `createPluginContext`. The ONLY substitution is the module transport
(browser `URL.createObjectURL(Blob)` → Node `data:` URLs); the rewrite,
integrity, unsupported-import and validation logic are identical. There is **no
gateway REST/RPC for desktop-plugin listing** — discovery is renderer-side over
the filesystem door, which is exactly what is reproduced. New modules are each
≤150 lines: `plugin-loader.mjs`, `plugin-install.mjs`, `plugin-sdk-shim.mjs`,
`plugin-shared-state.mjs`, unit-tested by `plugin-loader.test.mjs`.

**Cleanup (plugin):** uninstall removes the plugin folder (re-scan → 0 plugins),
all writes are confined to the isolated temp home (`writes_confined_to_isolated_
home=true`), and temp-home deletion leaves **0** `hermes-e2e-home-*` behind. The
guard refuses any non-isolated `HERMES_HOME`, so the user's live
`desktop-plugins/business-shell` (if present) is only ever **read**, never
installed/uninstalled/modified by this suite.

---

## 5. External gates remain external

These are **outside** this repository's deterministic gates and remain open until
satisfied by the operator with real credentials/infrastructure:

1. **Authenticode code-signing** — the companion installer and app exe are
   `NotSigned`; requires an OV/EV certificate.
2. **Public signed HTTPS companion manifest** — the download→verify→extract→
   fail-closed pipeline is now **proven hermetically** (§4). The **only**
   remaining decision for a truly distributable network installer is an
   infrastructure one: host the companion artifact (the NSIS `.exe` or the
   portable `.zip`) at a stable **HTTPS** URL, then set
   `HERMES_BUSINESS_COMPANION_URL` + `HERMES_BUSINESS_COMPANION_SHA256` and run
   `npm run package:bootstrap`. No URL is invented; the placeholder in the QA
   manifest must be replaced with that real endpoint.
3. **Google OAuth app verification** — live checks pass for the current tester
   profile; Google's app-verification / consent-screen review is still required
   for general external users.
4. **Dedicated-number WhatsApp outbound** — only the fail-closed read-only /
   selected-chat policy is validated (no messages sent).
5. **Upgrade matrix** — clean-install validated; version-to-version upgrade paths
   across the `>=0.19.0 <0.20.0` range remain to be matrixed (the post-update
   re-gate in §2 is the runtime backstop for this).

External read-only live checks (Google `--check`/`--check-live`, the Hermes
release-channel probe, Docker status) are exercised at acceptance time against
real, existing profiles/endpoints and are redacted before display; their live
transcripts stay in the local `release/ACCEPTANCE.md`.

---

## 6. Secret scan

Scope: tracked + untracked source files. Excluded: `node_modules`, `dist`,
`release`, `promo-video/out` and `promo-video/public/soundtrack.wav` (generated
media, git-ignored), and binary/media extensions. Patterns:
OpenAI/GitHub/Slack/AWS/Google keys, PEM private keys, JWTs. **Result: clean** —
the only matches are known fake fixtures inside redaction unit tests
(`src/lib/presentation.test.ts`, `scripts/lib/e2e-harness.test.mjs`).

---

## 7. Live vs mocked — summary

- **Live:** Google `--check` + `--check-live` (real profile, real API call);
  Hermes release-channel probe (real GitHub release selection + blob integrity);
  packaged-app E2Es driving the **real** context-isolated Electron binaries.
- **Deterministic/mocked (by design):** QA demo transport (in-memory fixtures);
  bootstrap HTTP/integrity/rollback unit gates; WhatsApp/Telegram contracts
  (policy asserted, **no** live messages); partner-sandbox degraded guard
  (unit-level, Docker stopped).

---

## 8. Maintainability

Guideline ≤150 lines/file. A small number of pre-existing cohesive modules and
test suites exceed it modestly; none are introduced by acceptance edits. The
generated `hermes-plugin/business-shell/plugin.js` bundle is a documented
generated exception. Repository hygiene is deterministic: generated promo-video
outputs (`out/`, `public/soundtrack.wav`, caches) are git-ignored via
`promo-video/.gitignore` while all source, scripts, and the package lock remain
committable.
