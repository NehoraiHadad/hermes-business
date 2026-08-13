// @vitest-environment jsdom
import '../../test/setup-dom'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FriendlySchedule } from '../../lib/schedule'
import { ScheduleFields } from './ScheduleFields'

// ScheduleFields is a controlled editor, so every case drives it through a stateful
// harness — asserting on the model the component actually pushes out (what a dialog
// would compile and save) and never on internal state. The two invariants under test:
// the time field is a locale-independent 24h TEXT box whose accessible name stays
// exactly 'שעה' (scripts/lib/probes/installed/tasks.mjs fills it by that label), and
// the model/summary never hold a time the owner did not enter.

function renderFields(initial: FriendlySchedule) {
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = useState<FriendlySchedule>(initial)
    return (
      <ScheduleFields
        value={value}
        onChange={next => {
          onChange(next)
          setValue(next)
        }}
      />
    )
  }
  render(<Harness />)
  const timeField = () => screen.getByLabelText('שעה')
  const lastModel = () => onChange.mock.calls.at(-1)?.[0] as FriendlySchedule | undefined
  return { onChange, timeField, lastModel }
}

describe('ScheduleFields — the 24h time field', () => {
  it('is a plain textbox (never the locale-formatted native time widget) holding a canonical HH:MM', () => {
    const { timeField } = renderFields({ mode: 'daily', time: '08:00' })
    const input = timeField()
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveValue('08:00')
    expect(screen.getByText('כל יום בשעה 08:00')).toBeInTheDocument()
  })

  it('accepts a single programmatic value+input (the probe\'s fill path, no blur) and yields a valid model', () => {
    const { timeField, lastModel } = renderFields({ mode: 'daily', time: '08:00' })
    fireEvent.change(timeField(), { target: { value: '23:59' } })
    expect(lastModel()).toEqual({ mode: 'daily', time: '23:59' })
    expect(timeField()).toHaveValue('23:59')
    expect(screen.getByText('כל יום בשעה 23:59')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is forgiving while typing and normalises the shorthand to HH:MM on blur', async () => {
    const user = userEvent.setup()
    const { timeField, lastModel } = renderFields({ mode: 'daily', time: '08:00' })
    await user.clear(timeField())
    await user.type(timeField(), '830')
    expect(lastModel()).toEqual({ mode: 'daily', time: '08:30' })
    // The raw shorthand survives until blur, then the field shows the canonical value.
    expect(timeField()).toHaveValue('830')
    await user.tab()
    expect(timeField()).toHaveValue('08:30')
  })

  it('rejects an impossible time: Hebrew alert, no time in the model, no time in the summary', async () => {
    const user = userEvent.setup()
    const { timeField, lastModel } = renderFields({ mode: 'daily', time: '08:00' })
    await user.clear(timeField())
    await user.type(timeField(), '25:00')

    expect(screen.getByRole('alert')).toHaveTextContent('שעה לא תקינה. אפשר למשל 08:30')
    expect(lastModel()).toEqual({ mode: 'daily', time: '' })
    // Honest summary: it describes the model, which holds no time at all.
    expect(screen.queryByText(/25:00/)).not.toBeInTheDocument()
    expect(screen.queryByText(/08:00/)).not.toBeInTheDocument()
    expect(screen.getByText('הזן שעה כדי לראות מתי המשימה תרוץ')).toBeInTheDocument()
    // The invalid text stays visible for correction, described by its own error.
    const input = timeField()
    expect(input).toHaveValue('25:00')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id)
  })

  it('recovers to a valid model once the entry becomes readable again', async () => {
    const user = userEvent.setup()
    const { timeField, lastModel } = renderFields({ mode: 'daily', time: '08:00' })
    await user.clear(timeField())
    await user.type(timeField(), '9:99')
    expect(lastModel()).toEqual({ mode: 'daily', time: '' })
    await user.clear(timeField())
    await user.type(timeField(), '09:15')
    expect(lastModel()).toEqual({ mode: 'daily', time: '09:15' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('כל יום בשעה 09:15')).toBeInTheDocument()
  })

  it('adopts a time changed from outside the field — a mode switch keeps the chosen time', async () => {
    const user = userEvent.setup()
    const { timeField, lastModel } = renderFields({ mode: 'daily', time: '10:15' })
    await user.selectOptions(screen.getByLabelText('מתי לרוץ?'), 'weekly')
    expect(lastModel()).toEqual({ mode: 'weekly', days: [0, 1, 2, 3, 4], time: '10:15' })
    expect(timeField()).toHaveValue('10:15')
  })
})

describe('ScheduleFields — weekday chips', () => {
  it('exposes each day as a pressable chip and toggles aria-pressed', async () => {
    const user = userEvent.setup()
    const { lastModel } = renderFields({ mode: 'weekly', days: [0, 1, 2, 3, 4], time: '08:00' })
    const group = screen.getByRole('group', { name: 'ימים' })
    const chips = screen.getAllByRole('button')
    expect(chips).toHaveLength(7)
    expect(group).toContainElement(chips[0])

    const sunday = chips[0]
    expect(sunday).toHaveAttribute('aria-pressed', 'true')
    await user.click(sunday)
    expect(lastModel()).toEqual({ mode: 'weekly', days: [1, 2, 3, 4], time: '08:00' })
    expect(screen.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'false')

    const friday = screen.getAllByRole('button')[5]
    expect(friday).toHaveAttribute('aria-pressed', 'false')
    await user.click(friday)
    expect(lastModel()).toEqual({ mode: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00' })
  })

  it('keeps the chip focusable by keyboard so the scoped focus ring can show', async () => {
    const user = userEvent.setup()
    renderFields({ mode: 'weekly', days: [0], time: '08:00' })
    const chips = screen.getAllByRole('button')
    await user.tab() // mode select
    await user.tab() // first chip
    expect(chips[0]).toHaveFocus()
    expect(chips[0].className).toContain('day-chip')
  })
})
