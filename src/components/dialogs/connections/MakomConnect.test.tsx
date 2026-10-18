/** @vitest-environment jsdom */
import '../../../test/setup-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MakomForm } from '../../../../shared/makom-form.js'
describe('Makom connection flow', () => {
  it('requires a verified community and explicit profiles, then disconnects the selected connection', async () => {
    const binding = { origin: 'https://site.example', communitySlug: 'village', name: 'קהילת הבדיקה', revision: 'r1' }
    let connected = false
    const api = vi.fn(async (path: string) => {
      if (path === '/makom') return { profiles: [{ id: 'default', label: 'העוזר הראשי', binding: connected ? binding : null, connected }] }
      if (path === '/makom/resolve') return binding
      if (path === '/makom/connect') { connected = true; return { verified: true } }
      if (path === '/makom/disconnect') { connected = false; return {} }
      throw Error('unexpected path')
    })
    const changed = vi.fn()
    render(<MakomForm api={api} onChanged={changed} />)
    await screen.findByLabelText('העוזר הראשי')
    expect(screen.getByRole('button', { name: 'חיבור מקום' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('קישור לקהילה במקום'), { target: { value: 'https://site.example/public/village' } })
    fireEvent.click(screen.getByRole('button', { name: 'בדיקת הקהילה' }))
    await screen.findByText('קהילת הבדיקה')
    fireEvent.click(screen.getByRole('button', { name: 'חיבור מקום' }))
    await waitFor(() => expect(changed).toHaveBeenCalledWith(true))
    expect(api).toHaveBeenCalledWith('/makom/connect', { method: 'POST', body: { link: 'https://site.example/public/village', profiles: ['default'] } })
    fireEvent.click(screen.getByRole('button', { name: 'ניתוק מהמרחבים שנבחרו' }))
    await waitFor(() => expect(changed).toHaveBeenCalledWith(false))
    expect(api).toHaveBeenCalledWith('/makom/disconnect', { method: 'POST', body: { profiles: ['default'] } })
  })
  it('does not show a successful connection after a failure', async () => {
    render(<MakomForm api={async () => { throw Error('לא ניתן להתחבר') }} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'חיבור מקום' })).toBeDisabled()
  })
})
