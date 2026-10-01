// The Immersive Hub guest page as the editor previews it: one language of a
// `PortalPreviewExperience` in one state (arrival, after a rating, note sent).
//
// A pure view of its props. It reads no session and calls no server function;
// with `onAction` (Try as guest) the page answers clicks by moving between the
// same states locally. The page-level pieces of the real guest page (header,
// rating card, Linktree, footer) are drawn here from the same shell, glass and
// copy packs, so the preview and the page share one look.

import { useId } from 'react'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { ImmersiveShell } from '#/components/features/guest'
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import type { PortalPreviewExperience } from '#/contexts/portal/application/public-api'
import type { PreviewPageState, TryAsGuestAction } from './portal-preview-states'
import { PreviewAfterRating } from './preview-after-rating'
import { PreviewFooter } from './preview-footer'
import { PreviewLinktree } from './preview-linktree'
import { PreviewPageTop } from './preview-page-top'
import { PreviewRatingCard } from './preview-rating-card'

export type PreviewGuestPageProps = Readonly<{
  experience: PortalPreviewExperience
  copy: GuestPortalCopyV2
  locale: GuestLocale
  /** Whether the Portal offers more than one language (one shows no chip). */
  hasLanguageChip: boolean
  state: PreviewPageState
  onAction?: (action: TryAsGuestAction) => void
}>

export function PreviewGuestPage({
  experience,
  copy,
  locale,
  hasLanguageChip,
  state,
  onAction,
}: PreviewGuestPageProps) {
  const idPrefix = useId()
  const { brand, content } = experience
  return (
    <ImmersiveShell
      brand={brand}
      heroAlt={{
        value: content.heroAlt.value,
        lang: content.heroAlt.fallbackFrom ?? undefined,
      }}
      lang={locale}
      height="container"
    >
      <PreviewPageTop
        experience={experience}
        copy={copy}
        locale={locale}
        hasLanguageChip={hasLanguageChip}
      />
      {state.phase === 'arrival' ? (
        <PreviewRatingCard
          copy={copy}
          locale={locale}
          displayName={brand.displayName}
          selected={state.selected}
          onAction={onAction}
          idPrefix={idPrefix}
        />
      ) : (
        <PreviewAfterRating
          copy={copy}
          displayName={brand.displayName}
          rating={state.rating}
          note={state.note}
          onAction={onAction}
          idPrefix={idPrefix}
        />
      )}
      <PreviewLinktree experience={experience} idPrefix={idPrefix} />
      <PreviewFooter copy={copy} displayName={brand.displayName} />
    </ImmersiveShell>
  )
}
