// Colours (a portal's own look, group two): the accent and the background tint,
// kept together because their contrast is checked as a pair. The portal follows
// the property's, or has a pair of its own: "Set colours for this portal" starts
// from the property's values, so nothing a guest sees moves until they are
// edited, and the edits autosave to the draft once they can be read.
import type {
  PortalLookColoursInput,
  PortalLookColoursView,
} from '#/contexts/portal/application/public-api'
import {
  PropertyLookColoursFields,
  type ColoursDraft,
} from '../property-look/property-look-colours-section'
import { PortalLookBlock } from './portal-look-block'
import { usePortalLookPreviewPatch } from './portal-look-preview-context'
import { coloursPatchOf } from './portal-look-preview-patch'
import { PortalLookGroupSetting } from './portal-look-group-setting'
import {
  coloursDraftOf,
  coloursFollowedValue,
  type FollowedColours,
} from './portal-look-rules'
import { saveColoursDraft } from './portal-look-save'
import type { PortalLookActions, PortalLookTarget } from './portal-look-types'
import { usePortalLookDraft } from './use-portal-look-draft'

const COLOURS_KEY = 'portal-look-colours'

type Props = Readonly<{
  target: PortalLookTarget
  view: PortalLookColoursView
  /** The property's colours, which the portal follows until it has its own. */
  propertyColours: FollowedColours
  save: PortalLookActions['saveColours']
}>

export function PortalLookColoursBlock({ target, view, propertyColours, save }: Props) {
  const send = (colours: PortalLookColoursInput['colours']) =>
    save({ data: { ...target, colours } })
  return (
    <PortalLookBlock title="Colours" hint="Checked for readability on every page.">
      <PortalLookGroupSetting
        propertyId={target.propertyId}
        value={coloursFollowedValue(propertyColours)}
        isOwn={view.mode === 'own'}
        inheritLabel="Use the property’s colours"
        overrideLabel="Set colours for this portal"
        onSwitch={(mode) => send({ mode })}
      />
      {view.mode === 'own' ? (
        <OwnColours target={target} view={view} save={save} />
      ) : null}
    </PortalLookBlock>
  )
}

/** Mounted while the portal owns its colours, so the draft starts from what it owns each time. */
function OwnColours({
  target,
  view,
  save,
}: Readonly<{
  target: PortalLookTarget
  view: Extract<PortalLookColoursView, { mode: 'own' }>
  save: PortalLookActions['saveColours']
}>) {
  const { draft, edit } = usePortalLookDraft<ColoursDraft>(
    COLOURS_KEY,
    coloursDraftOf(view),
    saveColoursDraft(target, save),
  )
  // The phone follows the colours as they are picked, not once they are saved.
  const showInPreview = usePortalLookPreviewPatch('colours')
  const change = (patch: Partial<ColoursDraft>) => {
    const next = { ...draft, ...patch }
    showInPreview(coloursPatchOf(next))
    edit(next)
  }
  return (
    <div className="space-y-3">
      <PropertyLookColoursFields
        draft={draft}
        onChange={change}
        disabled={false}
        idPrefix="portal-look"
      />
    </div>
  )
}
