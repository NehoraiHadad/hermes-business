// CRITICAL 1 — the pure decision that makes installer↔payload containment
// UN-forgeable by editing the report.
//
// The release report records a `payload_binding` object it wrote about itself.
// This decision NEVER trusts that object's `proven` boolean or its digest on its
// own. gather.mjs re-runs the extraction (proveContainmentBound) over the installer
// bytes on disk and hands the INDEPENDENT result in here. Containment holds only
// when ALL of the following are true:
//   1. the independent extraction actually PROVEN true (a real 7z-family extractor
//      ran and every embedded fact was byte-equal to the loose payload);
//   2. the report claims proven === true (consistency — a report that admits it is
//      unproven can never be promoted, and a report that lies is caught by 3/4);
//   3. the report records a containment_digest, and it equals the digest the
//      verifier just recomputed from the freshly-extracted bytes;
//   4. (public) the extraction covered the app.asar, so the manifest's claimed
//      app hash is proven against the archive really inside the installer.
// Any gap → { ok:false } with an honest code, and the public gate fails closed.
// Off-box (no extractor) → independent.proven is false → fail closed, never faked.

/**
 * @param report      release-report.json (or null)
 * @param independent result of proveContainmentBound() over the installer on disk
 * @param channel     'public' | 'qa'
 * Returns { ok, code?, detail, proven, digest }.
 */
export function decideContainment({ report, independent, channel = 'public' } = {}) {
  const pb = report && report.payload_binding
  // No report at all → nothing binds the installer to the packaged manifest.
  if (!report) {
    return fail('containment-no-report', 'release-report.json missing; installer not bound to packaged manifest', independent)
  }
  if (!pb) {
    return fail('containment-no-binding', 'release report carries no payload_binding block', independent)
  }

  // The verifier's OWN extraction is the source of truth. If it could not prove
  // containment (no extractor, missing entry, byte mismatch), we fail closed with
  // the independent reason — the report's boolean is irrelevant here.
  if (!independent || independent.proven !== true) {
    const reason = independent?.reason || 'not-extracted'
    return fail('containment-not-independently-proven', `independent re-extraction did not prove containment (${reason})`, independent)
  }

  // The report must also CLAIM proven; a report that concedes unproven is honest
  // but not promotable, and a report claiming proven with a bad digest is a forgery.
  if (pb.proven !== true) {
    return fail('containment-report-unproven', `report payload_binding.proven=${JSON.stringify(pb.proven)} (${pb.reason || 'no reason'})`, independent)
  }

  // The report's recorded digest MUST equal the one just recomputed from the bytes
  // actually inside the installer. This is the anti-forgery bind: flipping proven
  // to true without re-cutting the digest over real extracted bytes cannot pass.
  if (!pb.containment_digest) {
    return fail('containment-digest-absent', 'report payload_binding has no containment_digest to bind against', independent)
  }
  if (pb.containment_digest !== independent.digest) {
    return fail('containment-digest-mismatch',
      `report containment_digest ${short(pb.containment_digest)} != independently extracted ${short(independent.digest)} — report describes bytes not in this installer`,
      independent)
  }

  // Public additionally requires the app.asar to have been part of the extraction,
  // so the manifest's app hash is proven against the archive really shipped.
  if (channel === 'public' && !independent.extracted?.app_asar_sha256) {
    return fail('containment-app-not-covered', 'containment proof did not extract & hash the payload app.asar (public requires it)', independent)
  }

  return { ok: true, proven: true, digest: independent.digest, detail: 'installer↔payload containment independently re-proven and digest-bound' }
}

function fail(code, detail, independent) {
  return { ok: false, code, detail, proven: false, digest: independent?.digest || null }
}

function short(h) {
  return typeof h === 'string' ? h.slice(0, 16) + '…' : String(h)
}
