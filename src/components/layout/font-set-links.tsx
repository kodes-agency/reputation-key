import { fontSetLinks, type FontSet } from '#/shared/font-sets'
import type { GuestLocale } from '#/shared/domain/guest-locale'

type FontSetLinksProps = Readonly<{
  fontSet: FontSet
  /** Picks the script of the preloaded guest fonts; unused by the app set. */
  locale: GuestLocale
}>

/**
 * The `<link>` tags for one font set, meant for the document `<head>`. The root
 * links one set per page: the app fonts come from two third-party stylesheets,
 * the guest fonts from our own origin.
 */
export function FontSetLinks({ fontSet, locale }: FontSetLinksProps) {
  return fontSetLinks(fontSet, locale).map((link) => (
    <link key={`${link.rel}:${link.href}`} {...link} />
  ))
}
