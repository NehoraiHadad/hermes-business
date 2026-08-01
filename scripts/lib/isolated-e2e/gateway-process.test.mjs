import { describe, expect, it, vi } from 'vitest'
import { readOwnedGatewayPid, reapOwnedGateway } from './gateway-process.mjs'

const home = 'C:\\Temp\\hermes-qa-home-safe'
const record = value => () => JSON.stringify(value)

describe('isolated gateway PID ownership', () => {
  it('accepts only a positive PID owned by the exact temporary Hermes home', () => {
    expect(readOwnedGatewayPid(home, record({ pid: 1234, hermes_home: home.toLowerCase() }))).toBe(1234)
    expect(readOwnedGatewayPid(home, record({ pid: 1234, hermes_home: 'C:\\Users\\live\\hermes' }))).toBeNull()
    expect(readOwnedGatewayPid(home, record({ pid: -1, hermes_home: home }))).toBeNull()
  })

  it('never reaps an unowned or malformed PID record', () => {
    const reap = vi.fn(() => true)
    expect(reapOwnedGateway(home, { read: record({ pid: 9, hermes_home: 'C:\\other' }), reap })).toEqual({ pid: null, reaped: false })
    expect(reap).not.toHaveBeenCalled()
  })

  it('reaps the owned gateway tree', () => {
    const reap = vi.fn(() => true)
    expect(reapOwnedGateway(home, { read: record({ pid: 4321, hermes_home: home }), reap })).toEqual({ pid: 4321, reaped: true })
    expect(reap).toHaveBeenCalledWith({ pid: 4321 })
  })
})
