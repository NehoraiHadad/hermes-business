import { CheckCircle2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { AppModals } from './components/AppModals'
import { MainScreen } from './components/MainScreen'
import { MiniShell } from './components/MiniShell'
import { ChatScreen } from './components/chat/ChatScreen'
import { ProviderModal } from './components/dialogs/ProviderModal'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { Onboarding } from './components/onboarding/Onboarding'
import { NAV_ITEMS } from './constants'
import { useAssistantWindow } from './hooks/useAssistantWindow'
import { useChat } from './hooks/useChat'
import { useHermesData } from './hooks/useHermesData'
import { useSupportActions } from './hooks/useSupportActions'
import { hermesClient } from './lib/hermes-client'
import { buildOnboardingPrompt } from './lib/onboarding-prompt'
import { buildVerifiedSnapshot } from './lib/onboarding-snapshot'
import type { Connection, ScheduledTask, Screen } from './types'

type FullSurface = 'desktop' | 'dashboard' | 'logs' | 'settings'

// Orchestration shell: owns the top-level screen/modal state and wires the data,
// window, chat and support hooks into the layout, mini and onboarding surfaces.
// Feature UI lives in ./components; Hermes/side-effect logic in ./hooks and ./lib.
export default function App() {
  const [screen, setScreen] = useState<Screen>('chat')
  const [modal, setModal] = useState<'task' | 'skill' | 'provider' | null>(null)
  const [connectionModal, setConnectionModal] = useState<Connection | null>(null)
  const [toast, setToast] = useState('')

  const forceOnboarding = new URLSearchParams(window.location.search).get('onboarding') === '1'
  const [showOnboarding, setShowOnboarding] = useState(
    forceOnboarding || (!hermesClient.demo && localStorage.getItem('hermes-business-onboarding-v1') !== 'complete')
  )

  const { runtime, setRuntime, sessions, tasks, setTasks, skills, setSkills, connections, setConnections, versions } =
    useHermesData()
  const { windowState, enterMini, expandWindow, togglePinned, hideWindow } = useAssistantWindow(showOnboarding)
  const chat = useChat({ setScreen, setToast })

  const openFull = useCallback((surface: FullSurface) => {
    if (window.hermesDesktop) {
      void window.hermesDesktop.openFull(surface)
    } else {
      setToast(`ביישום המותקן ייפתח כעת ${surface}`)
      window.setTimeout(() => setToast(''), 2500)
    }
  }, [])

  const support = useSupportActions({ setRuntime, setToast, openFull })

  const enterMiniFromChat = useCallback(async () => {
    setScreen('chat')
    await enterMini()
  }, [enterMini])

  const toggleTask = useCallback(
    async (task: ScheduledTask) => {
      await hermesClient.toggleTask(task)
      setTasks(current => current.map(item => (item.id === task.id ? { ...item, enabled: !item.enabled } : item)))
    },
    [setTasks]
  )

  const title =
    screen === 'chat'
      ? sessions.find(item => item.id === chat.activeSession)?.title || 'שיחה חדשה'
      : NAV_ITEMS.find(item => item.id === screen)?.label || ''

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

  const providerModal = (
    <ProviderModal
      onClose={() => setModal(null)}
      onConnect={async (provider, key) => {
        await hermesClient.connectProvider(provider, key)
        setToast('ספק ה־AI חובר בהצלחה')
      }}
    />
  )

  if (showOnboarding) {
    return (
      <>
        <Onboarding
          runtime={runtime}
          onProvider={() => setModal('provider')}
          onComplete={async data => {
            const snapshot = buildVerifiedSnapshot({ runtime, skills, tasks, connections })
            await chat.beginConversation({
              userMessage: 'סיימתי את ההיכרות הראשונית. שמור אותה ב־Hermes והמשך איתי לשאלה הבאה.',
              submitText: buildOnboardingPrompt(data, snapshot)
            })
            localStorage.setItem('hermes-business-onboarding-v1', 'complete')
            setShowOnboarding(false)
            setToast('הפרטים נמסרו ל־Hermes; העוזר שומר אותם וממשיך איתך')
          }}
        />
        {modal === 'provider' ? providerModal : null}
      </>
    )
  }

  if (windowState.mode === 'mini') {
    return (
      <MiniShell
        runtime={runtime}
        pinned={windowState.alwaysOnTop}
        toast={toast}
        chatScreen={chatScreen}
        onNewSession={chat.newSession}
        onTogglePin={togglePinned}
        onExpand={expandWindow}
        onHide={hideWindow}
      />
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        screen={screen}
        setScreen={setScreen}
        sessions={sessions}
        activeSession={chat.activeSession}
        onSelectSession={chat.selectSession}
        onNewSession={chat.newSession}
        runtime={runtime}
        taskCount={tasks.length}
      />
      <div className="app-main">
        <Topbar title={title} runtime={runtime} onOpenFull={openFull} onMini={enterMiniFromChat} />
        <MainScreen
          screen={screen}
          chatScreen={chatScreen}
          tasks={tasks}
          skills={skills}
          connections={connections}
          runtime={runtime}
          versions={versions}
          support={support}
          toast={toast}
          onAddTask={() => setModal('task')}
          onToggleTask={toggleTask}
          onAddSkill={() => setModal('skill')}
          onOpenConnection={setConnectionModal}
        />
      </div>
      <AppModals
        modal={modal}
        connectionModal={connectionModal}
        onCloseModal={() => setModal(null)}
        onCloseConnection={() => setConnectionModal(null)}
        setTasks={setTasks}
        setSkills={setSkills}
        setConnections={setConnections}
        setToast={setToast}
      />
      {modal === 'provider' ? providerModal : null}
      {toast && screen !== 'support' ? (
        <div className="floating-toast">
          <CheckCircle2 size={17} /> {toast}
        </div>
      ) : null}
    </div>
  )
}
