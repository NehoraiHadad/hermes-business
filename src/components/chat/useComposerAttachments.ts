import { useRef, useState } from 'react'
import { pendingFromPath, readBrowserFile, type PendingAttachment } from '../../lib/hermes/attachments'

// Composer attachment state + picking. Desktop uses the native dialog (Hermes
// reads the returned path directly, since the runtime is loopback-local);
// browsers/demo fall back to a hidden <input type=file> read as data URLs.
export function useComposerAttachments(busy: boolean) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const pickAttachment = async () => {
    if (busy) return
    if (window.hermesDesktop?.chooseFile) {
      const chosen = await window.hermesDesktop.chooseFile([])
      if (chosen) setAttachments(current => [...current, pendingFromPath(chosen)])
      return
    }
    fileInput.current?.click()
  }

  const onBrowserFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    const staged = await Promise.all(files.map(readBrowserFile))
    setAttachments(current => [...current, ...staged])
  }

  const removeAttachment = (id: string) =>
    setAttachments(current => current.filter(item => item.id !== id))

  return { attachments, setAttachments, fileInput, pickAttachment, onBrowserFiles, removeAttachment }
}
