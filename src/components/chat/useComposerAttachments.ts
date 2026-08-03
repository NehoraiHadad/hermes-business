import { useRef, useState } from 'react'
import { hermesClient } from '../../lib/hermes-client'
import { pendingFromPath, readBrowserFile, type PendingAttachment } from '../../lib/hermes/attachments'

// Composer attachment state + picking. Where a native OS dialog exists, Hermes reads
// the returned host path directly (the runtime is loopback-local); everywhere else we
// fall back to a hidden <input type=file> read as data URLs. This is a CAPABILITY
// question, not a demo question: `hasNativeFileDialog` is exactly "a real path a
// local Hermes can open", which browser and fixture sessions cannot produce.
export function useComposerAttachments(busy: boolean) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const pickAttachment = async () => {
    if (busy) return
    if (hermesClient.hasNativeFileDialog) {
      const chosen = await hermesClient.chooseFile([]).catch(() => null)
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
