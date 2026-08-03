export interface ScheduleDisplayCase {
  label: string
  schedule: string
  text: string
}

export const DAY_LABELS: string[]
export const ISRAELI_WORK_WEEK: number[]
export const SIMPLE_ONCE_PATTERN: RegExp
export const SCHEDULE_PRESET_VALUES: string[]
export const SCHEDULE_DISPLAY_CASES: ScheduleDisplayCase[]

export function pad(value: string | number): string
export function compressDays(days: number[]): string
export function expandDays(field: string): number[]
export function describeDays(days: number[]): string
export function humanizeSchedule(schedule: string): string
