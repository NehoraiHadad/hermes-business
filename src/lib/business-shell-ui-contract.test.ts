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

  it('never renders a failed tasks/connections read as a confident healthy state', () => {
    const mainScreen = read('src/components/MainScreen.tsx')
    const tasksScreen = read('src/components/screens/TasksScreen.tsx')
    const connectionsScreen = read('src/components/screens/ConnectionsScreen.tsx')

    // MainScreen must forward the authoritative read-failure flags into both
    // screens, not just SupportScreen — otherwise a failed LIST read renders as
    // a healthy "0 משימות" / "נדרשת הגדרה" instead of an honest error.
    expect(mainScreen).toContain('loadError={loadErrors?.tasks}')
    expect(mainScreen).toContain('loadError={loadErrors?.connections}')

    // TasksScreen: an explicit error branch (never a confident "0"/dash), plus a
    // real empty state for the genuinely-empty case.
    expect(tasksScreen).toContain('loadError?: boolean')
    expect(tasksScreen).toContain('לא הצלחנו לקרוא את המשימות המתוזמנות')
    expect(tasksScreen).toContain("activeCount === null ? 'לא ידוע'")
    expect(tasksScreen).toContain("nextRun === null ? 'לא ידוע'")
    expect(tasksScreen).toContain('אין עדיין משימות מתוזמנות')

    // ConnectionsScreen: an explicit error branch instead of "נדרשת הגדרה"-style
    // confident-negative rendering of an unread state.
    expect(connectionsScreen).toContain('loadError?: boolean')
    expect(connectionsScreen).toContain('לא הצלחנו לבדוק את מצב החיבורים')
  })

  it('never lets a task-toggle rejection become a silent unhandled promise', () => {
    // No component-render harness exists in this repo (no jsdom/testing-library), so
    // this pins the extractable contract at the source level: onToggle must catch +
    // notify exactly like its onTrigger/onDelete siblings, and every TaskActions
    // signature must be honest about being async (matches the real implementation),
    // not the `=> void` lie that hid the original unhandled-rejection bug.
    const hook = read('src/hooks/useTaskActions.ts')
    const types = read('src/types.ts')

    const onToggleBody = hook.match(/onToggle:\s*async task\s*=>\s*\{([\s\S]*?)\n {6}\},/)?.[1] || ''
    expect(onToggleBody).toContain('try {')
    expect(onToggleBody).toContain('catch (error)')
    expect(onToggleBody).toMatch(/notify\(error instanceof Error \? error\.message : /)

    expect(types).toContain('onToggle: (task: ScheduledTask) => Promise<void>')
    expect(types).toContain('onTrigger: (task: ScheduledTask) => Promise<void>')
    expect(types).toContain('onDelete: (task: ScheduledTask) => Promise<void>')
  })
})
