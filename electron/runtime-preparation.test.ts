import { describe, expect, it } from 'vitest'
import { isRuntimePreparing, setRuntimePreparation, waitForRuntimePreparation } from './runtime-state.cjs'

describe('native runtime preparation', () => {
  it('keeps runtime starts waiting until the asynchronous installation finishes', async () => {
    let complete!: () => void
    const pending = setRuntimePreparation(new Promise<void>(resolve => { complete = resolve }))
    let started = false
    const startup = waitForRuntimePreparation().then(() => { started = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(isRuntimePreparing()).toBe(true)
    expect(started).toBe(false)
    complete()
    await pending
    await startup
    expect(started).toBe(true)
    expect(isRuntimePreparing()).toBe(false)
  })

  it('clears the pending state and preserves an installation failure', async () => {
    const pending = setRuntimePreparation(Promise.reject(new Error('native install failed')))
    await expect(pending).rejects.toThrow('native install failed')
    expect(isRuntimePreparing()).toBe(false)
    await expect(waitForRuntimePreparation()).resolves.toBeUndefined()
  })
})
