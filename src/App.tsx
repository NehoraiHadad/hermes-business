import { useCallback, useEffect, useState } from 'react'
import { AppModalLayer, type ModalKind } from './components/AppModalLayer'
import { FullAppShell } from './components/FullAppShell'
import { MiniShell } from './components/MiniShell'
import { OnboardingSurface } from './components/OnboardingSurface'
import { ChatScreen } from './components/chat/ChatScreen'
import { NAV_ITEMS } from './constants'
import { useAssistantWindow } from './hooks/useAssistantWindow'
import { useChat } from './hooks/useChat'
import { useHermesData } from './hooks/useHermesData'
import { useSupportActions } from './hooks/useSupportActions'
import { useTaskActions } from './hooks/useTaskActions'
import { hermesClient } from './lib/hermes-client'
import { verifyBusinessContextPersisted } from './lib/business-context'
import type { Connection, Screen } from './types'

type FullSurface = 'desktop' | 'dashboard' | 'logs' | 'settings'
// The onboarding gate starts UNRESOLVED. We never skip onboarding from a localStorage
// flag alone — the durable, owned business-context skill is the only authority.
type OnboardingGate = 'resolving' | 'onboarding' | 'ready'
const ONBOARDING_CACHE_KEY = 'hermes-business-onboarding-v1'

export default function App() {
  const [screen, setScreen] = useState<Screen>('chat')
  const [modal, setModal] = useState<ModalKind>(null)
  const [connectionModal, setConnectionModal] = useState<Connection | null>(null)
  const [toast, setToast] = useState('')
  const forceOnboarding = new URLSearchParams(window.location.search).get('onboarding') === '1'
  // Start resolving (not "skip") so we ALWAYS validate durable state before deciding.
  const [gate, setGate] = useState<OnboardingGate>(
    forceOnboarding ? 'onboarding' : hermesClient.demo ? 'ready' : 'resolving'
  )
  const showOnboarding = gate === 'onboarding'

  const data = useHermesData()
  const setTasks = data.setTasks

  // First-run / resume resolution. localStorage is a CACHE ONLY — it never skips
  // onboarding. Once the runtime has booted we re-read and VERIFY the durable, owned
  // business-context skill (exact ownership + checksum). A missing/invalid/corrupt/
  // foreign artifact (or a failed read) fails CLOSED to onboarding; only a positively
  // verified artifact resolves to 'ready'. The stale cache is cleared when unverified.
  useEffect(() => {
    if (gate !== 'resolving' || data.runtime === null) return
    // No durable skill can be verified while the runtime is down. Resolve
    // immediately to onboarding, which owns the honest install/retry surface,
    // instead of starting another IPC request that could keep the splash alive.
    if (!data.runtime.running) {
      localStorage.removeItem(ONBOARDING_CACHE_KEY)
      setGate('onboarding')
      return
    }
    let alive = true
    void verifyBusinessContextPersisted(hermesClient)
      .then(valid => {
        if (!alive) return
        if (valid) {
          localStorage.setItem(ONBOARDING_CACHE_KEY, 'complete')
          setGate('ready')
        } else {
          localStorage.removeItem(ONBOARDING_CACHE_KEY)
          setGate('onboarding')
        }
      })
      .catch(() => {
        if (alive) setGate('onboarding')
      })
    return () => {
      alive = false
    }
  }, [gate, data.runtime, data.skills])
  const windowControls = useAssistantWindow(showOnboarding)
  const chat = useChat({ setScreen, setToast })

  const openFull = useCallback((surface: FullSurface) => {
    if (window.hermesDesktop) void window.hermesDesktop.openFull(surface)
    else {
      setToast(`ביישום המותקן ייפתח כעת ${surface}`)
      window.setTimeout(() => setToast(''), 2500)
    }
  }, [])
  const support = useSupportActions({ setRuntime: data.setRuntime, setToast, openFull })
  const openConnection = useCallback(
    (id: string) => {
      const connection = data.connections.find(item => item.id === id)
      if (connection) setConnectionModal(connection)
    },
    [data.connections]
  )
  const enterMiniFromChat = useCallback(async () => {
    setScreen('chat')
    await windowControls.enterMini()
  }, [windowControls])
  const taskActions = useTaskActions({ setTasks, setToast })

  const title =
    screen === 'chat'
      ? data.sessions.find(item => item.id === chat.activeSession)?.title || 'שיחה חדשה'
      : NAV_ITEMS.find(item => item.id === screen)?.label ||
        (({ skills: 'ידע והכוונה', connections: 'חיבורים', support: 'עזרה ותמיכה' } as Partial<Record<Screen, string>>)[screen] ?? '')
  const chatScreen = (
    <ChatScreen
      messages={chat.messages}
      activities={chat.activities}
      approval={chat.approval}
      clarify={chat.clarify}
      busy={chat.busy}
      onSend={chat.sendMessage}
      onStop={chat.stop}
      onApproval={chat.respondApproval}
      onClarify={chat.respondClarify}
    />
  )
  const modalLayer = (
    <AppModalLayer
      modal={modal}
      connection={connectionModal}
      closeModal={() => setModal(null)}
      closeConnection={() => setConnectionModal(null)}
      setTasks={data.setTasks}
      setSkills={data.setSkills}
      setConnections={data.setConnections}
      setToast={setToast}
      onRefresh={data.refresh}
    />
  )

  // Still resolving the durable artifact — never flash either the app or onboarding
  // until we have positively decided (fail-closed to onboarding otherwise).
  if (gate === 'resolving') {
    return (
      <div className="app-resolving" role="status" aria-live="polite">
        <span>טוען את ההקשר של העסק…</span>
      </div>
    )
  }

  if (showOnboarding) {
    return (
      <OnboardingSurface
        runtime={data.runtime}
        connections={data.connections}
        skills={data.skills}
        tasks={data.tasks}
        providerStatus={data.providerStatus}
        installing={data.installing}
        installError={data.installError}
        onInstall={data.ensureInstalled}
        onProvider={() => setModal('provider')}
        beginConversation={chat.beginConversation}
        onFinished={({ introStarted }) => {
          setGate('ready')
          setToast(
            introStarted
              ? 'הפרטים נשמרו ב־Hermes; העוזר שומר אותם וממשיך איתך'
              : 'הפרטים נשמרו ב־Hermes, אך שיחת הפתיחה לא נפתחה — אפשר לפנות לעוזר בצ׳אט כדי להמשיך'
          )
        }}
      >
        {modalLayer}
      </OnboardingSurface>
    )
  }

  if (windowControls.windowState.mode === 'mini') {
    return (
      <MiniShell
        runtime={data.runtime}
        pinned={windowControls.windowState.alwaysOnTop}
        toast={toast}
        chatScreen={chatScreen}
        onNewSession={chat.newSession}
        onTogglePin={windowControls.togglePinned}
        onExpand={windowControls.expandWindow}
        onHide={windowControls.hideWindow}
      />
    )
  }

  return (
    <FullAppShell
      screen={screen}
      setScreen={setScreen}
      title={title}
      data={data}
      chat={chat}
      support={support}
      toast={toast}
      chatScreen={chatScreen}
      modalLayer={modalLayer}
      onOpenFull={openFull}
      onMini={enterMiniFromChat}
      onAddTask={() => setModal('task')}
      taskActions={taskActions}
      onAddSkill={() => setModal('skill')}
      onOpenConnection={setConnectionModal}
    />
  )
}
