import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const loader = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/server/electron/loader.js')

// Playwright injects this ready-event handshake when it selects Electron itself,
// but omits it for explicit executables. Use that same official loader for our
// development, native Desktop and packaged candidates; no renderer state is seeded.
export const electronDriverArgs = args => ['-r', loader, ...args]
