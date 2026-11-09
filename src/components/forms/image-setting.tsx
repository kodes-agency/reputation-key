// The one way to set an identity image: a person's avatar, an organization's logo. The
// Property look logo keeps its own dialog on purpose: it crops, sets a focal point and
// checks a light version.
//
// The picture, with Upload, or Replace and Remove, as Buttons named for what the image
// is, and one line of help (the formats and the limit). The setting owns what a
// refusal says: a rejected upload or removal is a toast in the words every action
// uses, and the picture stays as it was. `onUpload` stores the file and SAVES its
// address, resolving with the address to show; `onRemove` saves the removal. Neither
// toasts a failure: the setting does. A success toast is the caller's mutation's, and a
// mutation that passes `errorMessage` as well would tell the person twice.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ImageSettingView } from './image-setting/image-setting-view'
import {
  DEFAULT_ACCEPTED_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  imageSettingHelp,
  invalidFileMessage,
  removeFailureMessage,
  uploadFailureMessage,
} from './image-setting/image-setting-copy'
import type { ImageSettingStatus } from './image-setting/image-setting-view'

type Props = Readonly<{
  /** What the image is, lower case: "avatar", "logo". It names the buttons. */
  subject: string
  /** What is saved now, or null. A new value from the page replaces what is shown. */
  imageUrl: string | null
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string>
  onRemove: () => Promise<unknown>
  disabled?: boolean
  acceptedTypes?: ReadonlyArray<string>
  maxFileSize?: number
  /** Replaces the line of help, which says what the file is checked against. */
  help?: ReactNode
}>

export function ImageSetting({
  subject,
  imageUrl,
  onUpload,
  onRemove,
  disabled = false,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  help,
}: Props) {
  const setting = useImageSetting({
    subject,
    imageUrl,
    acceptedTypes,
    maxFileSize,
    disabled,
    onUpload,
    onRemove,
  })

  return (
    <ImageSettingView
      subject={subject}
      imageUrl={setting.imageUrl}
      status={setting.status}
      progress={setting.progress}
      disabled={disabled}
      help={help ?? imageSettingHelp(acceptedTypes, maxFileSize)}
      dragOver={setting.dragOver}
      acceptedTypes={acceptedTypes}
      inputRef={setting.inputRef}
      chooseRef={setting.chooseRef}
      onChoose={setting.choose}
      onFile={setting.upload}
      onRemove={setting.remove}
      dropProps={setting.dropProps}
    />
  )
}

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

function useImageSetting({
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
  const chooseRef = useRef<HTMLButtonElement>(null)
  // The Remove button leaves with the picture, and the focus with it: it moves to the
  // Upload button that takes its place, never to the page.
  const handFocusToChoose = useRef(false)
  useEffect(() => {
    if (handFocusToChoose.current && shown === null) {
      handFocusToChoose.current = false
      chooseRef.current?.focus()
    }
  }, [shown])

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
      handFocusToChoose.current = true
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
    chooseRef,
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

type UseDragDropOptions = Readonly<{
  disabled: boolean
  uploading: boolean
  onDropFile: (file: File) => void
}>

type UseDragDropReturn = Readonly<{
  dragOver: boolean
  handleDragOver: (e: React.DragEvent) => void
  handleDragLeave: (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent) => void
}>

function useDragDrop({
  disabled,
  uploading,
  onDropFile,
}: UseDragDropOptions): UseDragDropReturn {
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled && !uploading) {
        setDragOver(true)
      }
    },
    [disabled, uploading],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only deactivate when leaving the drop zone entirely, not when entering a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)

      if (disabled || uploading) return

      const file = e.dataTransfer.files[0]
      if (file) {
        onDropFile(file)
      }
    },
    [disabled, uploading, onDropFile],
  )

  return {
    dragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
