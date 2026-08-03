// @vitest-environment jsdom
import './setup-dom'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { hermesClient } from '../lib/hermes-client'
import { FAIL_CLOSED_RUNTIME, bridge, runningRuntime, stubBridge } from './hermes-bridge'

// Proves the DOM test infra itself (docs/specs/component-tests.md §7.1) —
// this file follows the same jsdom + setup-dom convention every other
// src/**/*.test.tsx must follow, so a break here means every DOM test breaks.
describe('DOM test infrastructure', () => {
  it('mirrors index.html: <html lang="he" dir="rtl">', () => {
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('he')
  })

  it('has jest-dom matchers active', () => {
    render(<div data-testid="jest-dom-probe">ok</div>)
    const el = document.querySelector('[data-testid="jest-dom-probe"]')
    expect(el).toBeInTheDocument()
  })

  it('installs the hermesDesktop bridge with fail-closed defaults', async () => {
    expect(window.hermesDesktop).toBeDefined()
    await expect(window.hermesDesktop!.getRuntime()).resolves.toEqual(FAIL_CLOSED_RUNTIME)
    await expect(window.hermesDesktop!.applyUpdate()).rejects.toThrow(
      'hermes test bridge: applyUpdate not stubbed'
    )
  })

  describe('stubBridge is scoped to a single test', () => {
    it('applies an override for this test only', async () => {
      stubBridge({ getRuntime: async () => runningRuntime() })
      await expect(bridge().getRuntime()).resolves.toMatchObject({ running: true, installed: true })
    })

    it('is back to the fail-closed default in the next test (proves resetBridge)', async () => {
      await expect(bridge().getRuntime()).resolves.toEqual(FAIL_CLOSED_RUNTIME)
    })
  })

  describe('afterEach cleanup', () => {
    it('renders a marked node', () => {
      render(<div data-testid="cleanup-marker">marker</div>)
      expect(document.body).not.toBeEmptyDOMElement()
    })

    it('starts with an empty body (proves cleanup ran after the previous test)', () => {
      expect(document.body).toBeEmptyDOMElement()
    })
  })

  it('closes the demo trap: hermesClient is neither demo nor missing its bridge', () => {
    expect(hermesClient.demo).toBe(false)
    expect(hermesClient.bridgeMissing).toBe(false)
  })
})
