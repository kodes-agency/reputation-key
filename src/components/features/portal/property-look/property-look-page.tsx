// The Property look (docs/design/portal-experience/round-4-admin, board 9): the
// photo, colours, name and logo, and default languages shared by every portal of
// a Property, beside a preview of the page with and without a photo.
//
// Presentational: the route owns the reads and the two writes. Edits autosave to
// the draft through the portal editor's coordinator, with its leave guard
// mounted here: a reload or a tab close with a write waiting or in flight asks
// first, and an in-app navigation writes what is waiting, then asks only if a
// save failed or was refused. Guests see the look only when each live portal
// is published again.
// The photograph and logo are written when the person puts one on or takes one
// off (the dialogs), and the photograph's focal point autosaves as it is moved.
// The batch "Review & publish" sits in the status bar: it reads each live
// portal's review and publishes the ones that are ready, in turn.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { EmptyState } from '#/components/ui/empty-state'
import { Palette } from 'lucide-react'
import type { PropertyLookMedia } from '#/contexts/portal/application/public-api'
import type { PortalImageUploader } from '../portal-media/upload-portal-image'
import type { PortalPreviewReader } from '../portal-preview/portal-preview-pane'
import { PortalUnsavedChangesPrompt } from '../portal-detail/portal-unsaved-changes-prompt'
import { PortalDraftAutosaveProvider } from '../portal-editor/portal-draft-autosave-context'
import { PropertyLookBatchPublish } from './property-look-batch-publish'
import { PropertyLookColoursSection } from './property-look-colours-section'
import { PropertyLookIdentitySection } from './property-look-identity-section'
import { PropertyLookLanguagesSection } from './property-look-languages-section'
import { PropertyLookPhotoSection } from './property-look-photo-section'
import { PropertyLookPortals } from './property-look-portals'
import { PropertyLookPreview } from './property-look-preview'
import type { PhotoDescriptions } from './property-photo-rules'
import {
  affectedPortals,
  describeLookStatus,
  type AffectedPortalRow,
} from './property-look-rules'
import { PropertyLookStatusBar } from './property-look-status-bar'
import type { PropertyLookProfile } from './property-look-types'
import type { PortalReviewReader, PublishPortalsAction } from './use-property-look-batch'
import {
  PROPERTY_LOOK_AUTOSAVE_DELAY_MS,
  usePropertyLookDraft,
  type PropertyLookSaves,
} from './use-property-look-draft'
import { usePropertyLookMediaControls } from './use-property-look-media-controls'
import type { PropertyLookMediaSaves } from './use-property-look-media'
import { usePropertyLookPreview } from './use-property-look-preview'

export type PropertyLookPageProps = PropertyLookSaves &
  PropertyLookMediaSaves &
  Readonly<{
    propertyId: string
    propertyName: string
    /** Null while the Property has no public display name (nothing to look at yet). */
    profile: PropertyLookProfile | null
    /** An Account Admin, with Portals writes switched on. */
    canEdit: boolean
    /** Every portal of the Property. */
    rows: readonly AffectedPortalRow[]
    getPortalPreview: PortalPreviewReader
    /** The photograph and logo the Property has, as a page draws them. */
    media: PropertyLookMedia
    /** What the Property has written to describe the photograph, by language. */
    photoDescriptions: PhotoDescriptions
    /** Sends an image to the media endpoint; the real upload unless a story hands in a stub. */
    uploadImage?: PortalImageUploader
    /** What publishing would do to one portal, and whether anything stops it. */
    getPortalReview: PortalReviewReader
    /** Publishes the named live portals in turn and reports each (`publishPortalsChanges`). */
    publishPortals: PublishPortalsAction
    /** The viewer holds `portal.update` and Portals writes are switched on. */
    canPublish: boolean
  }>

const SIDE_COLUMN = 'min-w-0 min-[90rem]:sticky min-[90rem]:top-6 min-[90rem]:self-start'

/** While an edit is waiting, being saved or refused, what a review would read is not settled. */
const SETTLING: ReadonlySet<string> = new Set(['pending', 'saving', 'invalid', 'error'])

const LEAVE_COPY =
  'Some changes to the look have not been saved. If you go on, they are discarded.'

const breadcrumbsOf = (propertyId: string, propertyName: string) => [
  { label: 'Properties', to: '/properties' },
  { label: propertyName, to: `/properties/${propertyId}` },
  { label: 'Portals', to: `/properties/${propertyId}/portals` },
  { label: 'Property look' },
]

export function PropertyLookPage(props: PropertyLookPageProps) {
  const { propertyId, propertyName, profile } = props
  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Property look"
        description={`How every portal at ${propertyName} looks. Portal wording and links stay per portal.`}
        breadcrumbs={breadcrumbsOf(propertyId, propertyName)}
      />
      {profile === null ? (
        <EmptyState
          icon={Palette}
          title="Set the public display name first"
          description={
            <>
              The look is the Property's public display name dressed in its colours.{' '}
              <Link
                to="/properties/$propertyId/settings/profile"
                params={{ propertyId }}
                className="font-medium text-link underline-offset-4 hover:underline"
              >
                Set it in Property settings
              </Link>
            </>
          }
        />
      ) : (
        <PortalDraftAutosaveProvider delayMs={PROPERTY_LOOK_AUTOSAVE_DELAY_MS}>
          <PropertyLookEditor {...props} profile={profile} />
        </PortalDraftAutosaveProvider>
      )}
    </PageShell>
  )
}

function useSelectedPortal(affected: ReturnType<typeof affectedPortals>) {
  const [chosenId, setChosenId] = useState<string | null>(null)
  const selected =
    affected.listed.find((row) => row.portalId === chosenId) ?? affected.listed[0] ?? null
  const previewPortal = selected ? { id: selected.portalId, name: selected.name } : null
  return { selectedId: selected?.portalId ?? null, previewPortal, setChosenId }
}

function PropertyLookEditor({
  propertyId,
  propertyName,
  profile,
  canEdit,
  rows,
  getPortalPreview,
  getPortalReview,
  publishPortals,
  canPublish,
  saveLook,
  saveLocales,
  saveHero,
  saveLogo,
  media: savedMedia,
  photoDescriptions,
  uploadImage,
}: PropertyLookPageProps & Readonly<{ profile: PropertyLookProfile }>) {
  const { draft, setDraft, locales, setLocales, problem, state, retry } =
    usePropertyLookDraft(propertyId, profile, { saveLook, saveLocales })
  const affected = affectedPortals(rows)
  const [showPhoto, setShowPhoto] = useState(true)
  const { selectedId, previewPortal, setChosenId } = useSelectedPortal(affected)
  const previewData = usePropertyLookPreview(previewPortal, getPortalPreview)
  const { media, photo, logo } = usePropertyLookMediaControls({
    propertyId,
    propertyName,
    canEdit,
    savedMedia,
    saves: { saveHero, saveLogo },
    descriptions: photoDescriptions,
    locales,
    uploadImage,
    preview: { portal: previewPortal, data: previewData, draft },
  })
  const status = describeLookStatus(
    { status: state.status, ...(problem === null ? {} : { reason: problem }) },
    affected,
  )

  // Board 09's three columns (form, phone, portals) from 90rem, where each of
  // the two side columns is shorter than the screen and so can stay in view.
  // Below it the phone and the portal list stack in one column and scroll with
  // the page: stacked they are taller than a screen, and a sticky box that is
  // taller than the screen hides its own bottom.
  return (
    <>
      <PortalUnsavedChangesPrompt description={LEAVE_COPY} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] min-[90rem]:grid-cols-[minmax(0,1fr)_21rem_15rem]">
        <div className="min-w-0 space-y-4 lg:row-span-2 min-[90rem]:row-span-1">
          {canEdit ? null : (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              An Account Admin manages the look shared by every portal of this Property.
            </p>
          )}
          <div>
            <PropertyLookPhotoSection
              onPreviewWithoutPhoto={() => setShowPhoto(false)}
              photo={photo}
            />
            <PropertyLookColoursSection
              draft={draft}
              onChange={setDraft}
              disabled={!canEdit}
            />
            <PropertyLookIdentitySection
              propertyId={propertyId}
              displayName={profile.displayName}
              wordmark={draft.wordmark}
              onWordmarkChange={(wordmark) => setDraft({ wordmark })}
              disabled={!canEdit}
              logo={logo}
            />
            <PropertyLookLanguagesSection
              locales={locales}
              onChange={setLocales}
              disabled={!canEdit}
            />
          </div>
          <PropertyLookStatusBar
            status={status}
            onRetry={() => void retry()}
            action={
              <PropertyLookBatchPublish
                propertyId={propertyId}
                live={affected.live}
                canPublish={canPublish}
                isSettling={SETTLING.has(state.status)}
                getPortalReview={getPortalReview}
                publishPortals={publishPortals}
              />
            }
          />
        </div>
        <aside className={SIDE_COLUMN}>
          <PropertyLookPreview
            portal={previewPortal}
            data={previewData}
            draft={draft}
            media={media}
            showPhoto={showPhoto}
            onShowPhotoChange={setShowPhoto}
          />
        </aside>
        <aside className={SIDE_COLUMN}>
          <PropertyLookPortals
            affected={affected}
            selectedId={selectedId}
            onSelect={setChosenId}
          />
        </aside>
      </div>
    </>
  )
}
