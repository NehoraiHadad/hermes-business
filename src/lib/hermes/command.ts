import type { RpcFn } from './core'

export type CommandDispatch = {
  type?: string
  name?: string
  message?: string
  display?: string
}

export interface HermesCommands {
  dispatchCommand(sessionId: string, name: string, arg: string): Promise<CommandDispatch>
}

// Official gateway command resolver. Skill invocations must pass through this
// RPC before their expanded model-facing message is submitted.
export function createHermesCommands(rpc: RpcFn): HermesCommands {
  return {
    dispatchCommand(sessionId, name, arg) {
      return rpc<CommandDispatch>('command.dispatch', {
        session_id: sessionId,
        name,
        arg
      })
    }
  }
}
