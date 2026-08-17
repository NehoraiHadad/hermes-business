// SINGLE SOURCE OF TRUTH for the thin-bootstrap install payload item list.
//
// The payload is staged/required by FOUR independent surfaces that have no
// shared code path and have drifted from each other before (see the
// tachles-welcome.SKILL.md / business-partner.SKILL.md incident where
// scripts/e2e-bootstrap-clean.ps1 staged neither, so the E2E hard-threw
// "Cannot hash a file that does not exist" even though the three real install
// doors were correct):
//   - nsis           installer/business-bootstrap.nsi        (NSIS `File` list)
//   - electron       electron/plugin-install.cjs (+ electron/backend-install.cjs)
//   - businessInstall installer/lib/BusinessInstall.ps1 (+ installer/lib/BackendEnable.ps1)
//                     — the door that ACTUALLY REQUIRES the payload at install time
//   - e2e            scripts/e2e-bootstrap-clean.ps1          (the clean-install harness)
//
// scripts/payload-manifest-contract.test.ts parses each surface's source text
// and fails the build if any surface is missing an item this manifest says it
// must ship, or ships a root item this manifest doesn't know about. Edit HERE
// first when the payload changes, then update every door in `doors`.
//
// ROOT_PAYLOAD_ITEMS are individual files installed directly under the
// payload root ($PayloadRoot / $INSTDIR). PAYLOAD_SECTIONS are whole
// sub-directories whose OWN per-file list is already single-sourced
// elsewhere (electron/paths.cjs DESKTOP_BACKEND_FILES / WHATSAPP_POLICY_PLUGIN_FILES,
// electron/plugin-install.cjs COMMUNITY_REQUIRED_FILES) — this manifest only
// asserts every door stages/expects the section itself, not its per-file
// contents, so those lists stay single-sourced rather than triplicated here.

export const DOORS = Object.freeze(['nsis', 'electron', 'businessInstall', 'e2e'])

export const ROOT_PAYLOAD_ITEMS = Object.freeze([
  {
    name: 'plugin.js',
    repoSource: 'hermes-plugin/business-shell/plugin.js',
    doors: ['nsis', 'electron', 'businessInstall', 'e2e']
  },
  {
    name: 'business-bootstrap.SKILL.md',
    repoSource: 'hermes-plugin/business-shell/skills/business-bootstrap/SKILL.md',
    doors: ['nsis', 'electron', 'businessInstall', 'e2e']
  },
  {
    name: 'tachles-welcome.SKILL.md',
    repoSource: 'hermes-plugin/business-shell/skills/tachles-welcome/SKILL.md',
    doors: ['nsis', 'electron', 'businessInstall', 'e2e']
  },
  {
    name: 'business-partner.SKILL.md',
    repoSource: 'hermes-plugin/business-partner/SKILL.md',
    doors: ['nsis', 'electron', 'businessInstall', 'e2e']
  },
  {
    name: 'bootstrap-companion.ps1',
    repoSource: 'installer/bootstrap-companion.ps1',
    // Consumed by bootstrap.ps1's companion-install path, not by
    // Install-BusinessPayload — so this door is intentionally excluded.
    doors: ['nsis', 'electron', 'e2e']
  }
])

export const PAYLOAD_SECTIONS = Object.freeze([
  {
    name: 'dashboard',
    required: false,
    filesSource: 'electron/paths.cjs:DESKTOP_BACKEND_FILES',
    doors: ['nsis', 'electron', 'businessInstall', 'e2e']
  },
  {
    name: 'whatsapp-policy',
    required: false,
    filesSource: 'electron/paths.cjs:WHATSAPP_POLICY_PLUGIN_FILES',
    doors: ['nsis', 'electron', 'businessInstall', 'e2e']
  },
  {
    name: 'community',
    required: true,
    filesSource: 'electron/plugin-install.cjs:COMMUNITY_REQUIRED_FILES',
    doors: ['nsis', 'electron', 'businessInstall', 'e2e']
  }
])
