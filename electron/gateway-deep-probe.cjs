// Pure, dependency-free interpretation of the official `gateway status --deep`
// output. No process spawns, no runtime, no I/O — just text → { healthy, reason }
// — so the fail-closed parsing is exhaustively unit-testable. The assertion layer
// that actually RUNS the command lives in hermes-health.cjs.
//
// SCOPE OF THE DEEP PROBE (do not overclaim). On Windows `gateway status --deep`
// (hermes_cli/gateway_windows.py::status → _print_deep_probes) prints six probes
// [1]..[6] that assert ONLY that the gateway PROCESS is alive and its on-disk
// lifecycle state is self-consistent:
//   [1] PID file present            [2] runtime lock held by a live process
//   [3] get_running_pid() resolves  [4] OS confirms that PID is alive
//   [5] gateway_state.json==running [6] last exit-diag lifecycle event
// It does NOT talk to Telegram/WhatsApp and does NOT list cron jobs, so a pass
// means "the gateway daemon is running", NEVER "message channels / cron are
// healthy". Component/channel health, if ever needed, is a DIFFERENT command.
//
// The upstream `status()` PRINTS PASS/FAIL but frequently exits 0 EVEN WHEN
// probes FAIL, so the exit code alone cannot be trusted. We therefore parse the
// output STRUCTURALLY and fail closed on any FAIL / missing / duplicate /
// unknown-probe ambiguity; a non-zero exit is also unhealthy.

// Stable ASCII fragments emitted by gateway_windows.py::status(deep=True). We key
// on the ASCII TEXT (not the ✓/✗ glyphs) so a localized console code page or a
// mangled glyph can never flip a verdict — only the surrounding text differs
// between the positive and negative lines, and that text is hard-coded English.
const WIN_INSTALLED_MARKERS = ['Scheduled Task registered', 'Windows login item installed']
const WIN_NOT_INSTALLED_MARKER = 'Gateway service not installed'
const WIN_PROCESS_RUNNING_MARKER = 'Gateway process running'
const WIN_NO_PROCESS_MARKER = 'No gateway process detected'
const WIN_DEEP_HEADER = /^[ \t]*Deep probes:[ \t]*$/m
// A probe line: `  [<id>] <VERDICT>  <description>` (VERDICT is PASS/FAIL, both
// four chars, left-justified). Anchored at line start so a bracketed number
// inside a description can never be mistaken for a probe row.
const WIN_PROBE_LINE = /^[ \t]*\[(\d+)\][ \t]+([A-Za-z]+)\b/gm

// The full probe shape we audited. All six identifiers must be present exactly
// once; a missing/duplicate/unknown id means the output shape is not the one we
// verified → fail closed rather than guess.
const REQUIRED_PROBE_IDS = [1, 2, 3, 4, 5, 6]
// Minimum SAFE set that must read PASS. Derived from _print_deep_probes():
//   [2] runtime lock held by a live process
//   [3] gateway.status.get_running_pid() resolves a PID (authoritative — it
//       already folds in lock + liveness + start-time + gateway-shape checks)
//   [4] OS confirms that resolved PID is alive
//   [5] gateway_state.json state == "running"
// Together these four prove the gateway daemon is actually up right now.
// [1] (PID file present) and [6] (last exit-diag tag == "gateway.start") are
// ADVISORY: each can legitimately read FAIL on a genuinely healthy gateway — a
// gateway resolved via the runtime lock may carry a stale/absent pid.json, and
// the exit-diag tail is a heuristic whose last tag on a long-lived process need
// not be exactly "gateway.start". Gating on them would false-FAIL healthy
// installs and make the update's rollback gate unnecessarily fragile, so we
// require their PRESENCE (shape) but not their verdict.
const REQUIRED_PASS_IDS = [2, 3, 4, 5]
const ADVISORY_PROBE_IDS = [1, 6]

// Structurally interpret Windows `gateway status --deep` output. Fail closed on
// ANY ambiguity. Returns { healthy, reason }.
function parseWindowsGatewayDeep(text) {
  // --- High-level install gate ---
  if (text.includes(WIN_NOT_INSTALLED_MARKER) || !WIN_INSTALLED_MARKERS.some(m => text.includes(m))) {
    return { healthy: false, reason: 'gateway service not installed (no scheduled task or login item in deep status)' }
  }
  // --- High-level process gate ---
  if (text.includes(WIN_NO_PROCESS_MARKER) || !text.includes(WIN_PROCESS_RUNNING_MARKER)) {
    return { healthy: false, reason: 'no gateway process detected (deep status high-level line)' }
  }
  // --- Deep-probe block must exist and be well-formed ---
  if (!WIN_DEEP_HEADER.test(text)) {
    return { healthy: false, reason: 'deep-probe block missing from gateway status --deep output' }
  }
  const probes = new Map() // id -> [verdict, ...]
  let match
  WIN_PROBE_LINE.lastIndex = 0
  while ((match = WIN_PROBE_LINE.exec(text)) !== null) {
    const id = Number(match[1])
    const verdict = match[2].toUpperCase()
    if (!probes.has(id)) probes.set(id, [])
    probes.get(id).push(verdict)
  }
  // Any probe-shaped line whose token is not a recognized verdict is ambiguous.
  for (const [id, verdicts] of probes) {
    for (const verdict of verdicts) {
      if (verdict !== 'PASS' && verdict !== 'FAIL') {
        return { healthy: false, reason: `deep probe [${id}] has an unrecognized verdict "${verdict}"` }
      }
    }
  }
  // Unknown probe id (a newer/changed gateway shape) → fail closed.
  for (const id of probes.keys()) {
    if (!REQUIRED_PROBE_IDS.includes(id)) {
      return { healthy: false, reason: `unexpected deep probe [${id}] in gateway output (shape changed)` }
    }
  }
  // Every required probe present exactly once.
  for (const id of REQUIRED_PROBE_IDS) {
    const verdicts = probes.get(id)
    if (!verdicts) return { healthy: false, reason: `deep probe [${id}] missing from gateway output` }
    if (verdicts.length > 1) {
      return { healthy: false, reason: `deep probe [${id}] appeared ${verdicts.length} times (ambiguous)` }
    }
  }
  // Required-PASS set must all be PASS.
  const failed = REQUIRED_PASS_IDS.filter(id => probes.get(id)[0] !== 'PASS')
  if (failed.length) {
    return { healthy: false, reason: `deep liveness probe(s) ${failed.map(i => `[${i}]`).join(', ')} reported FAIL` }
  }
  const advisoryFailed = ADVISORY_PROBE_IDS.filter(id => probes.get(id)[0] !== 'PASS')
  const note = advisoryFailed.length
    ? ` (advisory ${advisoryFailed.map(i => `[${i}]`).join(', ')} FAIL — not gated)`
    : ''
  return { healthy: true, reason: `gateway process/lifecycle liveness probes passed${note}` }
}

// Interpret a `gateway status --deep` run. `ok` is whether the process exited
// zero (runCaptured resolved). A non-zero exit is unhealthy up front; otherwise
// we parse the output for the current platform.
function interpretGatewayDeep({ ok, output }, { platform = process.platform } = {}) {
  const text = String(output || '').trim()
  if (!ok) {
    return { healthy: false, reason: text || 'gateway status --deep exited non-zero' }
  }
  if (platform === 'win32') {
    return parseWindowsGatewayDeep(text)
  }
  // Non-Windows: the [1]..[6] PASS/FAIL block is Windows-ONLY. systemd/launchd
  // `gateway status --deep` (gateway.py systemd_status/launchd_status) print a
  // DIFFERENT, unstructured shape — a "gateway service is running/stopped" line
  // plus a journalctl/log dump — with no per-probe verdicts. We do NOT pretend
  // the Windows parser is universal: rather than risk a false PASS from a format
  // we cannot verify against a live daemon, we FAIL CLOSED with an honest,
  // explicit unsupported message. (This companion ships Windows-only.)
  return {
    healthy: false,
    reason: `deep gateway process liveness verification is implemented for Windows only; cannot verify on platform "${platform}"`
  }
}

module.exports = {
  interpretGatewayDeep,
  parseWindowsGatewayDeep,
  REQUIRED_PROBE_IDS,
  REQUIRED_PASS_IDS,
  ADVISORY_PROBE_IDS
}
