// Community-mode CLI — materialize/verify a community.yaml contract against a
// Hermes HERMES_HOME (docs/specs/community-mode.md §3.2).
//
//   node scripts/community-generate.mjs generate --contract <community.yaml> --home <HERMES_HOME> [--init]
//   node scripts/community-generate.mjs verify   --contract <community.yaml> --home <HERMES_HOME>
//
// generate: validate the contract (fail-closed: empty/placeholder admins, bad
//           JIDs, missing knowledge sources, >60-char skill descriptions all
//           refuse), build the artifact map, write it idempotently. Existing
//           non-owned config keys (model block etc.) and non-owned .env lines
//           are preserved. The shipped admin skills (assets/community-skills/)
//           are installed into the DEFAULT profile's skills dir with the real
//           deployment paths substituted. Profiles are per context SPACE
//           (spec §2.1): non-isolated groups share profiles/village/ (shared
//           session context + the scoped community_archive tool), isolated groups get their own
//           slug-profile; each space profile gets its own config.yaml pinning
//           its toolset fence (spec §6.1 — without it a routed turn falls
//           back to the engine's FULL default toolset).
// verify:   re-derive the expected artifacts and report per-artifact drift.
//           config files compare EFFECTIVE owned keys (the engine rewrites
//           them, stripping comments and reordering keys), .env compares owned
//           env keys; SOUL.md/skills compare by checksum. Exit 1 on any
//           drift/missing artifact.
//
// Never starts a gateway, never deletes files.

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ContractError, contractSpaces, loadContract } from './lib/community/contract.mjs'
import { generateArtifacts } from './lib/community/generate.mjs'
import { verifyArtifacts } from './lib/community/verify.mjs'
import { ApplyRefusedError, applyArtifacts } from './lib/community/apply.mjs'

function usage(message) {
  if (message) console.error(`community-generate: ${message}`)
  console.error('usage: node scripts/community-generate.mjs <generate|verify> --contract <community.yaml> --home <HERMES_HOME> [--init]')
  process.exit(2)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  if (command !== 'generate' && command !== 'verify') usage(`unknown command ${JSON.stringify(command ?? '')}`)
  const opts = { command, init: false }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--contract') opts.contract = rest[++i]
    else if (arg === '--home') opts.home = rest[++i]
    else if (arg === '--init') opts.init = true
    else usage(`unknown argument ${JSON.stringify(arg)}`)
  }
  if (!opts.contract) usage('--contract <path> is required')
  if (!opts.home) usage('--home <path> is required')
  if (opts.command === 'verify' && opts.init) usage('--init only applies to generate')
  return opts
}

function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!isFile(opts.contract)) {
    console.error(`community-generate: contract file not found: ${opts.contract}`)
    process.exit(1)
  }
  const contractDir = path.dirname(path.resolve(opts.contract))
  const resolveSource = source => path.resolve(contractDir, source)

  let contract
  try {
    contract = loadContract(readFileSync(opts.contract, 'utf8'), {
      fileExists: source => isFile(resolveSource(source))
    })
  } catch (err) {
    if (err instanceof ContractError) {
      console.error(`community-generate: ${err.message}`)
      process.exit(1)
    }
    throw err
  }

  const readIfFile = p => (isFile(p) ? readFileSync(p, 'utf8') : undefined)

  // Deployment paths baked into the installed admin skills. generateCli is
  // THIS script; provisionCli is its sibling; installRoot is the home's parent
  // (the provisioning layout: <root>/engine + <root>/home — provision.mjs).
  const generateCli = fileURLToPath(import.meta.url)
  const homeDir = path.resolve(opts.home)
  const deployPaths = {
    HOME_DIR: homeDir,
    CONTRACT_PATH: path.resolve(opts.contract),
    INSTALL_ROOT: path.dirname(homeDir),
    GENERATE_CLI: generateCli,
    PROVISION_CLI: path.join(path.dirname(generateCli), 'community-provision.mjs')
  }
  const assetsDir = path.join(path.dirname(generateCli), '..', 'assets', 'community-skills')
  const communityPluginDir = path.join(path.dirname(generateCli), '..', 'hermes-plugin', 'community-archive')

  const artifacts = generateArtifacts(contract, {
    readKnowledgeSource: source => readFileSync(resolveSource(source), 'utf8'),
    readAdminSkillTemplate: name => readIfFile(path.join(assetsDir, name, 'SKILL.md')),
    readCommunityPluginFile: name => readIfFile(path.join(communityPluginDir, name)),
    deployPaths,
    existingConfigText: readIfFile(path.join(opts.home, 'config.yaml')),
    existingEnvText: readIfFile(path.join(opts.home, '.env')),
    readProfileConfigText: space => readIfFile(path.join(opts.home, 'profiles', space, 'config.yaml'))
  })

  if (opts.command === 'generate') {
    let result
    try {
      result = applyArtifacts(opts.home, artifacts, { init: opts.init })
    } catch (err) {
      if (err instanceof ApplyRefusedError) {
        console.error(`community-generate: ${err.message}`)
        process.exit(1)
      }
      throw err
    }
    for (const p of result.written) console.log(`written    ${p}`)
    for (const p of result.unchanged) console.log(`unchanged  ${p}`)
    console.log(
      `community-generate: OK — ${result.written.length} written, ${result.unchanged.length} unchanged for ${contract.groups.length} group(s) in ${contractSpaces(contract).length} space(s)`
    )
    return
  }

  // verify
  const report = verifyArtifacts(contract, artifacts, {
    readFile: relPath => {
      const abs = path.join(opts.home, relPath)
      return isFile(abs) ? readFileSync(abs, 'utf8') : null
    }
  })
  for (const entry of report.artifacts) {
    console.log(`${entry.status.padEnd(8)} ${entry.path}${entry.detail ? ` — ${entry.detail}` : ''}`)
  }
  if (!report.ok) {
    console.error('community-generate: DRIFT — the home does not match the contract (see above); re-run generate or update community.yaml')
    process.exit(1)
  }
  console.log(`community-generate: verify OK — ${report.artifacts.length} artifact(s) match the contract`)
}

main()
