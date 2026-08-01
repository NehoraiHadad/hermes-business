import { useCallback, useState } from 'react'
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
import type { Connection, Screen } from './types'

type FullSurface = 'desktop' | 'dashboard' | 'logs' | 'settings'

export default function App() {
  const [screen, setScreen] = useState<Screen>('chat')
  const [modal, setModal] = useState<ModalKind>(null)
  const [connectionModal, setConnectionModal] = useState<Connection | null>(null)
  const [toast, setToast] = useState('')
  const forceOnboarding = new URLSearchParams(window.location.search).get('onboarding') === '1'
  const [showOnboarding, setShowOnboarding] = useState(
    forceOnboarding || (!hermesClient.demo && localStorage.getItem('hermes-business-onboarding-v1') !== 'complete')
  )

  const data = useHermesData()
  const setTasks = data.setTasks
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
    />
  )

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
        onConnection={openConnection}
        beginConversation={chat.beginConversation}
        onFinished={() => {
          setShowOnboarding(false)
          setToast('הפרטים נמסרו ל־Hermes; העוזר שומר אותם וממשיך איתך')
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
