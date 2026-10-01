// The drawn part of the preview: the phone, the line over it and the filmstrip
// of guest states. Mounted only when there is a page to draw.
//
// "Try as guest" swaps the phone for an interactive copy that owns a small state
// machine and starts over each time it is switched on. It calls no server
// function, so a rating, a note or a tap here is not stored, sent or counted.

import { useReducer, type ReactNode } from 'react'
import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import type {
  PortalPreview,
  PortalPreviewExperience,
} from '#/contexts/portal/application/public-api'
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import {
  ARRIVAL_STATE,
  previewStateOptions,
  stateCaption,
  tryAsGuestReducer,
  type PreviewPageState,
  type PreviewStateId,
  type TryAsGuestAction,
} from './portal-preview-states'
import { PortalPreviewFilmstrip } from './portal-preview-filmstrip'
import { packFallbackNotice, TRY_AS_GUEST_NOTICE } from './portal-preview-rules'
import { PreviewGuestPage } from './preview-guest-page'
import { PreviewPhone } from './preview-phone'

// Small enough that the phone and the pane's own controls fit a laptop screen.
export const PHONE_SCALE = 0.7

/** The page in a state; it answers clicks only when given `onAction`. */
export type RenderPage = (
  state: PreviewPageState,
  onAction?: (action: TryAsGuestAction) => void,
) => ReactNode

type Props = Readonly<{
  preview: PortalPreview
  experience: PortalPreviewExperience
  copy: GuestPortalCopyV2
  locale: GuestLocale
  stateId: PreviewStateId
  onStateChange: (id: PreviewStateId) => void
  isTrying: boolean
  onTryChange: (isTrying: boolean) => void
}>

export function PortalPreviewStage({
  preview,
  experience,
  copy,
  locale,
  stateId,
  onStateChange,
  isTrying,
  onTryChange,
}: Props) {
  const options = previewStateOptions(preview.privateFeedbackThreshold)
  // A threshold change can drop the chosen state; fall back to arrival.
  const chosen = options.find((option) => option.id === stateId) ?? options[0]
  if (chosen === undefined) return null
  const page: RenderPage = (state, onAction) => (
    <PreviewGuestPage
      experience={experience}
      copy={copy}
      locale={locale}
      hasLanguageChip={preview.locales.length > 1}
      state={state}
      onAction={onAction}
    />
  )
  const caption = stateCaption(
    preview.source,
    isTrying ? 'Trying' : chosen.label,
    GUEST_LOCALE_METADATA[locale].englishName,
  )

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {caption}
      </p>
      {copy.locale !== locale ? (
        <p role="note" className="max-w-sm text-center text-xs text-muted-foreground">
          {packFallbackNotice(GUEST_LOCALE_METADATA[locale].englishName)}
        </p>
      ) : null}
      {isTrying ? (
        <p role="status" className="max-w-xs text-center text-xs text-muted-foreground">
          {TRY_AS_GUEST_NOTICE}
        </p>
      ) : null}
      {/* Board 02: the guest states stand beside the phone, as a column. They
          drop under it where there is no room for both. */}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center">
        {isTrying ? (
          <TryPhone page={page} threshold={preview.privateFeedbackThreshold} />
        ) : (
          <PreviewPhone
            scale={PHONE_SCALE}
            label={`Preview of the guest page: ${caption}`}
          >
            <div inert>{page(chosen.state)}</div>
          </PreviewPhone>
        )}
        <PortalPreviewFilmstrip
          options={options}
          active={chosen.id}
          onSelect={(id) => {
            // Choosing a state is leaving "Try as guest": the phone shows it.
            onTryChange(false)
            onStateChange(id)
          }}
          renderPage={(state) => page(state)}
        />
      </div>
    </div>
  )
}

/** The phone "Try as guest" plays in: a page that answers clicks by moving between the guest states locally. */
export function TryPhone({
  page,
  threshold,
}: Readonly<{ page: RenderPage; threshold: number }>) {
  const [state, dispatch] = useReducer(
    (current: PreviewPageState, action: TryAsGuestAction) =>
      tryAsGuestReducer(current, action, threshold),
    ARRIVAL_STATE,
  )
  return (
    <PreviewPhone scale={PHONE_SCALE} label="Guest page you can try">
      {page(state, dispatch)}
    </PreviewPhone>
  )
}
