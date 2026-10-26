// Photo (a portal's own look, group one): the portal follows the property's
// photograph, has one of its own, or shows none. A photo of its own is chosen in
// the photograph dialog (the file, its focus point, a description for each of the
// portal's languages, the permission to use it) and its focus point autosaves as
// the circle is moved. Taking it off leaves the portal with no photo: the colour
// field, not the property's photograph.
import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { InheritedSetting } from '#/components/forms/inherited-setting'
import { Button } from '#/components/ui/button'
import type {
  PortalLookPhotoInput,
  PortalLookPhotoView,
  PropertyLookHero,
} from '#/contexts/portal/application/public-api'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalImageUploader } from '../portal-media/upload-portal-image'
import { CENTRE_FOCAL, type FocalPoint } from '../property-look/focal-point'
import { LazyPropertyLookPhotoDialog } from '../property-look/property-look-lazy-dialogs'
import { PortalLookBlock } from './portal-look-block'
import { usePortalLookPreviewPatch } from './portal-look-preview-context'
import { focalPatchOf } from './portal-look-preview-patch'
import { PortalLookOwnPhoto } from './portal-look-own-photo'
import { PropertyLookLink } from './portal-look-property-link'
import { descriptionsOf, photoInputOf } from './portal-look-rules'
import { saveFocalDraft } from './portal-look-save'
import type { PortalLookActions, PortalLookTarget } from './portal-look-types'
import { usePortalLookDraft, usePortalLookSwitch } from './use-portal-look-draft'

const FOCAL_KEY = 'portal-photo-focal'

type Props = Readonly<{
  target: PortalLookTarget
  portalName: string
  /** The name the permission sentence gives: "Avela Resort owns this photo …". */
  propertyName: string
  locales: readonly OfferedGuestLocale[]
  view: PortalLookPhotoView
  /** The property's photograph, which the portal follows until it has its own. */
  propertyHero: PropertyLookHero | null
  actions: Pick<PortalLookActions, 'savePhoto' | 'uploadImage'>
}>

const focalOf = (view: PortalLookPhotoView): FocalPoint =>
  view.mode === 'own' && view.hero
    ? { x: view.hero.focalX, y: view.hero.focalY }
    : CENTRE_FOCAL

export function PortalLookPhotoBlock({
  target,
  portalName,
  propertyName,
  locales,
  view,
  propertyHero,
  actions,
}: Props) {
  const { isPending, run, write } = usePortalLookSwitch()
  const [isOpen, setIsOpen] = useState(false)
  const { savePhoto } = actions
  const send = (photo: PortalLookPhotoInput['photo']) =>
    savePhoto({ data: { ...target, photo } })
  const focal = usePortalLookDraft(
    FOCAL_KEY,
    focalOf(view),
    saveFocalDraft(target, savePhoto),
  )
  // The phone follows the circle as it is moved, not once the point is saved.
  const showInPreview = usePortalLookPreviewPatch('focal')
  const moveFocal = (point: FocalPoint) => {
    showInPreview(focalPatchOf(point))
    focal.edit(point)
  }
  /**
   * A different photo, none or the property's: the circle's edit was about the
   * photo that is gone, so the phone is shown what the draft now says.
   */
  const switchTo = (photo: PortalLookPhotoInput['photo']) =>
    void run(() => send(photo)).then((isDone) => {
      if (isDone) showInPreview(null)
    })
  const hero = view.mode === 'own' ? view.hero : null
  const descriptions = view.mode === 'own' ? descriptionsOf(view.altTexts) : {}
  const upload: { upload?: PortalImageUploader } = actions.uploadImage
    ? { upload: actions.uploadImage }
    : {}

  return (
    <PortalLookBlock
      isFirst
      title="Photo"
      hint="Fills the top of this portal’s page and tints its colour field."
    >
      <div className="flex flex-wrap items-start gap-3">
        {view.mode === 'inherit' && propertyHero ? (
          <FollowedPhoto hero={propertyHero} />
        ) : null}
        <InheritedSetting
          className="min-w-0 flex-1"
          source={<PropertyLookLink propertyId={target.propertyId} />}
          overridden={view.mode !== 'inherit'}
          commit="immediate"
          pending={isPending}
          inheritLabel="Use the property’s photo"
          overrideLabel="Use a different photo here"
          onInherit={() => switchTo({ mode: 'inherit' })}
          onOverride={() => setIsOpen(true)}
          note={view.mode === 'inherit' ? followedNote(propertyHero) : undefined}
        >
          <PhotoShortcut
            mode={view.mode}
            onNone={() => switchTo({ mode: 'none' })}
            onAdd={() => setIsOpen(true)}
          />
        </InheritedSetting>
      </div>
      {view.mode === 'none' ? <NoPhotoNote /> : null}
      {view.mode === 'own' ? (
        <PortalLookOwnPhoto
          hero={hero}
          portalName={portalName}
          focal={focal.draft}
          onFocalChange={moveFocal}
          description={descriptions[locales[0] ?? 'en']}
          onReplace={() => setIsOpen(true)}
          onRemove={async () => {
            await write(() => send({ mode: 'none' }))
            showInPreview(null)
          }}
        />
      ) : null}
      <LazyPropertyLookPhotoDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        propertyId={target.propertyId}
        propertyName={propertyName}
        hero={hero}
        locales={locales}
        saved={descriptions}
        description={`Shown at the top of ${portalName} only.`}
        footerNote="Live pages change when you publish this portal."
        onSave={async (written) => {
          await write(() => savePhoto({ data: photoInputOf(target, written) }))
          showInPreview(null)
          focal.land(
            written.focalX === undefined || written.focalY === undefined
              ? focal.draft
              : { x: written.focalX, y: written.focalY },
          )
        }}
        {...upload}
      />
    </PortalLookBlock>
  )
}

const followedNote = (hero: PropertyLookHero | null): string =>
  hero ? 'The property’s photo.' : 'The property has no photo.'

/** The other way this row can go, beside the toggle: no photo at all, or a photo after one was taken off. */
function PhotoShortcut({
  mode,
  onNone,
  onAdd,
}: Readonly<{
  mode: PortalLookPhotoView['mode']
  onNone: () => void
  onAdd: () => void
}>) {
  if (mode === 'own') return null
  const isFollowing = mode === 'inherit'
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={isFollowing ? onNone : onAdd}
    >
      {isFollowing ? 'No photo on this portal' : 'Add a photo'}
    </Button>
  )
}

function NoPhotoNote() {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
      <ImageOff className="size-4 shrink-0" aria-hidden />
      No photo on this portal. Its pages use the colour field.
    </p>
  )
}

/** The property's photograph at the size of a row: what the portal shows until it has its own. */
function FollowedPhoto({ hero }: Readonly<{ hero: PropertyLookHero }>) {
  return (
    <img
      src={hero.url}
      alt=""
      width={48}
      height={48}
      className="size-12 shrink-0 rounded-md border object-cover"
      style={{ objectPosition: `${hero.focalX * 100}% ${hero.focalY * 100}%` }}
    />
  )
}
