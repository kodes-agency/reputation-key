// The frame a refusal is drawn in. Kept out of `page-identity`, which first paint
// loads for every page's states: only the shell's lazy not-found boundary needs it.
import type { Crumb } from './page-header'
import {
  deepestPage,
  resolveCrumbs,
  type PageIdentity,
  type PageMatch,
} from './page-identity'
import type { PageTier } from './page-shell'

type Where = Parameters<typeof resolveCrumbs>[1]

/**
 * The width tier a refused page's frame uses: the page's own, else the layout's.
 * The settings layout is narrow (it wraps every settings page in
 * `PageShell tier="narrow"`), so a refusal drawn in the shell, without that
 * layout, must be narrow too or the page changes width.
 */
export function pageTier(identity: PageIdentity): PageTier | undefined {
  return identity.tier ?? (identity.under === 'settings' ? 'narrow' : undefined)
}

/**
 * The frame a refusal of `title` is drawn in: the width tier and the trail of the
 * deepest page in the chain, so a refused People page keeps People's width and
 * its trail rather than the standard width and no trail. The notice keeps its own
 * title and copy; its last crumb is that title.
 */
export function refusalFrame(
  matches: readonly PageMatch[],
  title: string,
  where: Where,
): Readonly<{ tier?: PageTier; breadcrumbs?: readonly Crumb[] }> {
  const page = deepestPage(matches)
  if (!page) return {}
  const named = { ...page, title, crumb: title === page.title ? page.crumb : undefined }
  return { tier: pageTier(page), breadcrumbs: resolveCrumbs(named, where) }
}
