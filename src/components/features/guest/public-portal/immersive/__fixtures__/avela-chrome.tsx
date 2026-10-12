// The header and title block of boards G01, G02, G10 and G11, built from the
// real pieces with the Avela copy of the boards, for stories only. English and
// Bulgarian and German use the shipped v2 packs.

import type { ReactNode } from 'react'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { GuestHeader } from '../guest-header'
import { GuestLanguageSwitcher } from '../guest-language-switcher'
import { GuestTitleBlock } from '../guest-title-block'
import type { LanguageSwitcherCopy } from '../language-options'
import { bgV2 } from '../../language-packs/bg-v2'
import { deV2 } from '../../language-packs/de-v2'
import { enV2 } from '../../language-packs/en-v2'
import { STORY_LOGO } from './story-logo'

export type AvelaLocale = 'en' | 'bg' | 'de'

const PAGE: Readonly<
  Record<AvelaLocale, { copy: LanguageSwitcherCopy; title: string; logoAlt: string }>
> = {
  en: { copy: enV2.copy, title: 'Pool & Terrace', logoAlt: 'Avela Resort logo' },
  bg: { copy: bgV2.copy, title: 'Басейн и тераса', logoAlt: 'Лого на Avela Resort' },
  de: {
    copy: deV2.copy,
    title: 'Pool & Terrasse',
    logoAlt: 'Logo von Avela Resort',
  },
}

/** The four languages of board G02, in the portal's order. */
export const AVELA_LOCALES = [
  'en',
  'bg',
  'es',
  'de',
] as const satisfies readonly GuestLocale[]

export type AvelaChromeProps = Readonly<{
  displayName?: string
  locale?: AvelaLocale
  locales?: readonly GuestLocale[]
  withLogo?: boolean
  /** Replaces the title, to try a title that is a fallback or a very long name. */
  title?: string
  /** The wordmark, to try a long one or none (`null`); "Avela" by default. */
  wordmark?: string | null
}>

export function AvelaChrome({
  displayName = 'Avela Resort',
  locale = 'en',
  locales = AVELA_LOCALES,
  withLogo = false,
  title,
  wordmark = 'Avela',
}: AvelaChromeProps): ReactNode {
  const page = PAGE[locale]
  return (
    <>
      <GuestHeader
        displayName={displayName}
        wordmark={wordmark}
        logo={withLogo ? STORY_LOGO : null}
        logoAlt={page.logoAlt}
      >
        <GuestLanguageSwitcher
          locales={locales}
          selectedLocale={locale}
          token="story-token"
          accessArtifactId={undefined}
          copy={page.copy}
        />
      </GuestHeader>
      <GuestTitleBlock title={{ value: title ?? page.title }} displayName={displayName} />
    </>
  )
}
