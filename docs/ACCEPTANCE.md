# ACCEPTANCE — תכל'ס (Alpha)

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

- **Product:** תכל'ס — Hermes is described honestly as the engine with full
  access; the product name is **תכל'ס**.
- **Version line:** 0.4.x Alpha (current build: 0.4.0-alpha.2).
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

The production companion installer, the pilot (Alpha, distributable-but-unsigned)
installer, the QA (demo-enabled, non-distributable) build, and the thin bootstrap
live under **`release/`**, which is git-ignored. They are **not** tracked in this
repository, and their per-build byte sizes and SHA-256 digests are recorded in
the local `release/ACCEPTANCE.md`, not here.

Durable facts about those artifacts:

- **Production companion** (`npm run package:win`, `--channel public`) — NSIS
  one-per-user installer (electron-builder); bundle bakes `VITE_ALLOW_DEMO:""`
  (fixtures runtime-inert) **and** physically strips the demo entry module at
  build time (`vite.config.ts` → `stripDemoFixtures`), so
  `demo-data`/`demo-api`/`demo-rpc` are tree-shaken out and **absent** from the
  shipped bundle, not merely unreachable. Fully signed by an approved publisher
  (`signtool verify /pa /tw`), full binding-chain/ledger/lock-integrity rigor,
  every evidence gate (incl. thin-installer + telegram) required `passed`.
- **Pilot companion** (`npm run package:win:pilot`, `--channel pilot`;
  docs/specs/versioning.md §13 stage 5) — the SAME NSIS installer as production,
  built from the SAME real `npm run build` (demo fixtures physically stripped —
  never `build:qa`), with the SAME full attestation/binding-chain/ledger/
  lock-integrity rigor and the SAME machine-bound packaged-e2e + approval
  evidence. The two differences from production, both disclosed rather than
  hidden: (1) **unsigned** — no code-signing certificate exists yet, so Windows
  SmartScreen warns on install; users are expected to verify the published
  `SHA256SUMS.txt`; (2) the two hosted-service external gates (thin-installer,
  telegram) may stay honest blockers instead of `passed`, exactly like qa. Pilot
  **IS distributable** — an Alpha prerelease for outside testers, named
  `Tachles-Setup-<version>.exe` with no `DO-NOT-DISTRIBUTE` marker — published as
  a GitHub prerelease per `docs/RELEASING.md`. The build attestation
  (`build/build-attestation.json`) independently records `build_mode` (detected
  from the compiled `dist/` bundle, never trusted from the `--channel` argument);
  the pilot gate fails closed if it is not `"production"`, so a `build:qa`
  artifact can never pass `--channel pilot`.
- **QA companion** — `vite build --mode qa` + `electron-builder --dir`
  (unpacked only, no installer), the **only** build allowed to serve `?demo=1`
  fixtures; clearly marked `DO-NOT-DISTRIBUTE` and must be deleted before release.
  Unlike pilot, qa tolerates a missing ledger/lock-attestation/release-report —
  it is a dev/internal artifact, never handed to anyone outside the machine.
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

### Update responsibility (what self-updates, and what does not)

Two independent update surfaces exist; only one is wired:

- **Hermes runtime update — WIRED.** The desktop shell drives updates of the
  *Hermes Agent* runtime it manages: `SupportUpdatePanel` → `applyUpdate`
  (`src/lib/hermes/rest.ts`) → `window.hermesDesktop.applyUpdate` →
  `electron/hermes-update-flow.cjs` (backup → `hermes update --yes` → compat
  re-gate via `assertRunningVersionSupported` → rollback on failure). Bounded by
  `hermes-compat.json` `[0.19.0, 0.20.0)`.
- **Companion (desktop shell) self-update — NOT wired.** There is **no**
  `electron-updater` dependency and **no** `autoUpdater` consumer, so nothing
  reads an update feed for the companion itself. A new companion version is
  delivered by re-running the installer/bootstrap, not by in-app self-update.
  Accordingly `build.publish` is set to **`null`** (`package.json`) so
  electron-builder no longer infers a GitHub provider and emits a `latest.yml` /
  `app-update.yml` that no updater consumes and whose filename did not even match
  the shipped Hebrew-named installer. No new updater was introduced; this only
  removes a misleading artifact. If companion self-update is added later, wire a
  real `electron-updater` feed and re-enable `publish` deliberately.

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
| **Packaged companion — isolated runtime + real approval deny** | production win-unpacked | throwaway temp `HERMES_HOME` (owned by the harness) + isolated high loopback port, auto-cleaned | **PASS** — see 4c |

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

**NSIS companion contract** (`scripts/e2e-companion-nsis-contract.ps1`, plus the
offline `Companion install transaction` suite): the trusted NSIS path now resolves
the installed executable **deterministically from the manifest `entrypoint`** —
the same policy as `zip` — instead of the removed "largest recursive exe wins"
scan. A real external fixture installer proves, in an isolated Hebrew/spaces root:
the manifest-named exe is selected while a larger decoy is ignored; a failing
installer **and** a broken post-install contract each roll back and leave the
prior companion byte-intact; and a pre-seeded Hermes-home sentinel is never
mutated. The `GitHub-acquisition` half is covered offline by the
`Release acquisition (GitHub)` suite: release selection resolves by source
`__version__` (never the CalVer tag), and the immutable installer blob is verified
against GitHub's git blob SHA-1 (tampered / lying-endpoint / undersized / wrong
content all fail closed) before it can be written or run.

**Not run for safety (mutation risk, not isolatable):** `e2e-installed-partner-ui`
(activates a personality that needs a real Hermes install). Its safety-critical
assertions are covered green by unit tests (`partner-mode`, `sandbox-config`,
`partner-settings`, `business-partner`).

### 4c. Packaged companion — isolated runtime + real approval deny

`npm run test:e2e:installed-isolated` (`scripts/e2e-installed-isolated.mjs`) is the
**safe replacement** for the previously-blocked live-connected packaged UI suite.
It boots the freshly built production companion against a **throwaway
`HERMES_HOME`** the harness creates/owns/deletes, on an **isolated high loopback
port**, using the new main-process-only QA runtime override
(`electron/qa-runtime.cjs`). Production is unaffected: with no QA env the override
returns `{enabled:false}` and the runtime takes its exact one-live-home path.

The override contract is **fail-closed and unavailable to the renderer**: it reads
only main-process `process.env`, requires an explicit sentinel
(`HERMES_BUSINESS_QA_RUNTIME=isolated-temp-home`), validates that the home is an
absolute, canonical, **empty, newly-created** directory strictly **under the OS
TEMP root** (rejecting symlink/reparse escapes and the live/default `HERMES_HOME`),
pins the host to `127.0.0.1`, and pins the port to a safe high range (41000–60000,
never the default 9119). Any requested-but-invalid override refuses to start rather
than fall back to the live profile.

Proven in one real run (`docs/evidence/packaged-e2e.json`, `approval.json`, both
**passed**):

- **isolated runtime** — the companion reports `mode=qa-isolated`, its gateway WS
  is on the isolated port, and `session.list` is empty (0) versus the live profile's
  sessions; the temp home is populated by the real Hermes boot.
- **real approval deny** — under `HERMES_BUSINESS_E2E_APPROVAL=1` the harness drives
  a genuine turn over the official gateway: `session.create` → `prompt.submit` asks
  the agent to run a guarded local `terminal` command → the official
  **`approval.request`** event fires → the harness denies with the official
  **`approval.respond {choice:'deny'}`** (`resolved:1`) → the target probe file is
  **never created**. This traverses the real Hermes approval RPC/event path; it is
  **not** a faked renderer modal.
- **clean teardown** — the temp home is deleted, the isolated port is free, the
  probe file is absent, and the live profile's defining state is unchanged:
  config.yaml bytes, the cron **name-set**, and a deterministic **recursive content
  fingerprint** (rel-path + type + file **bytes**) of every durable/app-managed tree
  — `skills`, `plugins`, `desktop-plugins`, `business`, `hooks` (+ defensively
  `agents`/`workflows`). A nested edit or a same-size byte rewrite flips it, and any
  **unsafe** entry (symlink/reparse/unreadable/over-cap) in either the before- or
  after-snapshot fails closed — counts only, never paths (see
  `docs/evidence/home-classification.md`). Bytecode caches are excluded in every
  tree; exact Curator runtime metadata is excluded **only inside `skills/`** (an
  authored `.usage.json`/`.curator_state` elsewhere is hashed), and an unsafe tree
  **root** (symlink/non-dir/unreadable) fails closed while an absent root is safe.
  A same-name size/timestamp bump by the user's
  concurrently-running live gateway (bound to 9119, which this run never touches) is
  attributed as volatile churn and disclosed, never a mutation.

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
npm test                              # 60 files, 356 pass / 1 skip (incl. redact + diagnostics/privacy + transport + compat/packaging + evidence gates + build-attestation + isolated-runtime + qa-runtime/namespace + hermes-shared-home guard + contract-harness tests)
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
`business-bootstrap` Skill, matching what `electron/plugin-install.cjs`
ships — **before** boot, so the gateway scans the Skill at startup. Discovery and
loading then run a **unit contract harness that MODELS the renderer pipeline**
(`scripts/lib/probes/hermes/contract-harness.mjs`, a reproduction of
`apps/desktop/src/contrib/runtime-loader.ts` + `sdk/runtime.ts` — **not** the real
loader): SRI check → bare-specifier rewrite (`@hermes/plugin-sdk` / `react` → live
shim modules) → module import → validate the default `HermesPlugin` →
`register(ctx)` with the same id-scoping/provenance as `createPluginContext`. The
harness transports modules via Node `data:` URLs where the browser uses
`URL.createObjectURL(Blob)`. Because a hand-written reproduction can drift, it is
**never cited as proof that real Hermes loads the plugin**: that guarantee comes
from (a) `verify:plugin`, which checks our plugin's every SDK symbol / host door /
`PluginContext` method / area / loader-discovery fact against the **installed
Hermes `0.19.1` source** (`scripts/verify-plugin.mjs` +
`scripts/hermes-desktop-contract.json`, generated by `gen-hermes-contract.mjs`),
and (b) the opt-in real-loader E2E `scripts/e2e-real-loader.mjs`, which launches
the real installed Hermes Desktop in a proven-recoverable isolated sandbox and
separates the loader **CONTRACT** (contributions rendered) from user-path
**CLICK-PATH acceptance** (a real user-input path navigates). The latest hardened
run against installed Hermes `0.19.1` now **passes end to end** (`ok:true`,
exit 0): the CONTRACT passes, the seeded paused cron row renders through the
companion door, and acceptance is reached through a genuine **keyboard** path —
not force/dispatch/hash. It tries a normal sidebar pointer click first (short
budget, so it auto-upgrades to `sidebar-pointer` the day the environment makes it
hittable), then the official **Ctrl+K command palette** → type `לעסק` → the
plugin's contributed `business.open` (PALETTE_AREA) row auto-highlights →
**Enter** runs `host.navigate('/business')`; the Automations (`משימות`) tab is then
opened by keyboard **Enter**. The earlier "pointer intercepted by a
`data-sidebar="group"` overlay" was **not** a proven Hermes product bug: the root
cause is Playwright/Electron synthetic-pointer coordinate behavior under a
non-unity `devicePixelRatio` (~0.9), which offsets the hit-test to a full-size
ancestor for two unrelated widgets alike — a tooling/DPR artifact, not per-widget
CSS. Keyboard input is coordinate-free, so it drives the real affordances
reliably. This is a **test-run PASS, not committed public-release evidence**: the
script prints `ok:true` but deliberately writes **no** evidence envelope (there is
no `real-loader.json`; `capture-evidence.mjs` has no real-loader path), and the
hash-router / `dispatchEvent` fallbacks stay diagnostic-only. If both official
input paths ever fail, the run still fails closed as a blocked user-path — never a
contract-only pass. There is **no gateway REST/RPC for desktop-plugin listing** —
discovery is renderer-side over the filesystem door, which is what the harness
models. New modules are each ≤150
lines: `contract-harness.mjs`, `plugin-install.mjs`, `plugin-sdk-shim.mjs`,
`plugin-shared-state.mjs`, unit-tested by `contract-harness.test.mjs`.

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
(`src/lib/presentation.test.ts`, `scripts/lib/e2e-harness.test.mjs`,
`electron/redact.test.ts`, `scripts/lib/evidence.test.mjs`), which assert the app
strips secret/email/path shapes. The git-ignored working dir `.tmp-hermes-home/`
(an isolated Hermes home from an E2E run) contains only upstream placeholder
tokens (`sk-xxxx…`, `ghp_xxxx…`) and is out of scope like everything ignored.

---

## 7. Live vs mocked — summary

- **Live:** Google `--check` + `--check-live` (real profile, real API call);
  Hermes release-channel probe (real GitHub release selection + blob integrity);
  packaged-app E2Es driving the **real** context-isolated Electron binaries;
  Telegram live diagnosis (redacted `docs/evidence/telegram.json`, gated by
  `npm run verify:evidence`): official polling healthy, bot token valid, sole
  poller with no webhook conflict, a historical inbound update that reached
  Hermes (blocked because the sender was not authorized at that time; the current
  allowlist authorizes the sender), and exactly one benign connectivity-test
  reply confirmed via the official Hermes send. A fresh post-authorization
  user→agent→reply round trip remains the honest manual step.
- **Deterministic/mocked (by design):** QA demo transport (in-memory fixtures);
  bootstrap HTTP/integrity/rollback unit gates; the WhatsApp contract
  (policy asserted, **no** live messages); partner-sandbox degraded guard
  (unit-level, Docker stopped).

---

## 8. Maintainability

Guideline ≤150 lines/file. The official-release installer logic is a stable
facade (`installer/lib/Release.ps1`) that fail-closed dot-sources two cohesive
parts — `ReleaseSelection.ps1` (which tagged release to install, by source
`__version__`) and `ReleaseAcquisition.ps1` (immutable installer-blob download +
verification and the install run) — each ≤150 lines. `business-bootstrap.nsi`
File-bundles both parts and the drift guard `release-packaging.tests.ps1` proves
every facade-loaded part is bundled and parse-gated in load order, so a packaged
thin install can never omit a split dependency. A small number of pre-existing
cohesive modules and test suites exceed the guideline modestly; none are
introduced by acceptance edits. The
generated `hermes-plugin/business-shell/plugin.js` bundle is a documented
generated exception. Repository hygiene is deterministic: generated promo-video
outputs (`out/`, `public/soundtrack.wav`, caches) are git-ignored via
`promo-video/.gitignore` while all source, scripts, and the package lock remain
committable.
