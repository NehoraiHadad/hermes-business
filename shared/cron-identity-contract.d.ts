export interface CronJobIdCase {
  label: string
  job: Record<string, unknown> | null
  id: string | null
}

export const CRON_JOB_ID_CASES: CronJobIdCase[]
