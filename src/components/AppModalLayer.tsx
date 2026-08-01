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
  setToast,
  onRefresh
}: {
  modal: ModalKind
  connection: Connection | null
  closeModal: () => void
  closeConnection: () => void
  setTasks: Dispatch<SetStateAction<ScheduledTask[]>>
  setSkills: Dispatch<SetStateAction<Skill[]>>
  setConnections: Dispatch<SetStateAction<Connection[]>>
  setToast: (message: string) => void
  onRefresh?: () => Promise<unknown>
}) {
  const providerConnected = async () => {
    // Refresh authoritative state AFTER auth so provider readiness / connections reflect
    // the new credential — the onboarding completion gate reads the fresh value, not stale.
    if (onRefresh) await onRefresh().catch(() => {})
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
          onOAuthConnected={() => void providerConnected()}
          onConnect={async (provider, key) => {
            // connectProvider throws unless the credential was PROVEN live (never on a
            // reachable:false / unprobed provider). It returns non-secret evidence scoped
            // to the exact provider+model — persist it so the onboarding gate and restart
            // resume can require FRESH evidence, then refresh authoritative app state.
            const { validation } = await hermesClient.connectProvider(provider, key)
            if (window.hermesDesktop?.recordProviderEvidence) {
              await window.hermesDesktop.recordProviderEvidence(validation).catch(() => {})
            }
            await providerConnected()
          }}
        />
      ) : null}
    </>
  )
}
