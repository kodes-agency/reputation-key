import type { ComponentProps, ReactNode } from 'react'
import { inlineLinkClass } from '#/components/ui/inline-link'
import {
  GOOGLE_REVIEW_LINK_COPY,
  sentenceAroundGoogle,
  type GoogleReviewLink,
} from './google-review-link'

/**
 * An in-text link must be told apart without colour (WCAG 1.4.1, axe
 * link-in-text-block), and these sit in muted sentences. The underline is an
 * inline style as well as the utility because the Storybook Vitest runner that
 * gates axe compiles no Tailwind (`beta-feedback-reports.tsx` does the same).
 */
const IN_TEXT_UNDERLINE = { textDecorationLine: 'underline' } as const

type AnchorProps = Omit<ComponentProps<'a'>, 'href' | 'target' | 'rel'> &
  Readonly<{
    link: GoogleReviewLink
    /** What a screen reader hears after the words; "(opens in a new tab)" by default. */
    newTabNote?: string
  }>

/**
 * A link to Google, in a new tab. `noopener noreferrer` and `no-referrer`
 * because the page is Google's: it learns nothing of RepKey's URL, and the tab
 * it opens cannot reach back into this one. Every prop a menu item hands its
 * child (`RowActionsItem asChild`) lands on the anchor.
 */
export function GoogleReviewAnchor({
  link,
  newTabNote = GOOGLE_REVIEW_LINK_COPY.newTab,
  children,
  ...props
}: AnchorProps) {
  return (
    <a
      {...props}
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
    >
      {children}
      <span className="sr-only"> {newTabNote}</span>
    </a>
  )
}

/**
 * One of RepKey's sentences that sends a manager to Google, with its "look at
 * the review on Google" made the link when there is one. Without a link, or for
 * a sentence without those words, the text is returned as it is.
 *
 * The words say "the review", so when the link falls back to the property's
 * reviews a screen reader hears that it goes there, as the menu's label says.
 * The sign-in line stays in the menu: these sentences are status, and adding it
 * to them is a copy decision still open.
 */
export function GoogleLinkedText({
  text,
  link,
}: Readonly<{ text: string; link: GoogleReviewLink | null }>): ReactNode {
  const sentence = link === null ? null : sentenceAroundGoogle(text)
  if (link === null || sentence === null) return text
  return (
    <>
      {sentence.before}
      <GoogleReviewAnchor
        link={link}
        // The design system's mark for a link set in a sentence (`InlineLink`
        // writes the same): the Storybook pane metrics exempt only these from
        // the target-size floor, as WCAG 2.5.8 does.
        data-slot="inline-link"
        className={inlineLinkClass({ underline: 'always' })}
        style={IN_TEXT_UNDERLINE}
        newTabNote={
          link.kind === 'property' ? GOOGLE_REVIEW_LINK_COPY.propertyNewTab : undefined
        }
      >
        {sentence.phrase}
      </GoogleReviewAnchor>
      {sentence.after}
    </>
  )
}
