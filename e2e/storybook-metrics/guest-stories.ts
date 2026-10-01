// The guest page's stories the quality gate measures (round 4, slice 18), and
// the ones it leaves out, each with the reason. `guest-immersive.metrics.ts`
// checks this file against Storybook's index, so a story added under
// `src/components/features/guest` is either measured or excluded here, or the
// gate goes red.
//
// "G01 to G12" are the boards of the round 4 guest design. They are built as
// the stories below: G01 and G09 (shell), G01, G02, G10 and G11 (header and
// language sheet), G03 to G08 and G11 (rating card, after-rating cards, "Your
// response"), G10 (Linktree), G01 and G04 (footer), G12 (unavailable page), and
// whole pages (`ImmersivePage`) that compose the real pieces.

/** A story is "in the area" when its file is under one of these. */
export const GUEST_STORY_IMPORT_PREFIXES: ReadonlyArray<string> = [
  './src/components/features/guest/',
]

/**
 * The widths the plan names: a 320 px phone (the narrowest the product
 * supports), a 375 px phone, and 768 px, where the page is still a phone-width
 * column inside a tablet window.
 */
export const GUEST_WIDTHS = [320, 375, 768] as const
export type GuestWidth = (typeof GUEST_WIDTHS)[number]

/** Tall enough for the footer of a whole page to be in view on a phone. */
export const GUEST_VIEWPORT_HEIGHT = 844

/** The two things a guest story renders as its root: the Immersive shell and the unavailable page. */
export const GUEST_PANE_SELECTOR = '.ih-root, .portal-unavailable'

/**
 * Every target on the page is held to 44 px, at every width: a chip, a star
 * (54), a tile, a link in the footer. The page is only ever a phone-width
 * column, so the Inbox pane's 36 px and desktop 24 px floors do not apply.
 */
export const GUEST_TARGET_MIN_PX = 44

export const MEASURED_GUEST_STORIES: ReadonlyArray<string> = [
  // Features/Guest/ImmersiveHeader
  'features-guest-immersiveheader--g-01-header-and-title',
  'features-guest-immersiveheader--g-02-language-sheet',
  'features-guest-immersiveheader--sheet-keyboard-and-focus',
  'features-guest-immersiveheader--g-10-german',
  'features-guest-immersiveheader--g-11-bulgarian',
  'features-guest-immersiveheader--one-language-shows-no-chip',
  'features-guest-immersiveheader--two-languages',
  'features-guest-immersiveheader--six-languages',
  'features-guest-immersiveheader--logo-replaces-wordmark',
  'features-guest-immersiveheader--long-name-on-narrow-phone',
  // Features/Guest/ImmersiveShell
  'features-guest-immersiveshell--g-01-arrival',
  'features-guest-immersiveshell--g-09-no-photo',
  'features-guest-immersiveshell--ignores-the-app-theme',
  'features-guest-immersiveshell--container-leaves-the-document',
  'features-guest-immersiveshell--dark-accent-is-replaced',
  'features-guest-immersiveshell--wide-viewport',
  // Features/Guest/ImmersiveResponse
  'features-guest-immersiveresponse--g-03-rating-chosen',
  'features-guest-immersiveresponse--keyboard-chooses-a-star',
  'features-guest-immersiveresponse--asks-for-a-rating',
  'features-guest-immersiveresponse--sends-the-chosen-rating',
  'features-guest-immersiveresponse--rating-save-failed',
  'features-guest-immersiveresponse--g-04-after-low',
  'features-guest-immersiveresponse--g-05-after-high',
  'features-guest-immersiveresponse--note-opens-and-closes',
  'features-guest-immersiveresponse--note-is-sent',
  'features-guest-immersiveresponse--g-06-note-writing',
  'features-guest-immersiveresponse--g-07-note-sent',
  'features-guest-immersiveresponse--g-08-google-unavailable',
  'features-guest-immersiveresponse--g-11-bulgarian-error',
  'features-guest-immersiveresponse--bulgarian-after-low',
  'features-guest-immersiveresponse--sending',
  'features-guest-immersiveresponse--g-07-your-response-open',
  'features-guest-immersiveresponse--opens-and-closes-by-keyboard',
  'features-guest-immersiveresponse--receipt-change-opens-the-form',
  'features-guest-immersiveresponse--changes-the-rating',
  'features-guest-immersiveresponse--escape-closes-the-rating-form',
  'features-guest-immersiveresponse--removes-the-note',
  'features-guest-immersiveresponse--note-removed-notice',
  'features-guest-immersiveresponse--full-withdrawal-asks-first',
  'features-guest-immersiveresponse--starts-over',
  'features-guest-immersiveresponse--removal-failed',
  'features-guest-immersiveresponse--windows-ended',
  'features-guest-immersiveresponse--bulgarian-your-response',
  // Features/Guest/ImmersiveLinktree
  'features-guest-immersivelinktree--before-a-rating',
  'features-guest-immersivelinktree--tap-before-a-rating-is-plain-navigation',
  'features-guest-immersivelinktree--after-a-rating',
  'features-guest-immersivelinktree--modified-click-leaves-the-tap-to-the-browser',
  'features-guest-immersivelinktree--german-with-fallback',
  'features-guest-immersivelinktree--long-words-at-three-twenty',
  'features-guest-immersivelinktree--three-links',
  'features-guest-immersivelinktree--one-link',
  'features-guest-immersivelinktree--default-title',
  'features-guest-immersivelinktree--switched-off',
  // Features/Guest/ImmersiveFooter
  'features-guest-immersivefooter--g-01-notice-showing',
  'features-guest-immersivefooter--g-04-acknowledged',
  'features-guest-immersivefooter--bulgarian',
  'features-guest-immersivefooter--first-visit-is-counted-before-acknowledging',
  'features-guest-immersivefooter--acknowledge-hides-the-notice',
  'features-guest-immersivefooter--acknowledged-guest-is-still-counted',
  // Features/Guest/PortalUnavailable
  'features-guest-portalunavailable--g-12-unavailable',
  'features-guest-portalunavailable--ignores-the-app-theme',
  // Features/Guest/ImmersivePage
  'features-guest-immersivepage--with-photo',
  'features-guest-immersivepage--without-photo',
  'features-guest-immersivepage--first-visit-notice-appears-after-paint',
  'features-guest-immersivepage--german-long-words',
]

/** Stories left out by id. None today: every story under a measured title is measured. */
export const EXCLUDED_GUEST_STORIES: Readonly<Record<string, string>> = {}

/** Whole titles left out, each with the reason. */
export const EXCLUDED_GUEST_TITLES: Readonly<Record<string, string>> = {
  'Features/Guest/GuestPageView':
    'The legacy renderer (publication schema v1 and v2). It is not the Immersive Hub and goes when the last v1/v2 snapshot is republished.',
  'Features/Guest/GuestResponseForm':
    'The legacy renderer (publication schema v1 and v2), as above.',
  'Features/Guest/PublicPortalContent':
    'The legacy renderer (publication schema v1 and v2), as above.',
  'Guest/GuestAnalyticsNotice':
    'The legacy renderer’s fixed bottom bar. The Immersive Hub shows the notice inline in its footer (ImmersiveFooter).',
  'Guest/GuestFonts':
    'A type specimen of the self-hosted guest fonts, not a page; its contrast and glyph coverage are what it shows.',
}
