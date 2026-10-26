// Portal context — give one Portal its own colours, or its own name and logo,
// or put either back to the Property's (ADR 0070).
//
// Only an Account Admin may, as for the Property look itself, and only while
// PORTAL_OWN_LOOK_ENABLED is on. A value left out keeps the Portal's own, or is
// the Property's when the group becomes the Portal's, so "Set colours for this
// portal" copies what guests already see and moves nothing. The write decides
// what guests would see differently and records only that, as a page edit of
// this Portal alone: the change waits for this Portal's own publish.
//
// What is refused besides who may: a colour that is not `#rrggbb` and a pair
// whose page text could not be read (the Property look's own rules, judged on
// the pair as it will be drawn), a wordmark over 24 characters, and a logo that
// is not an uploaded logo of the Portal's Property.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalLookChange } from '../../domain/portal-look'
import { normaliseWordmark, type BackgroundMode } from '../../domain/property-look'
import type { Portal } from '../../domain/types'
import type { PortalLookSaved } from '../dto/portal-look.dto'
import { checkedBackgroundMode, checkedLookColour } from '../look-colour-rules'
import { checkedAsset } from '../look-media-rules'
import {
  loadPortalForOwnLook,
  savePortalLookChange,
  type PortalLookCommandDeps,
  type PortalLookTarget,
} from '../portal-look-command'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'

type IdentityDeps = PortalLookCommandDeps &
  Readonly<{
    /** Where the logo's purpose, Property and state are read from. */
    mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>
  }>

export type SavePortalLookColoursInput = PortalLookTarget &
  Readonly<{
    colours:
      | Readonly<{ mode: 'inherit' }>
      | Readonly<{
          mode: 'own'
          accentColour?: string
          backgroundMode?: BackgroundMode
          /** Kept in automatic mode too, as the Property's is. */
          backgroundColour?: string
        }>
  }>

export type SavePortalLookIdentityInput = PortalLookTarget &
  Readonly<{
    identity:
      | Readonly<{ mode: 'inherit' }>
      | Readonly<{
          mode: 'own'
          /** Null (or only spaces) shows the public display name. */
          wordmark?: string | null
          /** An uploaded logo of the Property; null shows no logo. */
          logoAssetId?: string | null
        }>
  }>

/** The values given, each checked as the Property look checks it; the pair is judged once merged. */
function coloursChangeOf(
  colours: SavePortalLookColoursInput['colours'],
): PortalLookChange {
  if (colours.mode === 'inherit') return { group: 'colours', mode: 'inherit' }
  const { accentColour, backgroundMode, backgroundColour } = colours
  return {
    group: 'colours',
    mode: 'own',
    ...(accentColour === undefined
      ? {}
      : { accent: checkedLookColour(accentColour, 'accent') }),
    ...(backgroundMode === undefined
      ? {}
      : { backgroundMode: checkedBackgroundMode(backgroundMode) }),
    ...(backgroundColour === undefined
      ? {}
      : { backgroundColour: checkedLookColour(backgroundColour, 'background') }),
  }
}

/** The logo must be an uploaded logo of the Portal's own Property. */
async function identityChangeOf(
  deps: Pick<IdentityDeps, 'mediaRepo'>,
  ctx: AuthContext,
  portal: Portal,
  identity: SavePortalLookIdentityInput['identity'],
): Promise<PortalLookChange> {
  if (identity.mode === 'inherit') return { group: 'identity', mode: 'inherit' }
  const { wordmark, logoAssetId } = identity
  const logo =
    logoAssetId === undefined || logoAssetId === null
      ? logoAssetId
      : await checkedAsset(
          deps.mediaRepo,
          ctx.organizationId,
          portal.propertyId,
          'brand_logo',
          logoAssetId,
        )
  return {
    group: 'identity',
    mode: 'own',
    ...(wordmark === undefined ? {} : { wordmark: normaliseWordmark(wordmark) }),
    ...(logo === undefined ? {} : { logoAssetId: logo }),
  }
}

export const savePortalLookColours =
  (deps: PortalLookCommandDeps) =>
  async (
    input: SavePortalLookColoursInput,
    ctx: AuthContext,
  ): Promise<PortalLookSaved> => {
    const portal = await loadPortalForOwnLook(deps, ctx, input)
    return savePortalLookChange(deps, ctx, portal, coloursChangeOf(input.colours))
  }

export const savePortalLookIdentity =
  (deps: IdentityDeps) =>
  async (
    input: SavePortalLookIdentityInput,
    ctx: AuthContext,
  ): Promise<PortalLookSaved> => {
    const portal = await loadPortalForOwnLook(deps, ctx, input)
    const change = await identityChangeOf(deps, ctx, portal, input.identity)
    return savePortalLookChange(deps, ctx, portal, change)
  }
