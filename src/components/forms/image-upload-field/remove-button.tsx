// Remove button component for ImageUploadField.

import { X } from 'lucide-react'

type RemoveButtonProps = Readonly<{
  onClick: (e: React.MouseEvent) => void
  ariaLabel?: string
  className?: string
}>

export function RemoveButton({
  onClick,
  ariaLabel = 'Remove image',
  className = '',
}: RemoveButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className={`absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-black/80 ${className}`}
      aria-label={ariaLabel}
    >
      <X className="size-4" />
    </button>
  )
}
