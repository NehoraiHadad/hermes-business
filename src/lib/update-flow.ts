import type { HermesUpdateStatus } from './hermes-client'

export type UpdateClient = {
  startUpdate(): Promise<{ ok?: boolean; message?: string }>
  updateActionStatus(): Promise<{ running?: boolean; exit_code?: number | null }>
  healthCheck(): Promise<{ health: { ok?: boolean } }>
  checkUpdate(force?: boolean): Promise<HermesUpdateStatus>
}

const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

// Drive Hermes' official `hermes update` action to completion: kick it off, poll
// the action status until it exits, wait for the local server to become healthy
// again (it can briefly restart), then re-check the update state. Throws with a
// user-facing Hebrew message on any failure. `sleep` is injectable for tests.
export async function runHermesUpdate(
  client: UpdateClient,
  { sleep = wait }: { sleep?: (ms: number) => Promise<void> } = {}
): Promise<HermesUpdateStatus> {
  const started = await client.startUpdate()
  if (!started.ok) throw new Error(started.message || 'Hermes לא התחיל את העדכון')

  let completed = false
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await sleep(1000)
    const action = await client.updateActionStatus().catch(() => null)
    if (!action || action.running) continue
    if (action.exit_code !== 0) throw new Error('עדכון Hermes נכשל')
    completed = true
    break
  }
  if (!completed) throw new Error('עדכון Hermes עדיין לא הסתיים')

  let healthy = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const { health } = await client.healthCheck()
      if (health.ok) {
        healthy = true
        break
      }
    } catch {
      // The local server can briefly restart while Hermes updates.
    }
    await sleep(1000)
  }
  if (!healthy) throw new Error('Hermes עודכן, אך בדיקת התקינות טרם הצליחה')

  return client.checkUpdate(true)
}
