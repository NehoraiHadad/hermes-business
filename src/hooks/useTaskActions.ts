import { useCallback, useMemo } from 'react'
import { hermesClient } from '../lib/hermes-client'
import type { ScheduledTask, TaskActions, TaskEditValues } from '../types'

type SetTasks = (updater: (current: ScheduledTask[]) => ScheduledTask[]) => void

// Scheduled-task CRUD wiring: toggle/trigger/edit/delete against Hermes with
// optimistic local updates and toast feedback. Kept out of App so the shell
// composition stays focused on routing/layout.
export function useTaskActions({
  setTasks,
  setToast
}: {
  setTasks: SetTasks
  setToast: (toast: string) => void
}): TaskActions {
  const notify = useCallback(
    (message: string) => {
      setToast(message)
      window.setTimeout(() => setToast(''), 2500)
    },
    [setToast]
  )

  return useMemo<TaskActions>(
    () => ({
      onToggle: async task => {
        await hermesClient.toggleTask(task)
        setTasks(current =>
          current.map(item => (item.id === task.id ? { ...item, enabled: !item.enabled } : item))
        )
      },
      onTrigger: async task => {
        try {
          await hermesClient.triggerTask(task.id)
          notify(`המשימה "${task.name}" רצה עכשיו`)
        } catch (error) {
          notify(error instanceof Error ? error.message : 'הרצת המשימה נכשלה')
        }
      },
      onEdit: async (task, updates: TaskEditValues) => {
        // Diff against the original so the atomic PUT carries only real changes.
        const changed: Partial<TaskEditValues> = {}
        if (updates.name !== task.name) changed.name = updates.name
        if (updates.prompt !== task.prompt) changed.prompt = updates.prompt
        if (updates.schedule !== task.schedule) changed.schedule = updates.schedule
        if (Object.keys(changed).length === 0) return
        try {
          await hermesClient.editTask(task.id, changed)
          setTasks(current => current.map(item => (item.id === task.id ? { ...item, ...changed } : item)))
          notify(`המשימה "${updates.name}" עודכנה`)
        } catch (error) {
          notify(error instanceof Error ? error.message : 'עדכון המשימה נכשל')
        }
      },
      onDelete: async task => {
        try {
          await hermesClient.deleteTask(task.id)
          setTasks(current => current.filter(item => item.id !== task.id))
          notify(`המשימה "${task.name}" נמחקה`)
        } catch (error) {
          notify(error instanceof Error ? error.message : 'מחיקת המשימה נכשלה')
        }
      }
    }),
    [setTasks, notify]
  )
}
