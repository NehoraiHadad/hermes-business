import { describe, expect, it } from 'vitest'
import { parseJsonInput } from './json-input.mjs'

describe('parseJsonInput', () => {
  it('parses ordinary UTF-8 JSON', () => {
    expect(parseJsonInput('{"ok":true}')).toEqual({ ok: true })
  })

  it('accepts the UTF-8 BOM emitted by Windows PowerShell pipelines', () => {
    expect(parseJsonInput('\uFEFF{"ok":true}')).toEqual({ ok: true })
  })

  it('parses a final pretty-printed report after progress output', () => {
    const output = '== Case 1 ==\r\nPASS\r\n{\r\n  "ok": true\r\n}'
    expect(parseJsonInput(output)).toEqual({ ok: true })
  })
})
