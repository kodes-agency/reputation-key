// One language of the Welcome section. The portal's own welcome line and link
// preview come first, as they save as they are typed; empty, they use the
// property's wording, shown as their placeholders. The property's wording
// (every portal of the property starts from it, an account admin writes it and
// it keeps an explicit Save) folds away below.
//
// A language only has wording when the property wrote some for it: publishing
// reads the property's wording as the base, so without it this portal's own
// lines do not count yet (and in the primary language the portal cannot be
// published). Then the order turns round: the warning, the property's wording
// (open) right under it, where "write it below" points, and this portal's own
// lines after, with one line saying they count once that wording is saved. The
// two pairs carry different labels ("This portal's welcome line", "Welcome line
// for every portal"), so neither can be typed into for the other.
//
// The fold keeps its form mounted while closed (hidden, not removed): an
// unsaved edit to the property's wording must survive closing it, and so must
// the guard that asks before leaving with one.

import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { cn } from '#/lib/utils'
import { hasPropertyWording } from '#/contexts/portal/application/public-api'
import { adminLanguageCode, type OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { languageDisplayName } from '../portal-languages/portal-languages-rules'
import { PortalLocalizedOverrideForm } from './portal-localized-override-form'
import { PortalPropertyContentForm } from './portal-property-content-form'
import { portalPropertyContentDraftKey } from '../portal-editor/portal-draft-keys'
import type {
  PortalExperienceActions,
  PortalExperienceSettings,
} from './portal-experience-settings-types'

type Lines = Readonly<{ title: string; shortDescription: string }>

/** The property's wording and this portal's own lines in one language, as the forms start. */
function linesIn(experience: PortalExperienceSettings, locale: OfferedGuestLocale) {
  const baseline = experience.content.find((item) => item.locale === locale)
  const override = experience.overrides.find((item) => item.locale === locale)
  const property: Lines = {
    title: baseline?.title ?? '',
    shortDescription: baseline?.shortDescription ?? '',
  }
  const own: Lines = {
    title: override?.title ?? '',
    shortDescription: override?.shortDescription ?? '',
  }
  return { property, own, hasWording: hasPropertyWording(baseline) }
}

export function PortalLocalizedContentEditor({
  locale,
  propertyId,
  portalId,
  experience,
  actions,
  disabled,
  isPrimary,
}: Readonly<{
  locale: OfferedGuestLocale
  propertyId: string
  portalId: string
  experience: PortalExperienceSettings
  actions: PortalExperienceActions
  disabled: boolean
  /** The portal's primary language: without wording in it, publishing is refused. */
  isPrimary: boolean
}>) {
  const { property, own, hasWording } = linesIn(experience, locale)
  const canWriteProperty = !disabled && experience.canManagePropertyBrand
  // The large name guests read; until the property has one, there is none to name.
  const propertyName = experience.profile?.displayName.trim() || null
  const headingId = `portal-wording-${locale}-heading`

  const ownLines = (
    <PortalLocalizedOverrideForm
      locale={locale}
      portalId={portalId}
      propertyName={propertyName}
      initialTitle={own.title}
      initialDescription={own.shortDescription}
      titlePlaceholder={property.title}
      descriptionPlaceholder={property.shortDescription}
      action={actions.saveOverride}
      readOnly={disabled}
    />
  )
  const propertyWording = (
    <PropertyWordingFold
      propertyName={propertyName}
      startsOpen={!hasWording}
      placement={hasWording ? 'below' : 'first'}
      canManagePropertyBrand={experience.canManagePropertyBrand}
    >
      {/* Keyed on the property wording only: it keeps an explicit Save, so
          it remounts on the saved values. The portal's own lines autosave as
          they are typed and must NOT remount when a save lands. */}
      <PortalPropertyContentForm
        key={portalPropertyContentDraftKey(experience, locale)}
        locale={locale}
        propertyId={propertyId}
        initialTitle={property.title}
        initialDescription={property.shortDescription}
        action={actions.saveContent}
        readOnly={!canWriteProperty}
      />
    </PropertyWordingFold>
  )

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="space-y-4 rounded-lg border p-4"
    >
      <LanguageHeading locale={locale} headingId={headingId} />
      {hasWording ? (
        <>
          {ownLines}
          {propertyWording}
        </>
      ) : (
        <>
          <MissingWordingNote
            locale={locale}
            isPrimary={isPrimary}
            canWriteProperty={canWriteProperty}
          />
          {propertyWording}
          <p className="text-sm text-muted-foreground">
            This portal&rsquo;s own lines count once the property wording above is saved.
          </p>
          {ownLines}
        </>
      )}
    </div>
  )
}

function LanguageHeading({
  locale,
  headingId,
}: Readonly<{ locale: OfferedGuestLocale; headingId: string }>) {
  const name = languageDisplayName(locale)
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <h3 id={headingId} className="font-medium">
          <span lang={locale}>{name.native}</span>
          {name.english === name.native ? null : (
            <span className="font-normal text-muted-foreground"> · {name.english}</span>
          )}
        </h3>
        <p className="text-sm text-muted-foreground">
          An empty line uses the property&rsquo;s wording.
        </p>
      </div>
      <Badge variant="secondary">{adminLanguageCode(locale)}</Badge>
    </div>
  )
}

function MissingWordingNote({
  locale,
  isPrimary,
  canWriteProperty,
}: Readonly<{
  locale: OfferedGuestLocale
  isPrimary: boolean
  canWriteProperty: boolean
}>) {
  const { english } = languageDisplayName(locale)
  // One string, so formatting can never split the sentence from its full stop.
  const effect = isPrimary
    ? 'so the portal cannot be published yet.'
    : `so guests do not see these lines in ${english}.`
  const next = canWriteProperty
    ? 'Write it below first.'
    : 'An account admin writes it first.'
  return (
    <Alert variant="warning" role="status">
      <AlertDescription>
        {`${english} has no property wording yet, ${effect} ${next}`}
      </AlertDescription>
    </Alert>
  )
}

function PropertyWordingFold({
  propertyName,
  startsOpen,
  placement,
  canManagePropertyBrand,
  children,
}: Readonly<{
  propertyName: string | null
  startsOpen: boolean
  /** Below this portal's own lines, or first, under the warning that points at it. */
  placement: 'below' | 'first'
  canManagePropertyBrand: boolean
  children: ReactNode
}>) {
  const [open, setOpen] = useState(startsOpen)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={placement === 'below' ? 'border-t pt-3' : 'border-b pb-4'}
    >
      <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 rounded-md text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring md:min-h-8">
        <ChevronRight
          aria-hidden="true"
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')}
        />
        Property wording
        <span className="font-normal text-muted-foreground">
          · every portal at {propertyName ?? 'this property'}
        </span>
      </CollapsibleTrigger>
      {/* Mounted while closed (forceMount), hidden instead: see the note at the top. */}
      <CollapsibleContent forceMount hidden={!open} className="pt-3">
        {canManagePropertyBrand ? null : (
          <p className="mb-3 text-sm text-muted-foreground">
            Only an account admin can change it.
          </p>
        )}
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
