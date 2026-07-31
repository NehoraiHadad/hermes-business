import { describe, expect, it, vi } from 'vitest'
import { HermesRpcError, RPC_METHOD_NOT_FOUND } from './core'
import {
  attachmentKind,
  basename,
  isPdf,
  pendingFromPath,
  stageAttachments,
  type AttachmentClient,
  type PendingAttachment
} from './attachments'

function fakeClient(overrides: Partial<AttachmentClient> = {}): AttachmentClient {
  return {
    attachFile: vi.fn(async (_sid, file) => ({ attached: true, name: file.name, ref_text: `@file:${file.name}` })),
    attachImage: vi.fn(async () => ({ attached: true, count: 1 })),
    attachImageBytes: vi.fn(async () => ({ attached: true, count: 1 })),
    attachPdf: vi.fn(async (_sid, pdf) => ({ attached: true, filename: pdf.filename, pages_attached: 2, count: 2 })),
    ...overrides
  }
}

const att = (over: Partial<PendingAttachment>): PendingAttachment => ({
  id: 'a1',
  name: 'x',
  kind: 'file',
  status: 'ready',
  ...over
})

describe('attachmentKind / basename', () => {
  it('classifies images by extension and files otherwise', () => {
    expect(attachmentKind('photo.PNG')).toBe('image')
    expect(attachmentKind('scan.jpeg')).toBe('image')
    expect(attachmentKind('report.pdf')).toBe('file')
    expect(attachmentKind('notes')).toBe('file')
  })
  it('detects PDFs case-insensitively', () => {
    expect(isPdf('report.PDF')).toBe(true)
    expect(isPdf('report.pdf')).toBe(true)
    expect(isPdf('report.txt')).toBe(false)
  })
  it('extracts a basename from windows and posix paths', () => {
    expect(basename('C:/tmp/report.pdf')).toBe('report.pdf')
    expect(basename('C:\\Users\\a\\photo.png')).toBe('photo.png')
  })
  it('derives kind from a picked path', () => {
    expect(pendingFromPath('C:/tmp/logo.webp').kind).toBe('image')
    expect(pendingFromPath('C:/tmp/data.csv').kind).toBe('file')
  })
})

describe('stageAttachments', () => {
  it('attaches an image by path and leaves the prompt text untouched', async () => {
    const client = fakeClient()
    const text = await stageAttachments(client, 'sid-1', 'look at this', [
      att({ kind: 'image', path: 'C:/p/pic.png', name: 'pic.png' })
    ])
    expect(client.attachImage).toHaveBeenCalledWith('sid-1', 'C:/p/pic.png')
    expect(client.attachImageBytes).not.toHaveBeenCalled()
    expect(text).toBe('look at this')
  })

  it('falls back to image bytes when only a data URL is available', async () => {
    const client = fakeClient()
    await stageAttachments(client, 'sid-1', '', [
      att({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA', name: 'pic.png' })
    ])
    expect(client.attachImageBytes).toHaveBeenCalledWith('sid-1', {
      content_base64: 'data:image/png;base64,AAAA',
      filename: 'pic.png'
    })
  })

  it('appends the returned @file: ref for non-image, non-PDF files', async () => {
    const client = fakeClient()
    const text = await stageAttachments(client, 'sid-1', 'summarize', [
      att({ kind: 'file', path: 'C:/p/report.csv', name: 'report.csv' })
    ])
    expect(client.attachFile).toHaveBeenCalledWith('sid-1', {
      path: 'C:/p/report.csv',
      dataUrl: undefined,
      name: 'report.csv'
    })
    expect(client.attachPdf).not.toHaveBeenCalled()
    expect(text).toBe('summarize\n@file:report.csv')
  })

  it('routes PDFs through pdf.attach and adds no @file: ref (vision tiles)', async () => {
    const client = fakeClient()
    const text = await stageAttachments(client, 'sid-1', 'read this', [
      att({ kind: 'file', path: 'C:/p/report.pdf', name: 'report.pdf' })
    ])
    expect(client.attachPdf).toHaveBeenCalledWith('sid-1', {
      path: 'C:/p/report.pdf',
      contentBase64: undefined,
      filename: 'report.pdf'
    })
    expect(client.attachFile).not.toHaveBeenCalled()
    expect(text).toBe('read this')
  })

  it('falls back to file.attach only when pdf.attach is an unknown method', async () => {
    const client = fakeClient({
      attachPdf: vi.fn(async () => Promise.reject(new HermesRpcError('unknown method: pdf.attach', RPC_METHOD_NOT_FOUND)))
    })
    const text = await stageAttachments(client, 'sid-1', 'read this', [
      att({ kind: 'file', path: 'C:/p/report.pdf', name: 'report.pdf' })
    ])
    expect(client.attachPdf).toHaveBeenCalled()
    expect(client.attachFile).toHaveBeenCalledWith('sid-1', {
      path: 'C:/p/report.pdf',
      dataUrl: undefined,
      name: 'report.pdf'
    })
    expect(text).toBe('read this\n@file:report.pdf')
  })

  it('propagates a non-method-not-found pdf.attach error (no silent fallback)', async () => {
    const client = fakeClient({
      attachPdf: vi.fn(async () => Promise.reject(new HermesRpcError('pdftoppm not installed', 5028)))
    })
    await expect(
      stageAttachments(client, 'sid-1', 'hi', [att({ kind: 'file', path: 'C:/p/x.pdf', name: 'x.pdf' })])
    ).rejects.toThrow('pdftoppm not installed')
    expect(client.attachFile).not.toHaveBeenCalled()
  })

  it('supports an attachment-only turn (empty text)', async () => {
    const client = fakeClient()
    const text = await stageAttachments(client, 'sid-1', '', [
      att({ kind: 'file', path: 'C:/p/a.txt', name: 'a.txt' })
    ])
    expect(text).toBe('@file:a.txt')
  })

  it('throws when an image has neither path nor bytes', async () => {
    await expect(
      stageAttachments(fakeClient(), 'sid-1', 'hi', [att({ kind: 'image', name: 'pic.png' })])
    ).rejects.toThrow('pic.png')
  })

  it('propagates an attach RPC failure so the caller can retry', async () => {
    const client = fakeClient({ attachFile: vi.fn(async () => Promise.reject(new Error('boom'))) })
    await expect(
      stageAttachments(client, 'sid-1', 'hi', [att({ kind: 'file', path: 'C:/p/a.txt', name: 'a.txt' })])
    ).rejects.toThrow('boom')
  })
})
