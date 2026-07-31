import { type ApiFn } from './core'
import { createProviderApi, type HermesProviderApi } from './providers'
import { createCronApi, type HermesCronApi, type TaskEdit } from './rest-cron'
import { createMessagingApi, type HermesMessagingApi } from './rest-messaging'
import { createSkillsApi, type HermesSkillsApi } from './rest-skills'
import {
  createSystemApi,
  type HermesSystemApi,
  type HermesUpdateStatus,
  type StartUpdateResult
} from './rest-system'
import { createWhatsappApi, type HermesWhatsappApi } from './whatsapp-rest'

export type { WhatsappCloudCredentials, WhatsappOnboarding } from './whatsapp-rest'
export type { ApiFn, TaskEdit, HermesUpdateStatus }

// The full REST-backed integration surface, composed from cohesive per-concern
// modules: providers, WhatsApp, cron/scheduled tasks, skills, messaging
// connectors, and health/self-update.
export interface HermesRest
  extends HermesProviderApi,
    HermesWhatsappApi,
    HermesCronApi,
    HermesSkillsApi,
    HermesMessagingApi,
    HermesSystemApi {}

// Coherent facade over the REST modules. Everything is routed through a single
// injected `api` function so the demo and desktop transports are
// interchangeable; back-compat is preserved via the flat `HermesRest` surface.
export function createHermesRest(
  api: ApiFn,
  ensureGateway: () => Promise<unknown> = async () => {},
  applyDesktopUpdate?: () => Promise<StartUpdateResult>
): HermesRest {
  return {
    ...createProviderApi(api),
    ...createWhatsappApi(api, ensureGateway),
    ...createCronApi(api),
    ...createSkillsApi(api),
    ...createMessagingApi(api, ensureGateway),
    ...createSystemApi(api, applyDesktopUpdate)
  }
}
