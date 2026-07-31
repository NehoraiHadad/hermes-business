import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { isAllowedExternalUrl, isTrustedRendererUrl } = require('../../electron/url-policy.cjs') as {
  isAllowedExternalUrl: (url: string) => boolean
  isTrustedRendererUrl: (url: string, packaged: boolean) => boolean
}

describe('Electron URL policy', () => {
  it('allows only HTTPS external destinations', () => {
    expect(isAllowedExternalUrl('https://chatgpt.com/device')).toBe(true)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('file:///C:/secret.txt')).toBe(false)
    expect(isAllowedExternalUrl('http://example.com')).toBe(false)
  })

  it('locks renderer navigation to its packaged file or exact dev origin', () => {
    expect(isTrustedRendererUrl('file:///C:/app/dist/index.html', true)).toBe(true)
    expect(isTrustedRendererUrl('https://example.com', true)).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/chat', false)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/chat', false)).toBe(false)
  })
})
