import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { LookBackgroundMode } from '#/shared/domain/portal-look-readout'

/** What the page reads of the Property's Brand Profile. */
export type PropertyLookProfile = Readonly<{
  displayName: string
  primaryColor: string
  backgroundColor: string
  backgroundMode: LookBackgroundMode
  wordmark: string | null
  defaultGuestLocales: readonly OfferedGuestLocale[] | readonly string[]
}>
