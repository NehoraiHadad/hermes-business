// Translate the friendly task-modal choices (weekdays vs daily + a time) into a
// Hermes cron expression. Kept pure so the mapping can be unit tested.
export function buildCron(days: string, time: string): string {
  const [hour, minute] = time.split(':')
  return days === 'weekdays' ? `${minute} ${hour} * * 0-4` : `${minute} ${hour} * * *`
}
