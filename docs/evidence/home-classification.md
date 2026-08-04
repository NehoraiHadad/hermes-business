# HERMES_HOME classification — installed Hermes 0.19.1

`HERMES_HOME` = `%LOCALAPPDATA%\hermes` on Windows (the parent of `hermes-agent`,
the code checkout). The isolated packaged E2E's profile marker
(`scripts/lib/isolated-marker.mjs`) must fail closed on any change to durable,
user-authored state while tolerating the concurrently-running live gateway's own
runtime writes. This file records how each top-level entry was classified and
why, from installed-Hermes 0.19.1 source/docs + top-level names only (no reading
of user content). "DURABLE" = stable-during-a-run authored config the marker
protects; "VOLATILE" = runtime-written, excluded from the stable digest.

## Protected as STABLE (recursive content fingerprint)

Trees walked recursively; each entry's rel-path + type + file **bytes** are
hashed (`isolated-marker-snapshot.mjs`). A nested edit or a same-size in-place
byte rewrite flips the fingerprint → fail closed.

| Tree | Class | Source |
| --- | --- | --- |
| `skills/` | DURABLE | User-authored skill packages (`SKILL.md`); `get_hermes_home()/"skills"` (`hermes_constants.py:236`, `tools/skill_manager_tool.py:172`). Nested dirs, e.g. `skills/business/poc-weekly-lead-summary/SKILL.md`. |
| `plugins/` | DURABLE | User-installed plugin code (`plugins/business-whatsapp-policy`); `hermes_cli/plugins.py:1369`. |
| `desktop-plugins/` | APP-MANAGED, PROTECTED | The companion installs/updates these; not user-authored, but the isolated run must not touch them, so a byte change fails closed. Hashed as **bytes only** (no content exposure). `docs/hermes-integration.md:50`. |
| `business/` | APP-MANAGED, PROTECTED | Business policy / partner settings the companion writes (e.g. `whatsapp-policy.json`). Stable during a run; a tamper/rewrite must fail closed. Hashed as **bytes only**. |
| `hooks/` | DURABLE | User-authored gateway hook scripts; `HOOKS_DIR = get_hermes_home()/"hooks"` (`gateway/hooks.py:49`). Empty on this install → empty snapshot. |
| `agents/`, `workflows/` | ABSENT (tracked defensively) | No such HERMES_HOME dirs and no `AGENTS_DIR`/`WORKFLOWS_DIR` in 0.19.1; `agents` is only a runtime "active agents" command. Kept in the protected set so that if a future version introduces them, they are protected immediately (empty here). |

### Excluded-within-tree noise — an EXPLICIT per-tree policy (not a global dot rule)

The snapshot walks and hashes **every** entry except two exact, documented, and
**separately governed** classes of tool-regenerated noise. The exclusions are
carried by an explicit policy object per tree (`isolated-marker-snapshot-policy.mjs`,
resolved by `snapshotPolicyFor(dir)`), never inferred from a path or a dot prefix:

- **Bytecode caches** — `__pycache__/` and `*.pyc`/`*.pyo`. Compiled artifacts, never
  authored; excluded in **every** protected tree (universal, derived).
- **Curator/learning-graph runtime metadata** — the exact basenames
  `.curator_state`, `.usage.json`, `.usage.json.lock`, `.hub`, `.bundled_manifest`
  the live gateway persists **inside the `skills/` tree** (`agent/curator.py:86`,
  `agent/learning_graph.py:90`). This class is **`skills/`-scoped only**: the same
  basename authored under `plugins/`, `desktop-plugins/`, `business/`, `hooks/` is
  real content and **is hashed** — a `plugins/**/.usage.json` or
  `business/.curator_state` same-size rewrite flips the fingerprint.

Any other dotfile — `.env`, `.config`, `.gitignore`, or an authored same-name
edit — is protected and hashed; a same-size `.env` rewrite flips the fingerprint.
`desktop-plugins/` and `business/` have **no** runtime-generated exclusion in 0.19.1,
so they are hashed in full. If a future version adds one, only that exact pattern,
scoped to the exact tree, is excluded — never the whole tree.

### Fail-closed on the tree ROOT (absent ≠ unsafe)

The tree root itself is classified without being followed (`lstat`, not `realpath`
first): an **absent** optional root (`ENOENT`/`ENOTDIR`) is a safe empty snapshot,
but an existing root that is a **symlink/reparse point, a non-directory, unreadable,
or unresolvable** yields exactly one `unsafe` root record with **no traversal** — a
root junction is never followed out of the home, and an unreadable root is never
silently mistaken for an absent one.

### Fail-closed on unsafe entries (symlink / reparse / unreadable / bounds)

Any entry the walk cannot safely hash — a symlink/junction/reparse point, a target
escaping the tree root, an unreadable node, an unknown type, or a subtree past the
depth/entry cap — is recorded as an `unsafe` marker (reason tag, **no bytes**) and
never descended into. The marker fails closed if **either** the before- or
after-snapshot carries any unsafe entry, even when the fingerprint is byte-identical
(a pre-existing symlink that never changes still cannot pass). Only the **count** is
exposed. An **absent** optional tree is a safe empty snapshot (0 unsafe) — distinct
from an unreadable/unsafe one, which fails.

## Protected as STABLE — non-recursive

| Entry | Rule | Source |
| --- | --- | --- |
| `config.yaml` | Byte hash (approvals.mode etc.). | Profile config. |
| `cron/jobs.json` **job definitions** | Every job's definition — id, name, prompt/script, schedule, enabled, delivery — hashed as an order-independent set; an added, removed or redefined job is a mutation. Execution bookkeeping the runner rewrites by itself (`last_run_at`, `next_run_at`, `last_status`/`last_error`, `state`, `fire_claim`, `paused_at`, provider/model snapshots, `repeat.completed`) is excluded; any **unrecognised** field counts as definition, so a new one fails closed. An unreadable `jobs.json` fails closed. | `scripts/lib/isolated-marker-cron.mjs`, live `cron/jobs.json` (0.19.1). |

## VOLATILE — excluded from the stable digest

Disclosed as counts only; never blocks a pass.

| Entry | Why volatile | Source |
| --- | --- | --- |
| `sessions/` | Gateway continuously writes transcripts; our isolated session count is independently proven 0. | `gateway/config.py:894`, `gateway/mirror.py:21` |
| `cron/` directory **name-set + sizes** | The ticker's own files (`.tick.lock`, `.jobs.lock`, `ticker_heartbeat`, `ticker_last_success`, `catch_up_occurrences`, `output/`, and the atomically-replaced `jobs.json` itself) appear, vanish and resize whenever the operator's gateway ticks — a live run created `catch_up_occurrences` mid-E2E. The **jobs** are protected above; the directory is churn. | `gateway/delivery.py`, live `cron/` listing |
| `memories/` | **Runtime-mutated** by the agent's memory tool (`USER.md`/`MEMORY.md` rewritten in place under `USER.md.lock`). Persisted user data, but NOT stable-during-a-run. | `tools/memory_tool.py:54-55,315-360` |
| `state.db`, `kanban.db`, `projects.db` (+`-wal`/`-shm`), `cron/executions.db` | Runtime SQLite; Hermes' own backup snapshots them and excludes the `-wal`/`-shm`/`-journal` sidecars as **transient**. | `hermes_cli/backup.py:72-89` |
| `state/`, `platforms/`, `pairing/`, `sandboxes/`, `pending_messages/`, `logs/`, `cache/`, `audio_cache/`, `image_cache/`, `gateway-service/`, `desktop/` | Gateway/platform runtime state, heartbeats, caches, logs. | live listing + `state (gateway.heartbeat/lifecycle)` |
| `gateway.pid/.lock`, `gateway_state.json`, `*_cache.json`, `.update_check`, `.skills_prompt_snapshot.json`, `channel_directory.json` | Machine-local runtime/cache files. | `backup.py` transient list |
| `profile/`, `workspace/` | Do not exist. Named profiles live under `profiles/<name>`; this install runs the root as the `default` profile. "workspace" is only a config concept. | `hermes_constants.py:163-166` |

## Excluded volatile database (explicit)

`state.db` (with `state.db-wal`/`state.db-shm`), `kanban.db` (with its sidecars +
`.dispatch.lock`/`.init.lock`), `projects.db`, and `cron/executions.db` are the
runtime SQLite databases. They are **never** recursed or hashed — Hermes' own
`backup.py` treats their `-wal`/`-shm`/`-journal` sidecars as transient, and the
databases mutate continuously while the live gateway runs.
