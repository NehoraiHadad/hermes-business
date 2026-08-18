// Canonical, key-sorted JSON serialization — the ONE implementation in this
// repository, shared by the build-time release tooling and the SHIPPED runtime.
//
// Why it lives under electron/ rather than scripts/lib/release/: `build.files`
// ships `electron/**` into app.asar and does NOT ship `scripts/**`, so anything
// the runtime must execute has to live here. The dependency direction is the
// only one that is physically possible — build-time code may import runtime
// code, never the reverse (scripts/lib/release/binding.mjs re-exports this
// function, and scripts/lib/release/update-manifest.mjs already imports
// electron/companion-update-core.cjs on exactly the same grounds).
//
// Why ONE implementation and not a mirrored copy: this function defines the
// EXACT bytes an Ed25519 signature covers, both for the build-time release
// ledger (gather.mjs `authenticateLedger`) and for the runtime update manifest
// (update-manifest-verify.cjs `manifestSigningBody`). A second copy that
// ordered keys, encoded `undefined`, or spelled a number differently by even one
// byte would produce a body the other side cannot verify — i.e. either a
// permanently unverifiable update channel or, worse, two disagreeing notions of
// "what was signed". Byte-identity is not a nice-to-have here; it is the
// property, so there is nothing to be identical WITH.

/** Canonical, key-sorted JSON so a digest/signature is independent of property order. */
function canonicalJson(value) {
  return canonical(value)
}

// `undefined` is normalized to `null` on purpose: the signing convention is
// `canonicalJson({ ...doc, signature: undefined })`, i.e. the signature field is
// BLANKED rather than deleted, so signer and verifier can never disagree about
// whether the signature covers itself.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

module.exports = { canonicalJson }
