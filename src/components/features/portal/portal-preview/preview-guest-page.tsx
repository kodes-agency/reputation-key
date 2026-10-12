// The Immersive Hub guest page as the editor previews it: one language of a
// `PortalPreviewExperience` in one state (arrival, after a rating, note sent).
//
// A pure view of its props, and the real page: the header, the title block, the
// response area, the Linktree and the footer are the pieces the live page is
// built from, fed the preview's data. It reads no session and calls no server
// function. Every piece that could open something is in its inert mode: the
// language chip opens no sheet, a tile is no link, the footer's links and "Got
// it" do nothing and nothing is recorded. With `onAction` (Try as guest) the
// response area answers clicks by moving between the same states locally.

import {
  GuestHeader,
  GuestTitleBlock,
  ImmersiveResponseView,
  ImmersiveShell,
  InertImmersiveFooterView,
  InertImmersiveLinktree,
  InertLanguageChip,
  InertLanguageSheet,
  guestCopyText,
  immersiveFooterCopy,
  immersiveResponseProps,
  previewLanguageOptions,
} from '#/components/features/guest'
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PortalPreviewExperience } from '#/contexts/portal/application/public-api'
import {
  guestPreviewState,
  type PreviewPageState,
  type TryAsGuestAction,
} from './portal-preview-states'
import { previewLinktreeLink } from './preview-linktree-links'
import { PREVIEW_PAGE_HEIGHT } from './preview-phone'

export type PreviewGuestPageProps = Readonly<{
  experience: PortalPreviewExperience
  copy: GuestPortalCopyV2
  locale: GuestLocale
  /** Whether the Portal offers more than one language (one shows no chip). */
  hasLanguageChip: boolean
  state: PreviewPageState
  onAction?: (action: TryAsGuestAction) => void
  /**
   * The languages to list when the language sheet is drawn open over the page
   * (board 04, while a manager edits Languages); absent, the sheet is closed.
   */
  languageSheet?: ReadonlyArray<GuestLocale>
}>

export function PreviewGuestPage({
  experience,
  copy,
  locale,
  hasLanguageChip,
  state,
  onAction,
  languageSheet,
}: PreviewGuestPageProps) {
  const { brand, content, linktree, links } = experience
  const hasLinktree = linktree.enabled && links.length > 0
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
      <GuestHeader
        displayName={brand.displayName}
        wordmark={brand.wordmark}
        logo={brand.logo}
        logoAlt={guestCopyText(copy, 'logoAlt', { name: brand.displayName })}
      >
        {hasLanguageChip ? (
          <InertLanguageChip selectedLocale={locale} copy={copy.copy} />
        ) : null}
      </GuestHeader>
      <div data-preview-part="welcome">
        <GuestTitleBlock
          title={{
            value: content.title.value,
            lang: content.title.fallbackFrom ?? undefined,
          }}
          displayName={brand.displayName}
        />
      </div>
      <ImmersiveResponseView
        {...responseProps(state, copy, brand.displayName, onAction)}
      />
      {hasLinktree ? (
        <div data-preview-part="linktree">
          <InertImmersiveLinktree
            enabled={linktree.enabled}
            title={content.linktreeTitle}
            defaultTitle={copy.copy.linktreeDefaultTitle}
            links={links.map(previewLinktreeLink)}
          />
        </div>
      ) : null}
      <InertImmersiveFooterView
        copy={immersiveFooterCopy(copy, brand.displayName)}
        isNoticeVisible
      />
      {languageSheet !== undefined && hasLanguageChip ? (
        <InertLanguageSheet
          options={previewLanguageOptions({
            locales: languageSheet,
            selectedLocale: locale,
            copy: copy.copy,
          })}
          copy={copy.copy}
          height={PREVIEW_PAGE_HEIGHT}
        />
      ) : null}
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
