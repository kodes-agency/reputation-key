// Name and logo (a portal's own look, group three): the wordmark and the logo at
// the top of the page. The business name itself is the property's and changes in
// its settings (AI reply drafts read it), so it is a fact here. The portal follows
// the property's wordmark and logo, or has its own: "Set name and logo for this
// portal" starts from the property's, and a wordmark left empty shows the name.
import { FieldOptional } from '#/components/ui/field'
import { InlineLink } from '#/components/ui/inline-link'
import type {
  PortalLookIdentityInput,
  PortalLookIdentityView,
  PropertyLookLogo,
} from '#/contexts/portal/application/public-api'
import { PropertyLookLogoField } from '../property-look/property-look-logo-field'
import { PropertyLookWordmarkField } from '../property-look/property-look-wordmark-field'
import { PortalLookBlock } from './portal-look-block'
import { usePortalLookPreviewPatch } from './portal-look-preview-context'
import { wordmarkPatchOf } from './portal-look-preview-patch'
import { PortalLookGroupSetting } from './portal-look-group-setting'
import { identityFollowedValue, logoInputOf } from './portal-look-rules'
import { saveWordmarkDraft } from './portal-look-save'
import type { PortalLookActions, PortalLookTarget } from './portal-look-types'
import { usePortalLookDraft, usePortalLookSwitch } from './use-portal-look-draft'

const WORDMARK_KEY = 'portal-look-wordmark'

type Property = Readonly<{
  /** The public display name: what guests see by default, and who owns the image. */
  displayName: string
  wordmark: string | null | undefined
  logo: PropertyLookLogo | null
}>

type Props = Readonly<{
  target: PortalLookTarget
  portalName: string
  view: PortalLookIdentityView
  property: Property
  actions: Pick<PortalLookActions, 'saveIdentity' | 'uploadImage'>
}>

export function PortalLookIdentityBlock({
  target,
  portalName,
  view,
  property,
  actions,
}: Props) {
  const send = (identity: PortalLookIdentityInput['identity']) =>
    actions.saveIdentity({ data: { ...target, identity } })
  return (
    <PortalLookBlock
      title="Name and logo"
      hint="Guests see it at the top of this portal’s page."
    >
      <p className="text-sm text-muted-foreground">
        Guests see the business name {property.displayName}, set in{' '}
        <InlineLink
          to="/properties/$propertyId/settings/profile"
          params={{ propertyId: target.propertyId }}
          underline="always"
        >
          Settings
        </InlineLink>
        .
      </p>
      <PortalLookGroupSetting
        propertyId={target.propertyId}
        value={identityFollowedValue(property.wordmark, property.logo !== null)}
        isOwn={view.mode === 'own'}
        inheritLabel="Use the property’s name and logo"
        overrideLabel="Set name and logo for this portal"
        onSwitch={(mode) => send({ mode })}
      />
      {view.mode === 'own' ? (
        <OwnIdentity
          target={target}
          portalName={portalName}
          view={view}
          property={property}
          actions={actions}
        />
      ) : null}
    </PortalLookBlock>
  )
}

/** Mounted while the portal owns its name and logo, so the wordmark starts from what it owns each time. */
function OwnIdentity({
  target,
  portalName,
  view,
  property,
  actions,
}: Props & Readonly<{ view: Extract<PortalLookIdentityView, { mode: 'own' }> }>) {
  const { write } = usePortalLookSwitch()
  const wordmark = usePortalLookDraft(
    WORDMARK_KEY,
    view.wordmark ?? '',
    saveWordmarkDraft(target, actions.saveIdentity),
  )
  // The phone follows the wordmark as it is typed, not once it is saved.
  const showInPreview = usePortalLookPreviewPatch('wordmark')
  const typeWordmark = (text: string) => {
    showInPreview(wordmarkPatchOf(text))
    wordmark.edit(text)
  }
  const upload = actions.uploadImage ? { upload: actions.uploadImage } : {}
  return (
    <div className="space-y-4">
      <PropertyLookWordmarkField
        id="portal-look-wordmark"
        value={wordmark.draft}
        onChange={typeWordmark}
        disabled={false}
        hint="Top left of this portal’s page, until you add a logo. Left empty, guests see the business name."
      />
      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          Logo
          <FieldOptional />
        </p>
        <PropertyLookLogoField
          logo={{
            propertyId: target.propertyId,
            propertyName: property.displayName,
            logo: view.logo,
            canEdit: true,
            onSave: async (assetId) => {
              await write(() =>
                actions.saveIdentity({ data: logoInputOf(target, assetId) }),
              )
            },
            copy: {
              replaces: `It replaces the wordmark on ${portalName} only.`,
              dialogDescription: `Replaces the wordmark at the top of ${portalName} only.`,
              footerNote: 'Live pages change when you publish this portal.',
            },
            ...upload,
          }}
        />
      </div>
    </div>
  )
}
