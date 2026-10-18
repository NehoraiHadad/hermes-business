import { describe, expect, it, vi } from 'vitest'
import { officialGatewayStateAsync } from './gateway-status.cjs'

describe('asynchronous native gateway snapshot', () => {
  it('keeps the main event loop available while the CLI starts', async () => {
    let finish: (value: object) => void = () => {}
    const runner = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const pending = officialGatewayStateAsync({ command: 'hermes.exe', home: '/test', runner })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(runner).toHaveBeenCalledWith('hermes.exe', ['gateway', 'status'], 45000,
      { HERMES_HOME: '/test' }, { allowNonZero: true })
    finish({ stdout: 'Gateway process running (PID: 123)', stderr: '' })
    expect(await pending).toMatchObject({ state: 'running' })
  })

  it('requires an affirmative stopped result and fails closed on errors', async () => {
    expect(await officialGatewayStateAsync({ command: 'hermes.exe', runner: async () => ({ stdout: 'No gateway process detected' }) })).toMatchObject({ state: 'stopped' })
    expect(await officialGatewayStateAsync({ command: 'hermes.exe', runner: async () => { throw new Error('timeout') } })).toMatchObject({ state: 'unknown' })
  })
})
