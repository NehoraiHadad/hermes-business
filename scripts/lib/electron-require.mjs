// Single door from the ESM tooling layer into the CommonJS main-process modules.
//
// electron/*.cjs owns the product contracts (runtime modes, QA policy, paths).
// Scripts must IMPORT those contracts rather than restate them — a re-typed
// sentinel or port is exactly the drift electron/constants-lockstep.test.ts
// exists to catch. Resolution is anchored to the repo layout, not to the calling
// module's depth, so helpers can move between scripts/ and scripts/lib/ freely.

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronDir = path.resolve(fileURLToPath(new URL('../../electron/', import.meta.url)))

/** Require a main-process CommonJS module by file name, e.g. 'runtime-mode.cjs'. */
export function requireElectron(moduleFile) {
  return require(path.join(electronDir, moduleFile))
}

export { electronDir }
