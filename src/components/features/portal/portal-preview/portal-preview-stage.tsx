// The drawn part of the preview: the phone, the line over it and the filmstrip
// of guest states. Mounted only when there is a page to draw.
//
// With a `selection` (the editor's) the parts of the phone's page can be clicked
// to edit them, and the hint under the phone says so; while the editor is on
// Languages the phone shows the language sheet open. "Try as guest" and the
// states in the filmstrip are never selectable.
//
// "Try as guest" swaps the phone for an interactive copy that owns a small state
// machine and starts over each time it is switched on. It calls no server
// function, so a rating, a note or a tap here is not stored, sent or counted.

import { useReducer, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
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
import { PreviewPartFrame } from './preview-part-frame'
import { previewPartOf, type PreviewSelection } from './preview-parts'
import { PreviewPhone } from './preview-phone'

type PreviewLanguages = ReadonlyArray<GuestLocale>

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
  /** Present in the editor: the phone's parts open the editor's sections. */
  selection?: PreviewSelection
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
  selection,
}: Props) {
  const options = previewStateOptions(preview.privateFeedbackThreshold)
  // A threshold change can drop the chosen state; fall back to arrival.
  const chosen = options.find((option) => option.id === stateId) ?? options[0]
  if (chosen === undefined) return null
  const hasLanguageChip = preview.locales.length > 1
  // Editing Languages shows the sheet open in the phone (board 04); a portal
  // with one language has no chip and so no sheet to show.
  const isSheetOpen =
    selection !== undefined &&
    previewPartOf(selection.active) === 'languages' &&
    hasLanguageChip
  const drawPage = (
    state: PreviewPageState,
    onAction?: (action: TryAsGuestAction) => void,
    languageSheet?: PreviewLanguages,
  ) => (
    <PreviewGuestPage
      experience={experience}
      copy={copy}
      locale={locale}
      hasLanguageChip={hasLanguageChip}
      state={state}
      onAction={onAction}
      languageSheet={languageSheet}
    />
  )
  const page: RenderPage = (state, onAction) => drawPage(state, onAction)
  const phonePage = drawPage(
    chosen.state,
    undefined,
    isSheetOpen ? preview.locales : undefined,
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
          <div className="flex flex-col items-center gap-3">
            <PreviewPhone
              scale={PHONE_SCALE}
              label={`Preview of the guest page: ${caption}`}
              isScrollLocked={isSheetOpen}
            >
              {selection ? (
                <PreviewPartFrame scale={PHONE_SCALE} selection={selection}>
                  {phonePage}
                </PreviewPartFrame>
              ) : (
                <div inert>{phonePage}</div>
              )}
            </PreviewPhone>
            {selection ? <SelectionHint /> : null}
          </div>
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

/** Board 02's line under the phone. */
function SelectionHint() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Sparkles className="size-3.5" aria-hidden="true" />
      Click any part of the page to edit it
    </p>
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
