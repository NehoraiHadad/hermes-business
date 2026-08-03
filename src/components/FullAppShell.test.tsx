// @vitest-environment jsdom
import '../test/setup-dom'
import { StrictMode, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FullAppShell } from './FullAppShell'
import { useToasts } from '../hooks/useToasts'
import { emitCompanionUpdateAvailable } from '../test/hermes-bridge'
import { resolveProviderStatus } from '../lib/provider-readiness'
import { FAIL_CLOSED_RUNTIME } from '../test/hermes-bridge'
import type { useChat } from '../hooks/useChat'
import type { useHermesData } from '../hooks/useHermesData'
import type { useSupportActions } from '../hooks/useSupportActions'
import type { Screen, TaskActions } from '../types'

// B1 fix (docs/specs/versioning.md §7.2): before this, the passive companion-update
// push (hermes:companion-update-available) had no reachable subscriber outside the
// support screen — no toast, no nav indicator, dismiss() never called. FullAppShell
// now owns a single always-mounted subscription. These tests drive it end-to-end
// through the real Topbar (gear button + "עזרה ותמיכה" row) rather than reaching
// into FullAppShell internals, so they also prove the wiring (setToast prop,
// Sidebar/Topbar indicator prop, screen-driven dismissal) actually connects.

const DISMISSED_KEY = 'tachles.companionUpdate.dismissedVersion'

function buildData(): ReturnType<typeof useHermesData> {
  return {
    runtime: { ...FAIL_CLOSED_RUNTIME },
    setRuntime: vi.fn(),
    sessions: [],
    tasks: [],
    setTasks: vi.fn(),
    skills: [],
    setSkills: vi.fn(),
    connections: [],
    provider: { connected: false, label: '' },
    providerStatus: resolveProviderStatus({ runtime: null }),
    setConnections: vi.fn(),
    versions: {},
    installing: false,
    installError: '',
    loadErrors: { tasks: false, connections: false },
    ensureInstalled: vi.fn(async () => ({ ...FAIL_CLOSED_RUNTIME })),
    refresh: vi.fn(async () => ({ ...FAIL_CLOSED_RUNTIME })),
    fetchSessions: vi.fn(async () => {}),
    fetchSchedule: vi.fn(async () => {}),
    fetchConnections: vi.fn(async () => {})
  }
}

function buildChat(): ReturnType<typeof useChat> {
  return {
    messages: [],
    activities: [],
    approval: null,
    clarify: null,
    busy: false,
    runtimeSession: '',
    activeSession: '',
    selectSession: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => true),
    stop: vi.fn(),
    respondApproval: vi.fn(async () => {}),
    respondClarify: vi.fn(async () => {}),
    beginConversation: vi.fn(async () => {})
  }
}

function buildSupport(): ReturnType<typeof useSupportActions> {
  return {
    checking: false,
    restarting: false,
    updating: false,
    updateStatus: null,
    onHealth: vi.fn(),
    onRestart: vi.fn(),
    onLogs: vi.fn(),
    onDiagnostics: vi.fn(),
    onUpdateCheck: vi.fn(),
    onUpdateApply: vi.fn()
  }
}

function buildTaskActions(): TaskActions {
  return {
    onToggle: vi.fn(async () => {}),
    onTrigger: vi.fn(async () => {}),
    onEdit: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {})
  }
}

function Harness({
  initialScreen = 'chat',
  strict = false,
  notifySpy
}: {
  initialScreen?: Screen
  strict?: boolean
  notifySpy?: (message: string, severity?: 'info' | 'error') => void
}) {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const { toast, notify } = useToasts()
  const setToast = (message: string, severity?: 'info' | 'error') => {
    notifySpy?.(message, severity)
    notify(message, severity)
  }
  const tree = (
    <FullAppShell
      screen={screen}
      setScreen={setScreen}
      title="בדיקה"
      data={buildData()}
      chat={buildChat()}
      support={buildSupport()}
      toast={toast}
      setToast={setToast}
      chatScreen={<div>chat-screen</div>}
      modalLayer={null}
      onOpenFull={vi.fn()}
      onMini={vi.fn(async () => {})}
      onAddTask={vi.fn()}
      taskActions={buildTaskActions()}
      onAddSkill={vi.fn()}
      onOpenConnection={vi.fn()}
      onOpenSession={vi.fn()}
    />
  )
  return strict ? <StrictMode>{tree}</StrictMode> : tree
}

function gearButton() {
  return screen.getByRole('button', { name: /הגדרות ועזרה/ })
}

const PUSHED_VERDICT: CompanionUpdateStatus = {
  status: 'update-available',
  current: '0.4.0',
  latest: '0.5.0',
  checkedAt: 1000
}

afterEach(() => {
  localStorage.clear()
})

describe('FullAppShell — passive companion-update surface (B1)', () => {
  it('a pushed update-available verdict shows the one-time toast and sets the nav indicator', () => {
    render(<Harness />)

    act(() => {
      emitCompanionUpdateAvailable(PUSHED_VERDICT)
    })

    expect(screen.getByText("גרסה חדשה של תכל'ס זמינה — פרטים במסך תמיכה")).toBeInTheDocument()
    expect(gearButton()).toHaveAccessibleName(/עדכון חדש זמין/)
  })

  it('a version already dismissed in a prior session never re-announces (no toast, no indicator)', () => {
    localStorage.setItem(DISMISSED_KEY, '0.5.0')
    render(<Harness />)

    act(() => {
      emitCompanionUpdateAvailable(PUSHED_VERDICT)
    })

    expect(screen.queryByText(/גרסה חדשה של תכל'ס זמינה/)).not.toBeInTheDocument()
    expect(gearButton()).toHaveAccessibleName('הגדרות ועזרה')
  })

  it('entering the support screen persists the dismissal and clears the indicator', async () => {
    const user = userEvent.setup()
    render(<Harness initialScreen="chat" />)

    act(() => {
      emitCompanionUpdateAvailable(PUSHED_VERDICT)
    })
    expect(gearButton()).toHaveAccessibleName(/עדכון חדש זמין/)
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull()

    await user.click(gearButton())
    const menu = screen.getByRole('button', { name: /עזרה ותמיכה/ })
    // The dot is a decorative aria-hidden span inside the row (no accessible
    // role/text of its own) — confirm it is there before navigating away, so the
    // "cleared" assertion below is meaningful (not just "was never rendered").
    expect(menu.querySelector('.dropdown-menu__update-dot')).not.toBeNull()
    await user.click(menu)

    expect(localStorage.getItem(DISMISSED_KEY)).toBe('0.5.0')
    expect(gearButton()).toHaveAccessibleName('הגדרות ועזרה')
  })

  it('StrictMode double-mount never double-announces the same pushed version', () => {
    render(<Harness strict />)

    act(() => {
      emitCompanionUpdateAvailable(PUSHED_VERDICT)
    })

    // Single-slot toast channel: only one message can ever be on screen at a
    // time, so this also proves the effect's subscribe/unsubscribe/resubscribe
    // dance under StrictMode settled on exactly one active listener.
    expect(screen.getAllByText("גרסה חדשה של תכל'ס זמינה — פרטים במסך תמיכה")).toHaveLength(1)
  })

  it('a repeated push for the same version (defensive) never re-triggers the toast callback twice', () => {
    const notifySpy = vi.fn()
    render(<Harness notifySpy={notifySpy} />)

    act(() => {
      emitCompanionUpdateAvailable(PUSHED_VERDICT)
      emitCompanionUpdateAvailable(PUSHED_VERDICT)
    })

    expect(notifySpy).toHaveBeenCalledTimes(1)
  })
})
