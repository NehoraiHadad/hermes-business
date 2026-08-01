// MEDIUM 9 — discover the DETERMINISTIC bundled tools the pipeline needs and prefer
// project-pinned vendor copies over whatever happens to be on PATH.
//
// Two tools matter:
//   * a 7-Zip-family extractor (7za) — electron-builder ships one in its download
//     cache (…/electron-builder/Cache/7zip@<ver>/…/bin/7za.exe on Windows);
//   * signtool.exe — @electron/windows-sign vendors one at
//     node_modules/@electron/windows-sign/vendor/signtool.exe.
// Policy:
//   1. prefer the project-pinned vendor tool (reproducible), then a PATH tool
//      resolved to its ABSOLUTE path (never a bare name);
//   2. validate the chosen tool's path exists, is a real PE image, and its sha256
//      matches a pin when one is provided (a swapped tool is rejected);
//   3. a MISSING tool is reported honestly but does NOT by itself block a release —
//      containment is simply "not proven" and the signing gate still independently
//      requires a cert. We never claim a capability we cannot exercise.
// The decision is pure over an injected candidate list + probe/hash functions; every
// filesystem seam (exists/hashFile/readdir/which/isPe) defaults to the real fs and is
// injectable, so unit tests drive a synthetic cache with no electron-builder install.

import path from 'node:path'
import {
  byVersionDesc, findCacheTools, fsExists, fsHashFile, looksLikePe, whichOnPath
} from './tool-scan.mjs'

export { scanToolTree, looksLikePe } from './tool-scan.mjs'

/**
 * @param candidates [{ id, source:'vendor'|'cache'|'path', path, sha256_pin? }] in
 *                   PREFERENCE order (vendor first). `path` is the ABSOLUTE path to
 *                   probe/inject (null candidates are treated as not-present).
 * @param probe      (candidate) => boolean   — does this candidate resolve/exist?
 * @param hashFile   (path) => string|null    — sha256 of the resolved file
 * @param verify     (candidate, sha) => string|null — extra identity check (PE magic,
 *                   version); returns a rejection reason or null when accepted.
 * Returns { chosen: {id,source,path,sha256}|null, rejected:[{id,reason}], available:boolean }.
 */
export function discoverTool({ candidates = [], probe = fsExistsProbe, hashFile = fsHashFile, verify = () => null } = {}) {
  const rejected = []
  for (const c of candidates) {
    if (!c.path || !probe(c)) { rejected.push({ id: c.id, reason: 'not-present' }); continue }
    const sha = hashFile(c.path)
    if (c.sha256_pin) {
      if (!sha) { rejected.push({ id: c.id, reason: 'unhashable' }); continue }
      if (sha !== c.sha256_pin) { rejected.push({ id: c.id, reason: `sha256 ${short(sha)} != pin ${short(c.sha256_pin)} (swapped tool)` }); continue }
    }
    const vreason = verify(c, sha)
    if (vreason) { rejected.push({ id: c.id, reason: vreason }); continue }
    return { chosen: { id: c.id, source: c.source, path: c.path, sha256: sha }, rejected, available: true }
  }
  return { chosen: null, rejected, available: false }
}

function fsExistsProbe(c) { return fsExists(c.path) }

/**
 * Resolve the two deterministic tools the pipeline INJECTS by absolute path:
 *   * a 7-Zip-family extractor from electron-builder's versioned cache (recursively
 *     found under the Cache root — never a hardcoded `Cache/7zip` path), then a
 *     PATH-resolved 7z/7za;
 *   * signtool.exe: the project-pinned @electron/windows-sign vendor copy, then a
 *     PATH-resolved signtool.
 * Every resolved candidate is validated for PE identity (MZ magic); a sha256_pin or
 * an injected `versionProbe` tightens it further. Returns discoverTool results whose
 * `chosen.path` is the ABSOLUTE path to inject. All fs/probe seams are injectable.
 */
export function resolveReleaseTools({
  localAppData = process.env.LOCALAPPDATA || null,
  vendorSigntool = null,
  exists = fsExists,
  hashFile = fsHashFile,
  isPe = looksLikePe,
  readdir,
  which,
  versionProbe = null
} = {}) {
  const probe = c => exists(c.path)
  const resolvePath = which || (name => whichOnPath(name, { exists }))
  const verify = (c, sha) => {
    if (c.path && !isPe(c.path)) return 'not-a-PE-image (MZ header absent)'
    if (typeof versionProbe === 'function' && c.path) {
      const v = versionProbe(c.path)
      if (v && v.ok === false) return `version-check-failed (${v.reason || 'unusable'})`
    }
    return null
  }

  // 7za: recursively walk the versioned cache tree beneath the Cache ROOT, newest
  // folder first; then any PATH 7z/7za resolved to an absolute path.
  const cacheRoot = localAppData ? path.join(localAppData, 'electron-builder', 'Cache') : null
  const cacheHits = findCacheTools({ cacheRoot, exists, ...(readdir ? { readdir } : {}) })
  const cache7 = cacheHits.map(p => ({
    id: `7za-cache:${cacheRoot ? path.relative(cacheRoot, p).replace(/\\/g, '/') : p}`,
    source: 'cache',
    path: p
  }))
  const path7 = dedupePaths(['7z', '7za'].map(n => ({ n, p: resolvePath(n) }))
    .filter(x => x.p).map(x => ({ id: `${x.n}-path`, source: 'path', path: x.p })))
  const sevenZip = discoverTool({ candidates: [...cache7, ...path7], probe, hashFile, verify })

  const sigPath = resolvePath('signtool')
  const signtool = discoverTool({
    candidates: [
      ...(vendorSigntool ? [{ id: 'vendor-signtool', source: 'vendor', path: vendorSigntool }] : []),
      ...(sigPath ? [{ id: 'system-signtool', source: 'path', path: sigPath }] : [])
    ],
    probe, hashFile, verify
  })

  return { sevenZip, signtool }
}

function dedupePaths(cands) {
  const seen = new Set()
  return cands.filter(c => (seen.has(c.path) ? false : seen.add(c.path)))
}

/** Whether a missing tool should block the channel. Per policy: NEVER on its own —
 * a missing extractor makes containment "not proven" (already fail-closed for public
 * via the containment gate) and a missing signtool is subsumed by the cert
 * requirement. So tool discovery is advisory, not a standalone blocker. */
export function toolDiscoveryBlocks() {
  return false
}

export { byVersionDesc, findCacheTools, whichOnPath }

function short(h) { return typeof h === 'string' ? h.slice(0, 10) + '…' : String(h) }
