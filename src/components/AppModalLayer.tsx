import type { Dispatch, SetStateAction } from 'react'
import { hermesClient } from '../lib/hermes-client'
import type { Connection, ScheduledTask, Skill } from '../types'
import { AppModals } from './AppModals'
import { ProviderModal } from './dialogs/ProviderModal'

export type ModalKind = 'task' | 'skill' | 'provider' | null

export function AppModalLayer({
  modal,
  connection,
  closeModal,
  closeConnection,
  setTasks,
  setSkills,
  setConnections,
  setToast
}: {
  modal: ModalKind
  connection: Connection | null
  closeModal: () => void
  closeConnection: () => void
  setTasks: Dispatch<SetStateAction<ScheduledTask[]>>
  setSkills: Dispatch<SetStateAction<Skill[]>>
  setConnections: Dispatch<SetStateAction<Connection[]>>
  setToast: (message: string) => void
}) {
  const providerConnected = () => {
    setToast('ספק ה־AI חובר בהצלחה')
    closeModal()
  }

  return (
    <>
      <AppModals
        modal={modal}
        connectionModal={connection}
        onCloseModal={closeModal}
        onCloseConnection={closeConnection}
        setTasks={setTasks}
        setSkills={setSkills}
        setConnections={setConnections}
        setToast={setToast}
      />
      {modal === 'provider' ? (
        <ProviderModal
          onClose={closeModal}
          onOAuthConnected={providerConnected}
          onConnect={async (provider, key) => {
            await hermesClient.connectProvider(provider, key)
            providerConnected()
          }}
        />
      ) : null}
    </>
  )
}
