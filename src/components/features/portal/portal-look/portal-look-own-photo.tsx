// The portal's own photograph in the Photo group: the picture with the circle that
// says what every page keeps in view (moved here, autosaved), Replace and Remove,
// and a word on the description. A photo that was taken down is not shown: the
// portal then has no photo, and this says so and offers another.
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import type { PropertyLookHero } from '#/contexts/portal/application/public-api'
import { FocalPointPicker } from '../property-look/focal-point-picker'
import type { FocalPoint } from '../property-look/focal-point'
import { PropertyLookMediaActions } from '../property-look/property-look-media-actions'

type Props = Readonly<{
  /** Null when the photo was taken down. */
  hero: PropertyLookHero | null
  portalName: string
  focal: FocalPoint
  onFocalChange: (focal: FocalPoint) => void
  /** The photo's description in the portal's primary language, for those who cannot see it. */
  description: string | undefined
  onReplace: () => void
  /** Takes the photo off; a refusal is thrown, so the confirmation stays open and says why. */
  onRemove: () => Promise<void>
}>

export function PortalLookOwnPhoto({
  hero,
  portalName,
  focal,
  onFocalChange,
  description,
  onReplace,
  onRemove,
}: Props) {
  if (hero === null) return <TakenDownPhoto onChoose={onReplace} />
  return (
    <div className="flex flex-wrap items-start gap-4">
      <FocalPointPicker
        src={hero.url}
        width={hero.width}
        height={hero.height}
        focal={focal}
        onChange={onFocalChange}
        alt={description ?? ''}
        maxHeightRem={7}
        maxWidthRem={10}
        className="shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <PropertyLookMediaActions
          replaceLabel="Replace photo"
          removeLabel="Remove photo"
          removal={{
            title: 'Remove the photo?',
            description: `${portalName} will have no photo, and its pages will use the colour field. You’ll need the file again to put it back.`,
            confirmLabel: 'Remove photo',
            cancelLabel: 'Keep photo',
            run: onRemove,
          }}
          onReplace={onReplace}
        />
        <p className="text-sm text-muted-foreground">
          Drag the circle onto what guests should always see. Every page crops around it.
        </p>
        <p className="text-sm text-muted-foreground">
          A description is optional. Without one, screen readers skip the photo.
        </p>
      </div>
    </div>
  )
}

function TakenDownPhoto({ onChoose }: Readonly<{ onChoose: () => void }>) {
  return (
    <div className="space-y-3">
      <Alert variant="warning">
        <AlertDescription>
          This portal’s photo was taken down. Choose another or use the property’s photo.
        </AlertDescription>
      </Alert>
      <Button type="button" variant="outline" onClick={onChoose}>
        Choose another photo
      </Button>
    </div>
  )
}
