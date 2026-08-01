import { describe, expect, it } from 'vitest'
import type { RpcFn } from './core'
import { createHermesCommands } from './command'

describe('Hermes command RPC', () => {
  it('uses the official command.dispatch contract', async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = []
    const rpc: RpcFn = async <T>(method: string, params?: Record<string, unknown>) => {
      calls.push([method, params])
      return { type: 'skill', name: 'business-bootstrap', message: 'expanded' } as T
    }
    const commands = createHermesCommands(rpc)

    await expect(commands.dispatchCommand('runtime-1', 'business-bootstrap', 'setup facts')).resolves.toMatchObject({
      type: 'skill',
      message: 'expanded'
    })
    expect(calls).toEqual([['command.dispatch', {
      session_id: 'runtime-1',
      name: 'business-bootstrap',
      arg: 'setup facts'
    }]])
  })
})
