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
// What is refused besides who may: a colour pair whose page text could not be
// read (judged on the pair as it will be drawn), and a wordmark over 24
// characters. The logo must be an uploaded logo of the Portal's Property.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { PortalLookChange } from '../../domain/portal-look'
import type { BackgroundMode } from '../../domain/property-look'
import type { PortalLookSaved } from '../dto/portal-look.dto'
import {
  loadPortalForOwnLook,
  savePortalLookChange,
  type PortalLookCommandDeps,
  type PortalLookTarget,
} from '../portal-look-command'

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

function coloursChangeOf(
  colours: SavePortalLookColoursInput['colours'],
): PortalLookChange {
  if (colours.mode === 'inherit') return { group: 'colours', mode: 'inherit' }
  return {
    group: 'colours',
    mode: 'own',
    ...(colours.accentColour === undefined
      ? {}
      : { accent: colours.accentColour.toUpperCase() }),
    ...(colours.backgroundMode === undefined
      ? {}
      : { backgroundMode: colours.backgroundMode }),
    ...(colours.backgroundColour === undefined
      ? {}
      : { backgroundColour: colours.backgroundColour.toUpperCase() }),
  }
}

function identityChangeOf(
  identity: SavePortalLookIdentityInput['identity'],
): PortalLookChange {
  if (identity.mode === 'inherit') return { group: 'identity', mode: 'inherit' }
  return {
    group: 'identity',
    mode: 'own',
    ...(identity.wordmark === undefined ? {} : { wordmark: identity.wordmark }),
    ...(identity.logoAssetId === undefined ? {} : { logoAssetId: identity.logoAssetId }),
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
  (deps: PortalLookCommandDeps) =>
  async (
    input: SavePortalLookIdentityInput,
    ctx: AuthContext,
  ): Promise<PortalLookSaved> => {
    const portal = await loadPortalForOwnLook(deps, ctx, input)
    return savePortalLookChange(deps, ctx, portal, identityChangeOf(input.identity))
  }
