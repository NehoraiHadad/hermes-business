import type { ReactNode } from 'react'
import type { useSupportActions } from '../hooks/useSupportActions'
import type { LoadErrors } from '../lib/health'
import type { ProviderStatus } from '../lib/provider-readiness'
import type { Connection, ScheduledTask, Screen, Skill, TaskActions } from '../types'
import { ConnectionsScreen } from './screens/ConnectionsScreen'
import { SkillsScreen } from './screens/SkillsScreen'
import { SupportScreen } from './screens/SupportScreen'
import { TasksScreen } from './screens/TasksScreen'

// Routes the active full-window screen. App owns the state and data mutations and
// passes them in; this keeps the shell's render tree flat and the switch in one
// obvious place.
export function MainScreen({
  screen,
  chatScreen,
  tasks,
  skills,
  connections,
  runtime,
  versions,
  provider,
  loadErrors,
  support,
  toast,
  onAddTask,
  taskActions,
  onAddSkill,
  onOpenConnection
}: {
  screen: Screen
  chatScreen: ReactNode
  tasks: ScheduledTask[]
  skills: Skill[]
  connections: Connection[]
  runtime: HermesRuntime | null
  versions: Record<string, string>
  provider: ProviderStatus
  loadErrors?: LoadErrors
  support: ReturnType<typeof useSupportActions>
  toast: string
  onAddTask: () => void
  taskActions: TaskActions
  onAddSkill: () => void
  onOpenConnection: (connection: Connection) => void
}) {
  if (screen === 'tasks') {
    return <TasksScreen tasks={tasks} onAdd={onAddTask} actions={taskActions} />
  }
  if (screen === 'skills') return <SkillsScreen skills={skills} onAdd={onAddSkill} />
  if (screen === 'connections') return <ConnectionsScreen connections={connections} onConnect={onOpenConnection} />
  if (screen === 'support') {
    return (
      <SupportScreen
        runtime={runtime}
        versions={versions}
        tasks={tasks}
        connections={connections}
        provider={provider}
        loadErrors={loadErrors}
        checking={support.checking}
        toast={toast}
        onHealth={support.onHealth}
        onRestart={support.onRestart}
        onLogs={support.onLogs}
        onDiagnostics={support.onDiagnostics}
        updateStatus={support.updateStatus}
        updating={support.updating}
        onUpdateCheck={support.onUpdateCheck}
        onUpdateApply={support.onUpdateApply}
      />
    )
  }
  return <>{chatScreen}</>
}
