import type { ConnectionState } from './transport'

// Gateway contract (tui_gateway/server.py): a session is bound to the CONNECTION it
// was created or resumed on, and the server detaches that binding when the socket
// drops. The transport reconnects on its own and onEvent subscribers survive, but the
// NEW socket carries no session — nothing streams again until `session.resume` re-binds
// it. This pure tracker decides exactly when that re-bind is owed.
//
// Rule: only an 'open' that FOLLOWS a drop needs a resume. The first 'open' of a fresh
// connection does not (the caller created/resumed the session on it), so a normal boot
// never fires a redundant, session-list-mutating RPC.
export type ReconnectResumeTracker = {
  /** Feed every connection-state change. Returns true exactly when the active session
   *  must be re-resumed before its event stream can be trusted again. */
  observe(state: ConnectionState): boolean
  /** True while the socket is known to be down — the chat layer's honest transient. */
  readonly dropped: boolean
}

export function createReconnectResumeTracker(): ReconnectResumeTracker {
  let dropped = false
  return {
    observe(state) {
      if (state === 'closed' || state === 'reconnecting') {
        dropped = true
        return false
      }
      if (dropped) {
        dropped = false
        return true
      }
      return false
    },
    get dropped() {
      return dropped
    }
  }
}
