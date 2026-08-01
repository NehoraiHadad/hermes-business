// Read-only `signtool verify /pa /tw` runner + a pure output parser.
//
// `/pa` uses the Default Authenticode policy; `/tw` turns a MISSING trusted
// timestamp into an ERROR (non-zero exit) rather than a pass. We shell out only to
// READ an existing signature — nothing is ever signed or mutated here. The parser
// is a separate pure function so its (finding-8) cases are unit-tested without a
// real signed binary or a code-signing certificate on the machine. When signtool
// is absent (as on this dev box) or off-Windows, the probe reports `undetectable`,
// which the public signing gate treats as fail-closed.

import { execFileSync } from 'node:child_process'
import { classifySignature } from './signing.mjs'

/** Parse `signtool verify /pa /tw /v <file>` output into a raw signature shape.
 * `exitCode` 0 means signtool verified the chain AND (because of /tw) a trusted
 * timestamp; a non-zero exit is a hard verification failure. */
export function parseSigntool(stdout, exitCode) {
  const text = String(stdout || '')
  const verified = exitCode === 0 && /Successfully verified/i.test(text)
  const issuedTo = text.match(/Issued to:\s*(.+)/i)
  const sha1 = text.match(/SHA1 hash:\s*([0-9A-Fa-f ]{20,})/i)
  const rfc3161 = /signature is timestamped|Timestamp Verified by/i.test(text)
  return {
    detectable: true,
    verified,
    status: verified ? 'Valid' : 'NotVerified',
    publisher: issuedTo ? issuedTo[1].trim() : null,
    thumbprint: sha1 ? sha1[1].replace(/\s+/g, '').toUpperCase() : null,
    rfc3161: verified && rfc3161,
    timestamp: verified && rfc3161 ? 'yes' : ''
  }
}

/** Run signtool read-only over one file, returning the raw parse. `run`, `platform`
 * and `exe` are injectable. `exe` is the ABSOLUTE signtool path the resolver
 * discovered (electron-builder vendor copy); when omitted we fall back to the bare
 * `signtool` name on PATH. Any failure to LAUNCH signtool (missing, off-Windows) →
 * undetectable, never a silent pass. A non-zero verify exit is still parsed (as a
 * failure) so the reason surfaces. */
export function verifySigntool(file, { run = defaultRun, platform = process.platform, exe = 'signtool' } = {}) {
  if (platform !== 'win32') return { detectable: false }
  try {
    // The runner receives the resolved ABSOLUTE `exe` so tests can assert exactly
    // which binary is invoked; defaultRun launches it via execFileSync.
    const { stdout, code } = run(file, exe)
    return parseSigntool(stdout, code)
  } catch {
    return { detectable: false }
  }
}

/** Read-only signature verdict for one file (classified). `opts.exe` may carry the
 * resolved absolute signtool path to invoke. */
export function probeSignature(file, opts = {}) {
  return classifySignature(verifySigntool(file, opts))
}

function defaultRun(file, exe = 'signtool') {
  try {
    const stdout = execFileSync(exe, ['verify', '/pa', '/tw', '/v', file], {
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString()
    return { stdout, code: 0 }
  } catch (e) {
    // Non-zero exit still yields stdout we can parse for the failure reason.
    if (e && e.stdout) return { stdout: e.stdout.toString(), code: e.status ?? 1 }
    throw e
  }
}
