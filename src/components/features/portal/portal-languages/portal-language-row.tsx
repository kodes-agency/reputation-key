// One language the Portal offers: its chip and names, how much of its wording is
// written, and where the gaps are. The fallback language says what it is for.
// The list of gaps opens under the row; each gap links to the section where the
// text is written, because the wording is written by hand, in place.

import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import type {
  MissingPortalText,
  PortalLanguageCoverageRow,
} from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { PortalLanguageMenu } from './portal-language-menu'
import {
  describeCoverage,
  describeMissingText,
  languageDisplayName,
  languageSubline,
  missingTextAction,
  type PortalLanguageChange,
} from './portal-languages-rules'
import { InlineLink } from '#/components/ui/inline-link'

type Props = Readonly<{
  propertyId: string
  portalId: string
  locale: GuestLocale
  isFallback: boolean
  /** Null until the coverage read has caught up with a language just added. */
  coverage: PortalLanguageCoverageRow | null
  canEdit: boolean
  /** An account admin who may edit: the property's wording is theirs to write. */
  canWritePropertyWording: boolean
  onChange: (change: PortalLanguageChange) => void
}>

export function PortalLanguageRow({
  propertyId,
  portalId,
  locale,
  isFallback,
  coverage,
  canEdit,
  canWritePropertyWording,
  onChange,
}: Props) {
  const name = languageDisplayName(locale)
  const subline = languageSubline(locale, isFallback)
  const description = coverage === null ? null : describeCoverage(coverage)
  const gaps = coverage?.missing ?? []
  const [showingMissing, setShowingMissing] = useState(false)
  return (
    <li className="border-b last:border-b-0">
      <Collapsible open={showingMissing} onOpenChange={setShowingMissing}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-card text-xs font-semibold"
          >
            {name.chip}
          </span>
          <div className="min-w-0 flex-1 basis-40">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              <span lang={locale}>{name.native}</span>
              {isFallback ? <Badge variant="secondary">Fallback</Badge> : null}
            </p>
            {subline === null ? null : (
              <p className="text-sm text-muted-foreground">{subline}</p>
            )}
          </div>
          <div className="flex items-center gap-2 max-sm:order-last max-sm:basis-full max-sm:pl-14">
            {description === null ? null : (
              <span
                className={
                  description.tone === 'missing'
                    ? 'flex items-center gap-1 text-sm font-medium text-warn'
                    : 'text-sm text-muted-foreground'
                }
              >
                {description.tone === 'missing' ? (
                  <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                ) : null}
                {description.text}
              </span>
            )}
            {gaps.length > 0 ? (
              <CollapsibleTrigger asChild>
                <Button
                  variant="link"
                  size="inline"
                  aria-label={`${showingMissing ? 'Hide' : 'Show'} missing texts in ${name.english}`}
                  className="px-1 py-2"
                >
                  {showingMissing ? 'Hide missing' : 'Show missing'}
                </Button>
              </CollapsibleTrigger>
            ) : null}
          </div>
          {canEdit ? (
            <PortalLanguageMenu
              locale={locale}
              languageName={name.native}
              isFallback={isFallback}
              onChange={onChange}
            />
          ) : null}
        </div>
        {gaps.length > 0 ? (
          <CollapsibleContent>
            <ul
              aria-label={`Missing in ${name.english}`}
              className="mb-4 space-y-1 rounded-md border bg-muted/30 p-3 text-sm"
            >
              {gaps.map((text) => (
                <li
                  key={text.key}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>{describeMissingText(text)}</span>
                  <MissingTextAction
                    text={text}
                    propertyId={propertyId}
                    portalId={portalId}
                    canWritePropertyWording={canWritePropertyWording}
                  />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </li>
  )
}

function MissingTextAction({
  text,
  propertyId,
  portalId,
  canWritePropertyWording,
}: Readonly<{
  text: MissingPortalText
  propertyId: string
  portalId: string
  canWritePropertyWording: boolean
}>) {
  const action = missingTextAction(text, canWritePropertyWording)
  if (action.kind === 'ask_account_admin') {
    return (
      <span className="text-muted-foreground">
        An account admin writes this in Welcome
      </span>
    )
  }
  return (
    <InlineLink
      to="/properties/$propertyId/portals/$portalId"
      params={{ propertyId, portalId }}
      search={{ tab: 'page', section: action.section }}
      className="min-h-8 py-1"
    >
      Write it in {action.section === 'welcome' ? 'Welcome' : 'Linktree'}
    </InlineLink>
  )
}
