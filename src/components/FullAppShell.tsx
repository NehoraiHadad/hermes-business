import { CheckCircle2 } from 'lucide-react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { useChat } from '../hooks/useChat'
import type { useHermesData } from '../hooks/useHermesData'
import type { useSupportActions } from '../hooks/useSupportActions'
import type { Connection, Screen, TaskActions } from '../types'
import { MainScreen } from './MainScreen'
import { Sidebar } from './layout/Sidebar'
import { Topbar } from './layout/Topbar'

type FullSurface = 'desktop' | 'dashboard' | 'logs' | 'settings'

export function FullAppShell({
  screen,
  setScreen,
  title,
  data,
  chat,
  support,
  toast,
  chatScreen,
  modalLayer,
  onOpenFull,
  onMini,
  onAddTask,
  taskActions,
  onAddSkill,
  onOpenConnection
}: {
  screen: Screen
  setScreen: Dispatch<SetStateAction<Screen>>
  title: string
  data: ReturnType<typeof useHermesData>
  chat: ReturnType<typeof useChat>
  support: ReturnType<typeof useSupportActions>
  toast: string
  chatScreen: ReactNode
  modalLayer: ReactNode
  onOpenFull: (surface: FullSurface) => void
  onMini: () => Promise<void>
  onAddTask: () => void
  taskActions: TaskActions
  onAddSkill: () => void
  onOpenConnection: (connection: Connection) => void
}) {
  return (
    <div className="app-shell">
      <Sidebar
        screen={screen}
        setScreen={setScreen}
        sessions={data.sessions}
        activeSession={chat.activeSession}
        onSelectSession={chat.selectSession}
        onNewSession={chat.newSession}
        runtime={data.runtime}
        taskCount={data.tasks.length}
      />
      <div className="app-main">
        <Topbar title={title} runtime={data.runtime} onOpenFull={onOpenFull} onMini={onMini} />
        <MainScreen
          screen={screen}
          chatScreen={chatScreen}
          tasks={data.tasks}
          skills={data.skills}
          connections={data.connections}
          runtime={data.runtime}
          versions={data.versions}
          provider={data.provider}
          support={support}
          toast={toast}
          onAddTask={onAddTask}
          taskActions={taskActions}
          onAddSkill={onAddSkill}
          onOpenConnection={onOpenConnection}
        />
      </div>
      {modalLayer}
      {toast && screen !== 'support' ? (
        <div className="floating-toast"><CheckCircle2 size={17} /> {toast}</div>
      ) : null}
    </div>
  )
}
