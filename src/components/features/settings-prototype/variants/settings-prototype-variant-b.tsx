// PROTOTYPE — variant B, Settings home. No settings rail: the app sidebar stays open and
// /settings-prototype is a home page of grouped tiles, each with its status in tone, under
// a header that carries the identity and the setup meter. A tile opens the section on its
// own page (?section=) with a way back to Settings and a "Jump to" menu. From 2 properties
// the home gains a property switcher and an All properties block above the tiles.
import { useMemo } from 'react'
import { useSearch } from '@tanstack/react-router'
import { requestedSearchOf } from '../settings-prototype-search'
import type { SettingsPrototypeVariantProps } from '../settings-prototype-types'
import { SettingsHomePage } from './b/b-home'
import { resolveHome } from './b/b-model'
import { SectionPage } from './b/b-section-page'

export const VARIANT_B_NAME = 'Settings home'

export function VariantB({ ctx }: SettingsPrototypeVariantProps) {
  const search = useSearch({ from: '/_authenticated/settings-prototype' })
  const requested = useMemo(() => requestedSearchOf(search), [search])
  const home = useMemo(() => resolveHome(requested, ctx), [requested, ctx])
  return home.open === null ? (
    <SettingsHomePage home={home} />
  ) : (
    <SectionPage home={home} open={home.open} />
  )
}
