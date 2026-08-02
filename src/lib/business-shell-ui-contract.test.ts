import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..', '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

describe('simple business shell UI contract', () => {
  it('keeps full-window content below the native Windows title bar overlay', () => {
    const windowSource = read('electron/window-create.cjs')
    const sidebarCss = read('src/styles/sidebar.css')
    const topbarCss = read('src/styles/topbar.css')
    const overlayHeight = Number(windowSource.match(/titleBarOverlay:.*height:\s*(\d+)/)?.[1])
    const sidebarTop = Number(sidebarCss.match(/\.sidebar\s*\{[\s\S]*?padding:\s*(\d+)px/)?.[1])
    const topbarTop = Number(topbarCss.match(/\.topbar\s*\{[\s\S]*?padding:\s*(\d+)px/)?.[1])

    expect(overlayHeight).toBeGreaterThan(0)
    expect(sidebarTop).toBeGreaterThan(overlayHeight)
    expect(topbarTop).toBeGreaterThanOrEqual(overlayHeight)
  })

  it('shows personal WhatsApp normally and explains the third-party API risk', () => {
    const screen = read('src/components/screens/ConnectionsScreen.tsx')
    const constants = read('src/constants.ts')

    expect(screen).not.toContain('אפשרויות ניסיוניות')
    expect(screen).toContain('API צד שלישי')
    expect(screen).toContain('{connections.map(')
    expect(constants).toContain('חיבור אישי באמצעות סריקת QR ו־API צד שלישי')
  })
})
