import { useId, useRef } from 'react'
import { ImageOff, ImageUp } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Kbd } from '#/components/ui/kbd'
import { useShortcutModifier } from '#/components/hooks/use-shortcut-modifier'
import type { ScreenshotRefusal } from './beta-feedback-screenshot-encode'
import {
  type BetaFeedbackScreenshotState,
  firstImageFile,
} from './beta-feedback-screenshot-state'

type Props = Readonly<{
  state: BetaFeedbackScreenshotState
  onAttach: (file: File) => void
  onRemove: () => void
  disabled?: boolean
}>

const REFUSALS: Readonly<Record<ScreenshotRefusal, string>> = {
  not_an_image: 'That file is not an image. Choose a screenshot or another picture.',
  too_large_to_read: 'That image is over 40 MB. Choose a smaller one.',
  unreadable: 'That image could not be read. Try another screenshot.',
  too_detailed:
    'That image is too detailed to send even after shrinking it. Try cropping it.',
}

function sizeLabel(state: Extract<BetaFeedbackScreenshotState, { status: 'ready' }>) {
  const { width, height, blob } = state.prepared
  const kilobytes = Math.max(1, Math.round(blob.size / 1024))
  return `${width} × ${height} · ${kilobytes} KB`
}

/**
 * One optional screenshot, on any report. The reporter pastes, drops or picks
 * any image as it is; the form shrinks it to fit. What the preview shows is
 * what is sent, and Remove drops it before sending.
 */
export function BetaFeedbackScreenshotField({
  state,
  onAttach,
  onRemove,
  disabled,
}: Props) {
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const modifier = useShortcutModifier()

  const takeFirstImage = (files: FileList | null) => {
    const file = firstImageFile(files)
    if (file) onAttach(file)
  }

  return (
    <div
      className="space-y-3 rounded-lg border bg-muted/25 p-3"
      onDragOver={(event) => {
        if (!disabled) event.preventDefault()
      }}
      onDrop={(event) => {
        if (disabled) return
        event.preventDefault()
        takeFirstImage(event.dataTransfer.files)
      }}
    >
      <input
        ref={input}
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a screenshot"
        disabled={disabled}
        onChange={(event) => {
          takeFirstImage(event.currentTarget.files)
          // The same file chosen again after Remove must still fire a change.
          event.currentTarget.value = ''
        }}
      />

      {state.status === 'ready' ? (
        <div className="space-y-2">
          <img
            src={state.previewUrl}
            alt="Screenshot to send"
            width={state.prepared.width}
            height={state.prepared.height}
            className="max-h-60 w-full rounded-md border bg-muted/40 object-contain"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Screenshot · {sizeLabel(state)}. This is what is sent.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={onRemove}
              disabled={disabled}
              aria-label="Remove screenshot"
            >
              <ImageOff className="size-3.5" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => input.current?.click()}
            disabled={disabled || state.status === 'preparing'}
          >
            <ImageUp className="size-3.5" />
            {state.status === 'preparing' ? 'Preparing screenshot…' : 'Add a screenshot'}
          </Button>
          <p
            className="block text-xs leading-snug text-muted-foreground"
            aria-live="polite"
          >
            {state.status === 'refused' ? (
              REFUSALS[state.reason]
            ) : (
              <>
                Optional. Paste one with <Kbd>{modifier}</Kbd> <Kbd>V</Kbd>, drop it here,
                or choose a file — any size works. Whatever it shows is sent with your
                report.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
