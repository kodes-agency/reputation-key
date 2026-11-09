import { fontSetLinks, type FontSet } from '#/shared/font-sets'
import type { GuestLocale } from '#/shared/domain/guest-locale'

type FontSetLinksProps = Readonly<{
  fontSet: FontSet
  /** Picks the script of the preloaded guest fonts; unused by the app set. */
  locale: GuestLocale
}>

/** The `<link>` tags for one font set, for the document `<head>`; the root links one set per page. */
export function FontSetLinks({ fontSet, locale }: FontSetLinksProps) {
  return fontSetLinks(fontSet, locale).map((link) => (
    <link key={`${link.rel}:${link.href}`} {...link} />
  ))
}
