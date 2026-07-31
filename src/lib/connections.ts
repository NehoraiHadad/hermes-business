import type { Connection } from '../types'

export type HermesMessagingPlatform = {
  id: string
  enabled?: boolean
  configured?: boolean
  gateway_running?: boolean
  state?: string | null
  error_message?: string | null
}

const PLATFORM_IDS: Record<string, string> = {
  telegram: 'telegram',
  'whatsapp-cloud': 'whatsapp_cloud',
  whatsapp: 'whatsapp'
}

export function connectionStateFromPlatform(
  platform: HermesMessagingPlatform | undefined
): Connection['state'] {
  if (!platform) return 'available'
  if (platform.enabled && platform.configured && platform.state === 'connected') return 'connected'
  if (platform.enabled || platform.configured || platform.error_message) return 'attention'
  return 'available'
}

export function hydrateConnectionStates(
  connections: Connection[],
  platforms: HermesMessagingPlatform[],
  googleAuthenticated: boolean
): Connection[] {
  return connections.map(connection => {
    if (connection.id === 'google') {
      return { ...connection, state: googleAuthenticated ? 'connected' : 'available' }
    }
    const platformId = PLATFORM_IDS[connection.id]
    if (!platformId) return connection
    return {
      ...connection,
      state: connectionStateFromPlatform(platforms.find(platform => platform.id === platformId))
    }
  })
}
