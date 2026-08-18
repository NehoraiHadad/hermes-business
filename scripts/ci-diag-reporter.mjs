// TEMPORARY CI DIAGNOSTIC (2026-08-18) — a raw-error reporter for the
// runner-only collection failure. Prints every module/suite error UNPROCESSED
// (message + full stack string + own enumerable props). A Node module-compile
// SyntaxError carries the offending file, line, source excerpt and caret in its
// .stack — exactly what every built-in reporter drops. Delete with
// ci-diag-collect.mjs once the root cause is fixed.
function dump(prefix, err) {
  if (!err) return
  console.error(`\n[${prefix}] name=${err.name} message=${err.message}`)
  console.error(`[${prefix}] stack:\n${err.stack || '(no stack)'}`)
  for (const k of Object.keys(err)) {
    if (k === 'stack' || k === 'message') continue
    try {
      console.error(`[${prefix}] ${k}=${JSON.stringify(err[k])?.slice(0, 500)}`)
    } catch { /* unserializable */ }
  }
}

export default class RawErrorReporter {
  // Vitest 4 API
  onTestRunEnd(testModules = [], unhandledErrors = []) {
    for (const mod of testModules) {
      for (const err of mod.errors?.() ?? []) dump(`module ${mod.moduleId}`, err)
    }
    for (const err of unhandledErrors) dump('unhandled', err)
  }

  // Legacy API fallback (harmless if never called)
  onFinished(files = [], errors = []) {
    for (const f of files) {
      for (const err of f.result?.errors ?? []) dump(`file ${f.filepath}`, err)
    }
    for (const err of errors) dump('unhandled-legacy', err)
  }
}
