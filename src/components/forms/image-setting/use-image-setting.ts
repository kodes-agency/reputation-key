// What an identity image setting does: choose, upload, remove, and what each outcome
// leaves behind. The picture changes only when the save has landed, so a refusal needs
// no undo: it leaves the image exactly where it was, in a toast, and the person can try
// again. The caller's `onUpload` stores the file and saves its address (and rejects if
// either fails); `onRemove` saves the removal.
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useDragDrop } from './use-drag-drop'
import {
  invalidFileMessage,
  removeFailureMessage,
  uploadFailureMessage,
} from './image-setting-copy'
import type { ImageSettingStatus } from './image-setting-view'

type Options = Readonly<{
  subject: string
  /** What the page last saved. A new value from the page replaces what is shown. */
  imageUrl: string | null
  acceptedTypes: ReadonlyArray<string>
  maxFileSize: number
  disabled: boolean
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string>
  onRemove: () => Promise<unknown>
}>

/** The value a prop holds now, or, once the prop moves, the new one: server truth wins. */
function useAdopted<T>(value: T) {
  const [seen, setSeen] = useState(value)
  const [adopted, setAdopted] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setAdopted(value)
  }
  return [adopted, setAdopted] as const
}

export function useImageSetting({
  subject,
  imageUrl,
  acceptedTypes,
  maxFileSize,
  disabled,
  onUpload,
  onRemove,
}: Options) {
  const [shown, setShown] = useAdopted(imageUrl)
  const [status, setStatus] = useState<ImageSettingStatus>('idle')
  const [progress, setProgress] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(
    async (file: File) => {
      const refusal = invalidFileMessage(file, acceptedTypes, maxFileSize)
      if (refusal) {
        toast.error(refusal)
        return
      }
      setStatus('uploading')
      setProgress(0)
      try {
        setShown(await onUpload(file, setProgress))
      } catch (error: unknown) {
        toast.error(uploadFailureMessage(subject)(error))
      } finally {
        setStatus('idle')
        setProgress(0)
      }
    },
    [acceptedTypes, maxFileSize, onUpload, setShown, subject],
  )

  const remove = useCallback(async () => {
    setStatus('removing')
    try {
      await onRemove()
      setShown(null)
    } catch (error: unknown) {
      toast.error(removeFailureMessage(subject)(error))
    } finally {
      setStatus('idle')
    }
  }, [onRemove, setShown, subject])

  const busy = status !== 'idle'
  const choose = useCallback(() => {
    if (!disabled && !busy) inputRef.current?.click()
  }, [busy, disabled])
  const { dragOver, handleDragOver, handleDragLeave, handleDrop } = useDragDrop({
    disabled,
    uploading: busy,
    onDropFile: (file) => void upload(file),
  })

  return {
    imageUrl: shown,
    status,
    progress,
    dragOver,
    inputRef,
    choose,
    upload: (file: File) => void upload(file),
    remove: () => void remove(),
    dropProps: {
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  } as const
}
