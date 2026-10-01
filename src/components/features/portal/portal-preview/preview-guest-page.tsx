// The Immersive Hub guest page as the editor previews it: one language of a
// `PortalPreviewExperience` in one state (arrival, after a rating, note sent).
//
// A pure view of its props. It reads no session and calls no server function;
// with `onAction` (Try as guest) the page answers clicks by moving between the
// same states locally. The response area is the guest page's own view
// (`ImmersiveResponseView`), fed a controlled state, so the rating card, the
// receipt, the Google card and the private note are the ones guests get. The
// header, the Linktree and the footer are drawn here from the same shell,
// glass and copy packs until slices 13, 15, 16 and 17 expose theirs.

import { useId } from 'react'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import {
  ImmersiveResponseView,
  ImmersiveShell,
  immersiveResponseProps,
} from '#/components/features/guest'
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import type { PortalPreviewExperience } from '#/contexts/portal/application/public-api'
import {
  guestPreviewState,
  type PreviewPageState,
  type TryAsGuestAction,
} from './portal-preview-states'
import { PreviewFooter } from './preview-footer'
import { PreviewLinktree } from './preview-linktree'
import { PreviewPageTop } from './preview-page-top'

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
      <ImmersiveResponseView
        {...responseProps(state, copy, brand.displayName, onAction)}
      />
      <PreviewLinktree experience={experience} idPrefix={idPrefix} />
      <PreviewFooter copy={copy} displayName={brand.displayName} />
    </ImmersiveShell>
  )
}

/**
 * The response view's props: inert for a picture, and with `onAction` the
 * answers a guest gives (a rating, a note, Change) move the page locally.
 */
function responseProps(
  state: PreviewPageState,
  pack: GuestPortalCopyV2,
  displayName: string,
  onAction: ((action: TryAsGuestAction) => void) | undefined,
) {
  const inert = immersiveResponseProps(guestPreviewState(state), { pack, displayName })
  if (onAction === undefined) return inert
  return {
    ...inert,
    onSubmitRating: async ({ rating }: { rating: number }) =>
      onAction({ type: 'rate', rating }),
    onSubmitNote: async () => {
      onAction({ type: 'sendNote' })
      return true
    },
    onChangeRating: () => onAction({ type: 'change' }),
  }
}
