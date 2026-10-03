// The right-hand side of the review page: the page a guest meets after a 1 star
// and after a 5 star rating, side by side, so a manager sees that the Google
// card is the same for both. The language switch and "Try as guest" sit above;
// choosing a state under "See every guest state" shows that one phone instead.
// The page is the saved draft, drawn by the same view the editor's preview uses.
// Nothing here writes anything.

import { useEffect, useRef } from 'react'
import { Smartphone } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import {
  GUEST_LOCALE_METADATA,
  adminLanguageCode,
  type GuestLocale,
} from '#/shared/domain/guest-locale'
import {
  describeUnavailable,
  TRY_AS_GUEST_NOTICE,
} from '../portal-preview/portal-preview-rules'
import {
  stateCaption,
  type PreviewPageState,
  type PreviewStateId,
} from '../portal-preview/portal-preview-states'
import { PreviewGuestPage } from '../portal-preview/preview-guest-page'
import { PreviewPhone, phoneFrameSize } from '../portal-preview/preview-phone'
import { TryPhone, type RenderPage } from '../portal-preview/portal-preview-stage'
import type { ReviewPreviewPart } from './portal-review-changes'
import { describeGoogleCard, reviewPairStates } from './portal-review-pair'
import { showPartInPhones } from './portal-review-scroll'
import type { ReviewPreviewData } from './use-review-preview'

/** Two phones side by side have to fit the column, so they are drawn smaller than the editor's. */
const PAIR_SCALE = 0.6

/** What the phones show. */
export type ReviewPreviewView =
  | Readonly<{ kind: 'pair' }>
  | Readonly<{
      kind: 'state'
      id: PreviewStateId
      label: string
      state: PreviewPageState
    }>
  | Readonly<{ kind: 'try' }>

/** "Show" on a change: bring this part into view. `nonce` makes a repeated request count. */
export type ShowRequest = Readonly<{ part: ReviewPreviewPart; nonce: number }>

type Props = Readonly<{
  data: ReviewPreviewData
  view: ReviewPreviewView
  onViewChange: (view: ReviewPreviewView) => void
  onLocaleChange: (locale: GuestLocale) => void
  showRequest: ShowRequest | null
}>

export function ReviewPreview({
  data,
  view,
  onViewChange,
  onLocaleChange,
  showRequest,
}: Props) {
  const phones = useRef<HTMLDivElement>(null)
  const handled = useRef(-1)
  // The phones may not be drawn yet when "Show" is pressed (another language is
  // still loading, or a single state is on show), so the request waits for them.
  const arePhonesDrawn = data.status === 'ready' && view.kind === 'pair'
  useEffect(() => {
    if (showRequest === null || showRequest.nonce === handled.current) return
    if (!arePhonesDrawn || phones.current === null) return
    handled.current = showRequest.nonce
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    showPartInPhones(phones.current, showRequest.part, PAIR_SCALE, reduced)
    phones.current.scrollIntoView({
      block: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    })
  }, [showRequest, arePhonesDrawn])

  return (
    <section aria-label="What guests will see" className="space-y-4">
      {/* The guest fonts are linked here: the review page is not a guest route. */}
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      <PreviewBody
        data={data}
        view={view}
        onViewChange={onViewChange}
        onLocaleChange={onLocaleChange}
        phones={phones}
      />
    </section>
  )
}

function PreviewBody({
  data,
  view,
  onViewChange,
  onLocaleChange,
  phones,
}: Readonly<{
  data: ReviewPreviewData
  view: ReviewPreviewView
  onViewChange: (view: ReviewPreviewView) => void
  onLocaleChange: (locale: GuestLocale) => void
  phones: React.RefObject<HTMLDivElement | null>
}>) {
  if (data.status === 'loading') return <PreviewSkeleton />
  if (data.status === 'error') {
    return (
      <RegionError
        size="compact"
        message="The preview couldn’t be loaded."
        onRetry={data.retry}
        retrying={data.retrying}
      />
    )
  }
  if (data.status === 'unavailable') {
    const note = describeUnavailable(data.reason)
    return (
      <EmptyState
        size="compact"
        icon={Smartphone}
        title={note.title}
        description={note.body}
      />
    )
  }
  const { preview, experience, copy, locale } = data
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
  const googleCard = describeGoogleCard(preview.privateFeedbackThreshold)
  const isTrying = view.kind === 'try'
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {preview.locales.length > 1 ? (
          <SegmentedControl
            aria-label="Preview language"
            value={locale}
            onValueChange={(value) => {
              const next = preview.locales.find((candidate) => candidate === value)
              if (next !== undefined) onLocaleChange(next)
            }}
            options={preview.locales.map((code) => ({
              value: code,
              label: adminLanguageCode(code),
              accessibleLabel: GUEST_LOCALE_METADATA[code].englishName,
            }))}
          />
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          aria-pressed={isTrying}
          onClick={() => onViewChange(isTrying ? { kind: 'pair' } : { kind: 'try' })}
        >
          <Smartphone aria-hidden="true" />
          {isTrying ? 'Stop trying' : 'Try as guest'}
        </Button>
      </div>
      {view.kind === 'pair' ? (
        <div className="space-y-1 text-center">
          <h2 className="text-base font-semibold">{googleCard.title}</h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {googleCard.body}
          </p>
        </div>
      ) : null}
      <div
        ref={phones}
        className="flex flex-wrap items-start justify-center gap-x-8 gap-y-6"
      >
        {view.kind === 'pair' ? (
          reviewPairStates(preview.privateFeedbackThreshold).map((option) => (
            <figure key={option.id} className="flex flex-col items-center gap-2">
              <figcaption className="text-sm">
                <b className="font-medium">{option.label}</b>
                <span className="text-muted-foreground"> · after publishing</span>
              </figcaption>
              <PreviewPhone
                scale={PAIR_SCALE}
                label={`Page after ${option.label}, ${GUEST_LOCALE_METADATA[locale].englishName}`}
              >
                <div inert>{page(option.state)}</div>
              </PreviewPhone>
            </figure>
          ))
        ) : (
          <SinglePhone
            view={view}
            page={page}
            locale={locale}
            threshold={preview.privateFeedbackThreshold}
          />
        )}
      </div>
    </>
  )
}

function SinglePhone({
  view,
  page,
  locale,
  threshold,
}: Readonly<{
  view: Exclude<ReviewPreviewView, { kind: 'pair' }>
  page: RenderPage
  locale: GuestLocale
  threshold: number
}>) {
  if (view.kind === 'try') {
    return (
      <div className="flex flex-col items-center gap-2">
        <p role="status" className="max-w-xs text-center text-xs text-muted-foreground">
          {TRY_AS_GUEST_NOTICE}
        </p>
        <TryPhone page={page} threshold={threshold} />
      </div>
    )
  }
  const caption = stateCaption(
    'draft',
    view.label,
    GUEST_LOCALE_METADATA[locale].englishName,
  )
  return (
    <figure className="flex flex-col items-center gap-2">
      <figcaption className="text-sm text-muted-foreground" aria-live="polite">
        {caption}
      </figcaption>
      <PreviewPhone scale={0.7} label={`Preview of the guest page: ${caption}`}>
        <div inert>{page(view.state)}</div>
      </PreviewPhone>
    </figure>
  )
}

function PreviewSkeleton() {
  return (
    <div className="flex flex-wrap justify-center gap-8" aria-busy="true">
      {[0, 1].map((index) => (
        <Skeleton
          key={index}
          className="rounded-[2.2rem]"
          style={phoneFrameSize(PAIR_SCALE)}
        />
      ))}
      <span className="sr-only">Loading preview…</span>
    </div>
  )
}
