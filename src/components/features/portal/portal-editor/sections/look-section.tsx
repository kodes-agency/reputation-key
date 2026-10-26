// Look: the photo, colours, and name and logo guests see on this portal. They
// start as the property's, which every portal shares and which is edited once, on
// the Property look page. Once the property has a second portal, an Account Admin
// can give this portal its own photo, colours, or name and logo (each group on its
// own, so the rest keeps following the property). Anyone else sees what the portal
// takes from the property and what it owns, and a property with one portal sees
// only the property's look, as before.
import { lazy, Suspense } from 'react'
import { Skeleton } from '#/components/ui/skeleton'
import { PROPERTY_LOOK_SOURCES } from '#/contexts/portal/application/public-api'
import { usePortalEditAccess } from '../../portal-detail/use-portal-edit-access'
import { PortalLookFacts } from '../../portal-look/portal-look-facts'
import { PropertyLookLink } from '../../portal-look/portal-look-property-link'
import {
  lookFactsNoteOf,
  lookIntroOf,
  portalLookSurfaceOf,
  SUMMARY_DESCRIPTION,
} from '../../portal-look/portal-look-surface'
import { PortalLookSummary } from '../../portal-look/portal-look-summary'
import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import type { PortalEditorSectionProps } from '../portal-editor-types'

// The editor is a chunk of its own, fetched when it is shown: only an Account Admin
// on a property with a second portal ever sees it, and it carries the colour
// controls, the focus picker and the autosave of three groups.
const PortalLookEditor = lazy(() =>
  import('../../portal-look/portal-look-editor').then((module) => ({
    default: module.PortalLookEditor,
  })),
)

export function LookSection({ resources, canEdit }: PortalEditorSectionProps) {
  const { portal, propertyId, portalExperience, portalLookActions } = resources
  const { readOnlyReason } = usePortalEditAccess(portal.publicationState)
  const profile = portalExperience?.profile ?? null
  const sources = portalExperience?.portalLook?.sources ?? PROPERTY_LOOK_SOURCES
  const canManage = canEdit && portalExperience?.canManagePropertyBrand === true
  const enabled =
    portalExperience?.portalLookEnabled === true && portalLookActions !== undefined
  const surface =
    profile === null
      ? 'summary'
      : portalLookSurfaceOf({
          enabled,
          canChange: canManage,
          siblingPortalCount: portalExperience?.siblingPortalCount ?? 0,
          sources,
        })

  if (surface === 'editor' && portalExperience && profile && portalLookActions) {
    const intro = lookIntroOf(portal.name, sources)
    return (
      <PortalEditorSectionFrame
        section="look"
        description={
          <>
            {intro.before}
            <PropertyLookLink propertyId={propertyId} />
            {intro.after}
          </>
        }
      >
        <Suspense fallback={<EditorLoading />}>
          <PortalLookEditor
            portal={portal}
            propertyId={propertyId}
            experience={portalExperience}
            profile={profile}
            actions={portalLookActions}
          />
        </Suspense>
      </PortalEditorSectionFrame>
    )
  }
  return (
    <PortalEditorSectionFrame section="look" description={SUMMARY_DESCRIPTION}>
      {surface === 'facts' ? (
        <PortalLookFacts
          propertyId={propertyId}
          sources={sources}
          note={lookFactsNoteOf({ enabled, readOnlyReason })}
        />
      ) : (
        <PortalLookSummary
          propertyId={propertyId}
          profile={profile}
          canManage={canManage}
        />
      )}
    </PortalEditorSectionFrame>
  )
}

function EditorLoading() {
  return (
    <div aria-busy="true" className="space-y-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
      <span className="sr-only">Loading the look…</span>
    </div>
  )
}
