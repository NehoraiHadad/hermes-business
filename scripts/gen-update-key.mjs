#!/usr/bin/env node
// Generate the Ed25519 keypair that anchors the in-app one-click updater.
//
//   node scripts/gen-update-key.mjs [--out <path>] [--force]
//
// The PRIVATE key is the single most sensitive artifact in this repository's
// trust story: the installer is UNSIGNED (no code-signing certificate, and there
// will not be one), so this key is the ONLY thing that lets a shipped app tell
// "the installer the maintainer published" from "an .exe someone handed it".
// Consequences, both deliberate:
//   * it is written OUTSIDE the repository (default %USERPROFILE%\.tachles-release)
//     so no `git add -A` can ever sweep it up, and
//   * it is never printed, never copied into release/, never sent anywhere.
// There is NO recovery if it is lost: the public half is compiled into every
// shipped build, so a lost key means every already-installed app can no longer
// verify anything new until users manually install a build carrying a NEW public
// key. Back it up offline.
//
// Only the PUBLIC key is printed, plus the exact snippet to paste into
// electron/update-trust.cjs.

import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { keyIdFromPublicKeyDer } from './lib/release/update-manifest.mjs'

const argv = process.argv.slice(2)
const force = argv.includes('--force')

function flag(name) {
  const i = argv.indexOf(name)
  if (i === -1) return null
  const value = argv[i + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} requires a value`)
    process.exit(1)
  }
  return value
}

/** Default private-key home: OUTSIDE the repo, in the operator's profile. */
export function defaultKeyPath(home = os.homedir()) {
  return path.join(home, '.tachles-release', 'update-signing-key.pem')
}

const outPath = path.resolve(flag('--out') || defaultKeyPath())

// Never overwrite silently: an accidental re-run would orphan every shipped build
// that trusts the old public key, and the old private key would be unrecoverable.
if (existsSync(outPath) && !force) {
  console.error(`Refusing to overwrite an existing signing key at:\n  ${outPath}\n\n` +
    'If you truly mean to ROTATE the key, pass --force — and remember that every\n' +
    'already-installed app trusts only the OLD public key until it is updated to a\n' +
    'build whose electron/update-trust.cjs carries the new one. Keep the old public\n' +
    'key in the map (it supports multiple ids) so the rotation is not a flag day.')
  process.exit(1)
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
const keyId = keyIdFromPublicKeyDer(publicKey.export({ type: 'spki', format: 'der' }))

mkdirSync(path.dirname(outPath), { recursive: true })
writeFileSync(outPath, privatePem, { mode: 0o600 })
// mode on the open() only applies at creation; re-assert it for the --force path.
try { chmodSync(outPath, 0o600) } catch { /* best effort on Windows ACLs */ }

const snippet = `  '${keyId}': \`${String(publicPem).trim()}\n\`,`

console.log(`
=====================================================================
  TACHLES UPDATE SIGNING KEY GENERATED
=====================================================================

  Key id      : ${keyId}
  PRIVATE key : ${outPath}
                (chmod 0600 — outside the repository, NEVER commit it)

  !! THIS PRIVATE KEY IS UNRECOVERABLE IF LOST !!
  Back it up offline NOW (password manager / encrypted USB). Losing it
  means no future release can be verified by any app already installed;
  users would have to install a new build by hand to regain a trust
  anchor. Leaking it means an attacker can sign an installer that every
  installed app accepts as genuine.

  PUBLIC key (safe to publish, this is what ships):

${String(publicPem).trim()}

  Paste this line into UPDATE_TRUST_KEYS in electron/update-trust.cjs
  (keep any existing entries — the map is multi-key so a rotation never
  has to be a flag day):

${snippet}

  Then sign a release manifest with:
    node scripts/sign-update-manifest.mjs --channel pilot
=====================================================================
`)
