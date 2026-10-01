import { Check, Globe, X } from 'lucide-react'
import {
  useId,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  type SyntheticEvent,
} from 'react'
import type { LanguageOption, LanguageSwitcherCopy } from './language-options'

export type LanguageSheetProps = Readonly<{
  ref: Ref<HTMLDialogElement>
  options: readonly LanguageOption[]
  copy: LanguageSwitcherCopy
  /** Asks the sheet to close; the dialog's own `close` event follows. */
  onRequestClose: () => void
  /** The dialog has closed, by any route: its button, Esc, a tap outside or a row. */
  onClosed: () => void
}>

/**
 * The language sheet of board G02: a native modal `<dialog>`, so the browser
 * supplies the focus trap, the inert page behind it and the top layer, and no
 * dialog library reaches the guest's bundle. Each row is a plain link to the
 * portal in that language (`hreflang`, `?locale=`), so choosing one is a
 * navigation that works without any script and keeps the channel marker.
 */
export function LanguageSheet({
  ref,
  options,
  copy,
  onRequestClose,
  onClosed,
}: LanguageSheetProps) {
  const titleId = useId()

  // Escape closes a native modal dialog by itself; handling it here as well
  // keeps the behaviour in one place the tests can drive with any key source.
  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onRequestClose()
  }

  // A tap on the dimmed page lands on the dialog element itself, because the
  // panel fills it and the backdrop is part of it. Keyboard users have Esc and
  // the close button.
  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onRequestClose()
  }

  // The current row is where the guest already is: it closes the sheet, not reloads.
  const keepPage = (event: SyntheticEvent) => {
    event.preventDefault()
    onRequestClose()
  }

  return (
    <dialog
      ref={ref}
      className="ih-sheet"
      aria-labelledby={titleId}
      onClose={onClosed}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
    >
      <div className="ih-sheet__panel">
        <div className="ih-sheet__grab" aria-hidden="true" />
        <div className="ih-sheet__head">
          <h2 id={titleId} className="ih-display ih-sheet__title">
            {copy.languageSheetTitle}
          </h2>
          <button
            type="button"
            className="ih-sheet__close"
            aria-label={copy.languageSheetClose}
            onClick={onRequestClose}
          >
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <ul className="ih-sheet__list">
          {options.map((option) => (
            <li key={option.locale}>
              <a
                href={option.href}
                hrefLang={option.locale}
                aria-current={option.isCurrent ? 'page' : undefined}
                className="ih-sheet__row"
                onClick={option.isCurrent ? keepPage : undefined}
              >
                <span className="ih-sheet__text">
                  <span lang={option.locale} className="ih-sheet__name">
                    {option.nativeName}
                  </span>
                  {option.secondaryName ? (
                    <span className="ih-sheet__aside">{option.secondaryName}</span>
                  ) : null}
                </span>
                {option.isCurrent ? (
                  <>
                    <Check size={20} strokeWidth={2} aria-hidden="true" />
                    <span className="ih-sr-only">{copy.languageCurrent}</span>
                  </>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
        <p className="ih-sheet__hint">
          <Globe size={14} strokeWidth={1.6} aria-hidden="true" />
          {copy.languageSheetHint}
        </p>
      </div>
    </dialog>
  )
}
