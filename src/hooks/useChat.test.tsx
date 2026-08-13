// @vitest-environment jsdom
import '../test/setup-dom'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChat } from './useChat'

// stop() must never *lie* about a turn being over. Before this fix it fired
// hermesClient.interrupt() and immediately set busy=false regardless of the
// outcome — if the interrupt failed, the UI claimed the assistant had
// stopped while Hermes was still generating server-side. These tests drive
// `stop` in isolation (mocking the hermesClient singleton hermes-client.ts
// exports, exactly the surface useChat.ts touches: onEvent/onConnectionChange
// for its subscriptions, createSession/submit to reach a realistic busy=true
// turn, and interrupt for stop itself) to prove: success only clears busy
// after Hermes acks, failure keeps busy true and shows a plain-Hebrew toast,
// and a second click while the first interrupt is still in flight is a no-op.

const mocks = vi.hoisted(() => ({
  interrupt: vi.fn<(sessionId: string) => Promise<unknown>>(),
  onEvent: vi.fn(() => () => {}),
  onConnectionChange: vi.fn(() => () => {}),
  createSession: vi.fn(async () => ({ session_id: 'sess-1', stored_session_id: 'sess-1' })),
  submit: vi.fn(async () => ({ status: 'ok' }))
}))

vi.mock('../lib/hermes-client', () => ({ hermesClient: mocks }))

function heldInterrupt() {
  let resolve!: (value?: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  mocks.interrupt.mockReset()
  mocks.createSession.mockClear()
  mocks.submit.mockClear()
})

// Puts the hook into a realistic "assistant turn in progress" state without
// reaching into useChat internals: a real sendMessage() call sets busy=true
// and (on success) deliberately leaves it true, exactly like a live stream.
async function renderBusyChat() {
  const setToast = vi.fn()
  const rendered = renderHook(() => useChat({ setScreen: vi.fn(), setToast }))
  await act(async () => {
    await rendered.result.current.sendMessage('שלום')
  })
  expect(rendered.result.current.busy).toBe(true)
  return { ...rendered, setToast }
}

describe('useChat — stop()', () => {
  it('stays busy until the interrupt is acknowledged, then clears it (pessimistic, not optimistic)', async () => {
    const held = heldInterrupt()
    mocks.interrupt.mockReturnValueOnce(held.promise)
    const { result, setToast } = await renderBusyChat()

    let stopCall: Promise<void> | undefined
    act(() => {
      stopCall = result.current.stop()
    })
    // Still in flight: must not have declared the turn over yet.
    expect(result.current.busy).toBe(true)

    await act(async () => {
      held.resolve()
      await stopCall
    })

    expect(result.current.busy).toBe(false)
    expect(setToast).not.toHaveBeenCalled()
  })

  it('on failure keeps busy true and shows a plain-Hebrew error toast — never claims the turn stopped', async () => {
    const held = heldInterrupt()
    mocks.interrupt.mockReturnValueOnce(held.promise)
    const { result, setToast } = await renderBusyChat()

    let stopCall: Promise<void> | undefined
    act(() => {
      stopCall = result.current.stop()
    })

    await act(async () => {
      held.reject(new Error('gateway hiccup'))
      await stopCall
    })

    expect(result.current.busy).toBe(true)
    expect(setToast).toHaveBeenCalledTimes(1)
    const [message, severity] = setToast.mock.calls[0]
    expect(severity).toBe('error')
    expect(message).not.toMatch(/[a-zA-Z]/) // Hebrew only, no leaked English/technical detail
  })

  it('a second click while the first interrupt is still in flight does not fire a second interrupt', async () => {
    const held = heldInterrupt()
    mocks.interrupt.mockReturnValueOnce(held.promise)
    const { result } = await renderBusyChat()

    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    act(() => {
      first = result.current.stop()
      second = result.current.stop()
    })
    expect(mocks.interrupt).toHaveBeenCalledTimes(1)

    await act(async () => {
      held.resolve()
      await Promise.all([first, second])
    })

    expect(result.current.busy).toBe(false)

    // A click AFTER the first fully settles is a fresh, non-deduped attempt.
    const secondHeld = heldInterrupt()
    mocks.interrupt.mockReturnValueOnce(secondHeld.promise)
    act(() => {
      void result.current.stop()
    })
    expect(mocks.interrupt).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondHeld.resolve()
    })
  })
})
