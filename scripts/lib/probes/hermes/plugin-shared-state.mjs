// Proof that the OFFICIALLY-installed business-shell Desktop plugin (disk door)
// discovers, enables, renders, and shares ONE isolated HERMES_HOME with the
// official Hermes surfaces — then uninstalls to zero residue. Every step runs
// the real runtime-loader pipeline (plugin-loader.mjs) and the live gateway.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { flattenSkillNames } from '../../hermes-live.mjs'
import { AREAS, createCaptureContext, loadRuntimePlugin } from './plugin-loader.mjs'
import { buildSdk } from './plugin-sdk-shim.mjs'
import { BOOTSTRAP_SKILL, PLUGIN_ID, repoRoot, scanDesktopPlugins, uninstallBusinessShell } from './plugin-install.mjs'

const under = (child, parent) => path.resolve(child).toLowerCase().startsWith(path.resolve(parent).toLowerCase() + path.sep)

/**
 * @param install receipt from installBusinessShell(home), performed BEFORE the
 *   server booted so the gateway scans the bootstrap Skill at startup.
 */
export async function provePluginSharedState({ harness, home, storedSessionId, install }) {
  const { rpc, stage } = harness

  // 1) Discovery — the disk door the renderer walks: <home>/desktop-plugins/*.
  const discovered = scanDesktopPlugins(home)
  const entry = discovered.find(p => p.name === PLUGIN_ID)
  if (!entry) throw new Error('business-shell not present in the desktop-plugins disk door')
  if (!under(entry.file, home)) throw new Error('plugin discovered outside the isolated home')
  stage(`official disk door lists ${discovered.length} plugin(s); business-shell present`)

  // 2) Load through the exact official pipeline (integrity -> rewrite -> import
  //    -> validate default export), against the LIVE isolated gateway.
  const source = readFileSync(entry.file, 'utf8')
  const bytes = readFileSync(entry.file)
  const sdk = buildSdk({ React, rpc })
  const plugin = await loadRuntimePlugin({ source, bytes, integrity: install.integrity, sdk, React })
  if (plugin.id !== PLUGIN_ID) throw new Error(`unexpected plugin id ${plugin.id}`)
  const enabled = plugin.defaultEnabled ?? true // pluginActive(): no decision -> defaultEnabled
  const { ctx, contributions } = createCaptureContext(plugin.id)
  plugin.register(ctx)

  const route = contributions.find(c => c.area === AREAS.routes)
  const nav = contributions.find(c => c.area === AREAS.sidebarNav)
  const palette = contributions.find(c => c.area === AREAS.palette)
  if (!enabled) throw new Error('business-shell did not resolve as enabled')
  if (route?.data?.path !== '/business') throw new Error('business-shell did not contribute its /business route')
  if (!nav) throw new Error('business-shell did not contribute a sidebar entry')
  const inventory = { id: plugin.id, name: plugin.name, kind: 'disk', status: 'loaded', enabled, file: entry.file }
  stage(`runtime loader registered business-shell: enabled=${enabled}, route=${route.data.path}, sidebar+palette present`)

  // 3) Same isolated state — the plugin's own host.request door returns the very
  //    rows the official surfaces do (one HERMES_HOME, no second store).
  const readiness = await sdk.evaluateRuntimeReadiness(sdk.host.request)
  const sessions = await sdk.host.request('session.list', { limit: 50 })
  const sessionRows = Array.isArray(sessions?.sessions) ? sessions.sessions : []
  if (storedSessionId && !sessionRows.some(s => s.id === storedSessionId)) {
    throw new Error('plugin host.request(session.list) does not see the shared session')
  }
  const cron = await sdk.host.request('cron.manage', { action: 'list' })
  const skillsResult = await sdk.host.request('skills.manage', { action: 'list' })
  const skillNames = new Set(flattenSkillNames(skillsResult?.skills || skillsResult))
  if (!skillNames.has(BOOTSTRAP_SKILL)) {
    throw new Error('bootstrap Skill from the plugin install contract is not visible via skills.manage')
  }
  stage('plugin host.request door shares the isolated session/cron/skill state with official surfaces')

  // 4) Render the plugin route provider-free — opening the surface needs no model.
  const markup = renderToStaticMarkup(route.render())
  if (!markup.includes('בית') || !markup.includes('Hermes')) {
    throw new Error('business-shell route did not render its shell markup')
  }
  stage(`plugin route rendered to ${markup.length} bytes of static markup with no provider configured`)

  // Skill vs plugin — the packaged desktop-plugin contract ships BOTH, distinctly.
  const skillOnDisk = install.skillTarget
  const distinction = {
    plugin: { id: PLUGIN_ID, is_desktop_plugin: true, in_skill_registry: skillNames.has(PLUGIN_ID), file: entry.file },
    packaged_skill: {
      name: BOOTSTRAP_SKILL,
      is_skill: skillNames.has(BOOTSTRAP_SKILL),
      on_disk: existsSync(skillOnDisk),
      in_plugin_inventory: contributions.some(c => c.id.includes(BOOTSTRAP_SKILL))
    },
    separate_policy_plugin: {
      id: 'business-whatsapp-policy',
      part_of_desktop_plugin_contract: false,
      is_distinct_package: existsSync(path.join(repoRoot, 'hermes-plugin', 'business-whatsapp-policy'))
    }
  }
  if (distinction.plugin.in_skill_registry) throw new Error('the plugin must not appear as a Skill')
  if (distinction.packaged_skill.in_plugin_inventory) throw new Error('the Skill must not appear as a plugin contribution')

  // 5) Uninstall -> re-scan -> zero residue; live HERMES_HOME never touched.
  uninstallBusinessShell(home)
  const afterScan = scanDesktopPlugins(home)
  if (afterScan.some(p => p.name === PLUGIN_ID)) throw new Error('plugin folder survived uninstall')
  const residueGone = !existsSync(entry.file) && !existsSync(path.dirname(entry.file))
  const allWritesIsolated = [install.targetDir, install.target, install.skillTarget, install.receiptPath].every(p => under(p, home))
  if (!residueGone || !allWritesIsolated) throw new Error('uninstall left residue or wrote outside the isolated home')
  stage('plugin uninstalled: disk door empty, zero residue, all writes confined to the isolated home')

  return {
    installed_via: 'official disk door: <home>/desktop-plugins/business-shell/plugin.js (+ integrity receipt)',
    discovery: { disk_door_count: discovered.length, business_shell_present: true, integrity_verified: true },
    inventory,
    contributions: contributions.map(c => ({ id: c.id, area: c.area, path: c.data?.path })),
    shared_state: {
      provider_ready: readiness.ready,
      session_visible_via_plugin_host: Boolean(storedSessionId),
      cron_list_ok: Array.isArray(cron?.jobs) || Array.isArray(cron),
      bootstrap_skill_visible: true,
      skill_count: skillNames.size
    },
    route_render: { provider_free: true, markup_bytes: markup.length },
    plugin_vs_skill: distinction,
    uninstall: { disk_door_empty: afterScan.length === 0, residue_gone: residueGone, writes_confined_to_isolated_home: allWritesIsolated }
  }
}
