// Portal context — save the Property look: the accent colour, the background
// and the wordmark guests see on every page of the Property. The public display
// name stays with Property settings, the images with the upload path, and the
// languages with `savePropertyDefaultGuestLocales`; this writes none of them,
// and it does not count as a person confirming the display name.
//
// The write is the Brand Profile's look writer, which reads and writes inside
// the Property's publication lock, so the profile's `look_version` bump and the
// pending changes for the live Portals are the ones every look edit already
// gets, and nothing a name or image write does beside it is put back.
//
// What is refused: a colour that is not `#rrggbb`, and a manual background
// light text cannot be read on (the rules a Portal's own colours share, in
// look-colour-rules.ts). An accent that is hard to see on its field is not.

import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext } from '#/shared/domain/permissions'
import { propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { LookBackgroundMode } from '#/shared/domain/portal-look-readout'
import { portalError } from '../../domain/errors'
import { normaliseWordmark } from '../../domain/property-look'
import { assertPropertyAccess } from '../assert-property-access'
import { checkedColours } from '../look-colour-rules'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'

type Deps = Readonly<{
  experienceRepo: Pick<PortalExperienceRepository, 'savePropertyLook'>
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

export type SavePropertyLookInput = Readonly<{
  propertyId: string
  accentColour: string
  backgroundMode: LookBackgroundMode
  /** Read only when the background is manual. */
  backgroundColour?: string
  /** Left as it is when omitted; null (or only spaces) clears it. */
  wordmark?: string | null
}>

export const savePropertyLook =
  (deps: Deps) => async (input: SavePropertyLookInput, ctx: AuthContext) => {
    if (!canForContext(ctx, 'portal.admin')) {
      throw portalError(
        'forbidden',
        'Only an Account Admin can change Property-wide Portal branding',
      )
    }
    const pid = propertyId(input.propertyId)
    await assertPropertyAccess(deps.staffPublicApi, ctx, 'portal.update', pid)
    const wordmark =
      input.wordmark === undefined ? undefined : normaliseWordmark(input.wordmark)
    const { accent, background } = checkedColours(input)
    const saved = await deps.experienceRepo.savePropertyLook({
      organizationId: ctx.organizationId,
      propertyId: pid,
      look: {
        primaryColor: accent,
        backgroundMode: input.backgroundMode,
        ...(background === undefined ? {} : { backgroundColor: background }),
        ...(wordmark === undefined ? {} : { wordmark }),
      },
      actorUserId: ctx.userId,
      at: deps.clock(),
    })
    if (!saved) {
      throw portalError(
        'brand_profile_missing',
        'Set the public display name before changing the look',
      )
    }
    return saved
  }
