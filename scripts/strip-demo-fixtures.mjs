// Durable production boundary for the demo fixtures. Used by vite.config.ts and
// unit-tested by src/lib/hermes/demo-strip.test.ts, so the boundary can be
// asserted without running a full build.
//
// `src/lib/hermes/demo.ts` is the SOLE entry into the demo subtree
// (demo-api/demo-rpc/demo-data). In any build that does NOT allow demo, we
// replace that entry module with a fail-closed stub at load time, which
// tree-shakes every fixture out of the emitted bundle — the fabricated data is
// PHYSICALLY absent from the shipping executable, not merely runtime-unreachable.
// This is a second wall behind the runtime gate (resolveClientMode), never a
// replacement for it.
const DEMO_ENTRY = '/src/lib/hermes/demo.ts'
const STUB = "export function createDemoBackend(){throw new Error('demo fixtures are not shipped in this build')}\n"

export function stripDemoFixtures(demoAllowed) {
  return {
    name: 'strip-demo-fixtures',
    enforce: 'pre',
    load(id) {
      if (demoAllowed) return null
      const normalized = String(id).replace(/\\/g, '/').split('?')[0]
      return normalized.endsWith(DEMO_ENTRY) ? STUB : null
    }
  }
}
