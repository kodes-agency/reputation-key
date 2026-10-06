// PROTOTYPE — variant A (Editor rail): Settings in the Portal editor's frame. The
// manager sidebar folds to its 48 px icon rail, a 288 px rail lists the sections with a
// status line each (head: the business or the property chip, and the setup meter), and
// one column of content sits beside it. Below `lg` the rail is the Settings index and a
// row drills into its section (see ./a/ for the parts).
import { usePrototypeShell } from '#/components/prototype/prototype-shell-slots'
import { useViewportBelow } from '#/components/hooks/use-viewport-below'
import type { SettingsPrototypeVariantProps } from '../settings-prototype-types'
import { useHasSectionInUrl } from './a/variant-a-nav'
import { VariantAPane } from './a/variant-a-pane'
import { VariantARail } from './a/variant-a-rail'

export const VARIANT_A_NAME = 'Editor rail'

/** The rail and the content sit side by side from here (the Portal editor's three columns need more). */
const TWO_PANE_FROM_PX = 1024

export function VariantA({ ctx }: SettingsPrototypeVariantProps) {
  // The editor's own frame: the app sidebar folds to its icon rail and the page scrolls its panes.
  usePrototypeShell({ fullBleed: true })
  const isPhone = useViewportBelow(TWO_PANE_FROM_PX)
  const hasSection = useHasSectionInUrl()
  const showIndex = !isPhone || !hasSection
  const showSection = !isPhone || hasSection
  return (
    <div className="flex h-full min-h-0 bg-background">
      {showIndex ? <VariantARail ctx={ctx} isIndex={!showSection} /> : null}
      {showSection ? <VariantAPane ctx={ctx} isPhone={isPhone} /> : null}
    </div>
  )
}
