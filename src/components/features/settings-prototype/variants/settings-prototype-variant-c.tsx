// PROTOTYPE — variant C (In the app sidebar). No second navigation column and no
// Settings home: the sections are rows of the app's own left sidebar, expanded in
// place under the app's main places. Content is the standard page (PageShell +
// PageHeader, 768 form column). From two properties the Business group's header is a
// property chip; on a phone the sidebar sheet holds the same block and the page
// header has a section picker. Structure, not a re-skin: see c/c-sidebar.tsx.
// Keep the two exports below; variants/index.ts imports exactly these names.
import { useMemo } from 'react'
import { usePrototypeShell } from '#/components/prototype/prototype-shell-slots'
import type { SettingsPrototypeVariantProps } from '../settings-prototype-types'
import { SettingsPageC } from './c/c-page'
import { InAppSidebar } from './c/c-sidebar'

export const VARIANT_C_NAME = 'In the app sidebar'

export function VariantC({ ctx }: SettingsPrototypeVariantProps) {
  // The shell compares the node by identity, so it changes only when the context does.
  const sidebar = useMemo(() => <InAppSidebar ctx={ctx} />, [ctx])
  usePrototypeShell({ sidebar })
  return <SettingsPageC ctx={ctx} />
}
