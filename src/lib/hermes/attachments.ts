import { isMethodNotFound } from './core'
import type { HermesSessions } from './session'

// Chat attachment orchestration over Hermes' official JSON-RPC contract.
// Non-image files go through `file.attach` (which returns an `@file:` reference
// the gateway substitutes into the prompt); images go through `image.attach`
// (local path) or `image.attach_bytes` (base64 fallback) and are consumed
// implicitly from session state by the next `prompt.submit`. PDFs prefer
// `pdf.attach` (page-to-image rendering for vision) and fall back to
// `file.attach` only when the gateway is too old to expose that method.

export type AttachmentKind = 'image' | 'file'

export type PendingAttachment = {
  id: string
  name: string
  kind: AttachmentKind
  // A gateway-readable local path (desktop) OR a data: URL fallback (browser).
  path?: string
  dataUrl?: string
  status: 'ready' | 'sending' | 'error'
  error?: string
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

export function attachmentKind(name: string): AttachmentKind {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file'
}

export function isPdf(name: string): boolean {
  return name.split('.').pop()?.toLowerCase() === 'pdf'
}

export function basename(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() || pathOrName
}

// A minimal slice of the session client so the orchestration and its tests do
// not depend on the whole HermesClient surface.
export type AttachmentClient = Pick<
  HermesSessions,
  'attachFile' | 'attachImage' | 'attachImageBytes' | 'attachPdf'
>

// Stage every attachment into the runtime session, then return the exact text to
// pass to `prompt.submit`: the user's text plus any `@file:` refs the gateway
// handed back for non-image files. Throws on the first failure so the caller can
// mark the offending attachment and let the user retry without a half-sent turn.
export async function stageAttachments(
  client: AttachmentClient,
  sessionId: string,
  text: string,
  attachments: PendingAttachment[]
): Promise<string> {
  const fileRefs: string[] = []
  for (const item of attachments) {
    if (item.kind === 'image') {
      if (item.path) await client.attachImage(sessionId, item.path)
      else if (item.dataUrl)
        await client.attachImageBytes(sessionId, { content_base64: item.dataUrl, filename: item.name })
      else throw new Error(`אין נתיב או תוכן לתמונה ${item.name}`)
    } else if (isPdf(item.name)) {
      const ref = await stagePdf(client, sessionId, item)
      if (ref) fileRefs.push(ref)
    } else {
      const ref = await stageFile(client, sessionId, item)
      if (ref) fileRefs.push(ref)
    }
  }
  return [text.trim(), ...fileRefs].filter(Boolean).join('\n')
}

// Attach a non-image, non-PDF file and return its `@file:` ref (if any).
async function stageFile(
  client: AttachmentClient,
  sessionId: string,
  item: PendingAttachment
): Promise<string | undefined> {
  const result = await client.attachFile(sessionId, {
    path: item.path,
    dataUrl: item.dataUrl,
    name: item.name
  })
  return result?.ref_text
}

// Attach a PDF via the dedicated pdf.attach RPC (renders pages to vision
// tiles). Only when the gateway does not implement pdf.attach (older builds:
// JSON-RPC -32601) do we degrade to file.attach so the PDF still reaches the
// agent as a readable artifact. Any other error propagates unchanged.
async function stagePdf(
  client: AttachmentClient,
  sessionId: string,
  item: PendingAttachment
): Promise<string | undefined> {
  try {
    await client.attachPdf(sessionId, {
      path: item.path,
      contentBase64: item.dataUrl,
      filename: item.name
    })
    // pdf.attach queues image tiles consumed implicitly by prompt.submit —
    // no ref text to inline, mirroring image.attach.
    return undefined
  } catch (error) {
    if (!isMethodNotFound(error)) throw error
    return stageFile(client, sessionId, item)
  }
}

let counter = 0
const nextId = () => `att-${Date.now()}-${(counter += 1)}`

// Turn a chosen desktop path into a pending attachment (Hermes reads the path
// directly since the managed runtime is loopback-local).
export function pendingFromPath(filePath: string): PendingAttachment {
  const name = basename(filePath)
  return { id: nextId(), name, kind: attachmentKind(name), path: filePath, status: 'ready' }
}

// Browser/demo fallback: read the File into a data: URL so it can be uploaded as
// bytes (image.attach_bytes / file.attach data_url).
export function readBrowserFile(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`לא ניתן לקרוא את הקובץ ${file.name}`))
    reader.onload = () =>
      resolve({
        id: nextId(),
        name: file.name,
        kind: attachmentKind(file.name),
        dataUrl: String(reader.result || ''),
        status: 'ready'
      })
    reader.readAsDataURL(file)
  })
}
