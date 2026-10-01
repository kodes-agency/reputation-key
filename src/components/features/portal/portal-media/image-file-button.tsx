// The button that opens the file picker, and the picker it opens (visually
// hidden but labelled, so a test or a screen reader can reach it). The same file
// can be chosen again after a refusal, so the input is emptied once it is read.

import { useRef, type ChangeEvent } from 'react'
import { Button } from '#/components/ui/button'
import { PORTAL_IMAGE_ACCEPT } from './upload-portal-image'

type Props = Readonly<{
  /** The input's accessible name, e.g. "Photo file". */
  inputLabel: string
  children: string
  onFile: (file: File) => void
  disabled?: boolean
  variant?: 'outline' | 'link'
  className?: string
}>

export function ImageFileButton({
  inputLabel,
  children,
  onFile,
  disabled = false,
  variant = 'outline',
  className,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (picked) onFile(picked)
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={PORTAL_IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={inputLabel}
        onChange={choose}
      />
      <Button
        type="button"
        variant={variant}
        className={className}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {children}
      </Button>
    </>
  )
}
