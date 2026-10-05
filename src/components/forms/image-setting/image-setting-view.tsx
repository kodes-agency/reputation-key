// The picture and the buttons of an identity image setting, in every state. It holds no
// state: `ImageSetting` owns what is saved, what is in flight and what a refusal does.
// Words, never a hover: the picture is a circle, and below it or beside it are the
// Buttons ("Upload logo", or "Replace logo" and "Remove logo") and one line of help.
import type { ChangeEvent, DragEvent, ReactNode, Ref } from 'react'
import { ImageIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { imageSettingLabels } from './image-setting-copy'

export type ImageSettingStatus = 'idle' | 'uploading' | 'removing'

export type ImageSettingViewProps = Readonly<{
  subject: string
  imageUrl: string | null
  status: ImageSettingStatus
  /** 0 to 100, while `uploading`. */
  progress: number
  disabled: boolean
  help: ReactNode
  dragOver: boolean
  acceptedTypes: ReadonlyArray<string>
  inputRef: Ref<HTMLInputElement>
  /** Opens the file chooser. */
  onChoose: () => void
  onFile: (file: File) => void
  onRemove: () => void
  dropProps: Readonly<{
    onDragOver: (event: DragEvent) => void
    onDragLeave: (event: DragEvent) => void
    onDrop: (event: DragEvent) => void
  }>
}>

function Picture({
  subject,
  imageUrl,
  uploading,
  progress,
  dragOver,
}: Pick<ImageSettingViewProps, 'subject' | 'imageUrl' | 'progress' | 'dragOver'> &
  Readonly<{ uploading: boolean }>) {
  const labels = imageSettingLabels(subject)
  return (
    <div
      className={cn(
        'relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-muted-foreground',
        dragOver && 'ring-2 ring-primary',
      )}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={labels.current} className="size-full object-cover" />
      ) : (
        <>
          <ImageIcon aria-hidden="true" className="size-8" />
          <span className="sr-only">{labels.none}</span>
        </>
      )}
      {uploading ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-background/80 text-sm font-medium text-foreground tabular-nums"
        >
          {progress}%
        </span>
      ) : null}
    </div>
  )
}

export function ImageSettingView({
  subject,
  imageUrl,
  status,
  progress,
  disabled,
  help,
  dragOver,
  acceptedTypes,
  inputRef,
  onChoose,
  onFile,
  onRemove,
  dropProps,
}: ImageSettingViewProps) {
  const labels = imageSettingLabels(subject)
  const uploading = status === 'uploading'
  const removing = status === 'removing'
  const busy = status !== 'idle'
  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Choosing the same file again must still fire a change.
    event.target.value = ''
    if (file) onFile(file)
  }

  return (
    <div
      data-slot="image-setting"
      aria-busy={busy || undefined}
      className="flex flex-col gap-4 sm:flex-row sm:items-center"
      {...dropProps}
    >
      <Picture
        subject={subject}
        imageUrl={imageUrl}
        uploading={uploading}
        progress={progress}
        dragOver={dragOver}
      />
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onChoose}
            disabled={disabled || removing}
            pending={uploading}
            pendingLabel={labels.uploading}
          >
            {imageUrl ? labels.replace : labels.upload}
          </Button>
          {imageUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={disabled || uploading}
              pending={removing}
              pendingLabel={labels.removing}
            >
              {labels.remove}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{help}</p>
      </div>
      {/* The Buttons are the keyboard stops; this is what they open. */}
      <input
        ref={inputRef}
        type="file"
        hidden
        tabIndex={-1}
        accept={acceptedTypes.join(',')}
        disabled={disabled || busy}
        onChange={onInputChange}
      />
      <p role="status" className="sr-only">
        {uploading ? labels.uploading : removing ? labels.removing : ''}
      </p>
    </div>
  )
}
