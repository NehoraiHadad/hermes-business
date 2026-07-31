import type { Dispatch, SetStateAction } from 'react'
import { hermesClient } from '../lib/hermes-client'
import type { Connection, ScheduledTask, Skill } from '../types'
import { ConnectionModal } from './dialogs/ConnectionModal'
import { SkillModal } from './dialogs/SkillModal'
import { TaskModal } from './dialogs/TaskModal'

// The full-window dialog cluster and its Hermes side effects. Keeping the modal
// wiring here lets App stay a thin orchestration shell; the provider modal lives
// in App because it is shared with the onboarding surface.
export function AppModals({
  modal,
  connectionModal,
  onCloseModal,
  onCloseConnection,
  setTasks,
  setSkills,
  setConnections,
  setToast
}: {
  modal: 'task' | 'skill' | 'provider' | null
  connectionModal: Connection | null
  onCloseModal: () => void
  onCloseConnection: () => void
  setTasks: Dispatch<SetStateAction<ScheduledTask[]>>
  setSkills: Dispatch<SetStateAction<Skill[]>>
  setConnections: Dispatch<SetStateAction<Connection[]>>
  setToast: (toast: string) => void
}) {
  return (
    <>
      {modal === 'task' ? (
        <TaskModal
          onClose={onCloseModal}
          onCreate={async task => {
            await hermesClient.createTask(task)
            setTasks(await hermesClient.listTasks())
            setToast('המשימה נוצרה ותופיע גם ב־Hermes המלא')
          }}
        />
      ) : null}
      {modal === 'skill' ? (
        <SkillModal
          onClose={onCloseModal}
          onCreate={async (name, description) => {
            await hermesClient.createSkill(name, description)
            setSkills(await hermesClient.listSkills())
            setToast('ה־Skill נשמר וזמין גם ב־Hermes המלא')
          }}
        />
      ) : null}
      {connectionModal ? (
        <ConnectionModal
          connection={connectionModal}
          onClose={onCloseConnection}
          onConnected={id => {
            setConnections(current =>
              current.map(connection => (connection.id === id ? { ...connection, state: 'connected' } : connection))
            )
            setToast('החיבור נשמר ב־Hermes')
          }}
        />
      ) : null}
    </>
  )
}
