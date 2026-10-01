import { ChevronDown, Globe } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { glassClassName } from './glass-surface'
import {
  buildLanguageOptions,
  chipAccessibleName,
  chipCode,
  offersLanguageChoice,
  type LanguageSwitcherCopy,
} from './language-options'
import { LanguageSheet } from './language-sheet'

export type GuestLanguageSwitcherProps = Readonly<{
  /** The portal's own languages, in its order, the selected one included. */
  locales: readonly GuestLocale[]
  selectedLocale: GuestLocale
  /** The public token. Omitted only by a manager's preview, which gets no switcher. */
  token: string | undefined
  /** The public channel marker, kept when the guest switches language. */
  accessArtifactId: string | undefined
  copy: LanguageSwitcherCopy
}>

/**
 * The language chip of the Immersive Hub's header and the sheet it opens
 * (boards G01 and G02). A portal with one language shows neither.
 */
export function GuestLanguageSwitcher({ token, ...rest }: GuestLanguageSwitcherProps) {
  if (!token || !offersLanguageChoice(rest.locales)) return null
  return <LanguageChipAndSheet token={token} {...rest} />
}

function LanguageChipAndSheet({
  locales,
  selectedLocale,
  token,
  accessArtifactId,
  copy,
}: GuestLanguageSwitcherProps & Readonly<{ token: string }>) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    dialog.showModal()
    setIsOpen(true)
  }, [])
  const requestClose = useCallback(() => dialogRef.current?.close(), [])
  // However the dialog closed, the chip is where the guest was: hand focus back.
  const handleClosed = useCallback(() => {
    setIsOpen(false)
    chipRef.current?.focus()
  }, [])

  const options = buildLanguageOptions({
    locales,
    selectedLocale,
    token,
    accessArtifactId,
    copy,
  })

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className={glassClassName('chip', 'ih-chip')}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={chipAccessibleName(selectedLocale, copy)}
        onClick={open}
      >
        <Globe size={16} strokeWidth={1.6} aria-hidden="true" />
        <span>{chipCode(selectedLocale)}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      <LanguageSheet
        ref={dialogRef}
        options={options}
        copy={copy}
        onRequestClose={requestClose}
        onClosed={handleClosed}
      />
    </>
  )
}
