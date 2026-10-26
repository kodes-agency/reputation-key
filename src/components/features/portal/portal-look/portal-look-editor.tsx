// A portal's own look, edited (the Look section of an Account Admin): the three
// groups, each following the property look until the portal is given its own.
// Everything saves to the portal's draft, which guests see once the portal is
// published; the property's own look is untouched and keeps reaching every group
// a portal follows.
import type { PortalLookView } from '#/contexts/portal/application/public-api'
import type { PortalEditorResources } from '../portal-editor/portal-editor-types'
import type { PortalExperienceSettings } from '../portal-settings/portal-experience-settings-types'
import { PortalLookColoursBlock } from './portal-look-colours-block'
import { PortalLookIdentityBlock } from './portal-look-identity-block'
import { PortalLookPhotoBlock } from './portal-look-photo-block'
import { FOLLOWS_THE_PROPERTY, offeredLocalesOf } from './portal-look-rules'
import type { PortalLookActions } from './portal-look-types'

type Props = Readonly<{
  portal: PortalEditorResources['portal']
  propertyId: string
  /** The settings read, whose property profile is known: without one there is no look to edit. */
  experience: PortalExperienceSettings
  profile: NonNullable<PortalExperienceSettings['profile']>
  actions: PortalLookActions
}>

export function PortalLookEditor({
  portal,
  propertyId,
  experience,
  profile,
  actions,
}: Props) {
  const target = { propertyId, portalId: portal.id }
  const view: PortalLookView = experience.portalLook ?? FOLLOWS_THE_PROPERTY
  const media = experience.media ?? { hero: null, logo: null }
  return (
    <div>
      <PortalLookPhotoBlock
        target={target}
        portalName={portal.name}
        propertyName={profile.displayName}
        locales={offeredLocalesOf(portal)}
        view={view.photo}
        propertyHero={media.hero}
        actions={actions}
      />
      <PortalLookColoursBlock
        target={target}
        view={view.colours}
        propertyColours={profile}
        save={actions.saveColours}
      />
      <PortalLookIdentityBlock
        target={target}
        portalName={portal.name}
        view={view.identity}
        property={{
          displayName: profile.displayName,
          wordmark: profile.wordmark,
          logo: media.logo,
        }}
        actions={actions}
      />
    </div>
  )
}
