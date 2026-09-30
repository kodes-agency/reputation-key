// Languages: which languages guests can read this portal in, how much of the
// wording each has, and what guests see where a text is missing. Changes are
// written at once through the portal's autosave coordinator; the wording itself
// is written by hand in the Welcome and Linktree sections (no AI translation).

import { Link } from '@tanstack/react-router'
import type { Action } from '#/components/hooks/use-action'
import type { PortalLanguageCoverage } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { UpdatePortalVariables } from '../shared/types'
import { PortalLanguageAddMenu } from './portal-language-add-menu'
import { PortalLanguageRow } from './portal-language-row'
import {
  addableLanguages,
  describeFallbackEffect,
  hasLaterLanguages,
  languageDisplayName,
} from './portal-languages-rules'
import { usePortalLanguageChange } from './use-portal-language-change'

type Props = Readonly<{
  portal: Readonly<{
    id: string
    primaryGuestLocale?: GuestLocale
    additionalGuestLocales?: readonly GuestLocale[]
  }>
  propertyId: string
  coverage: PortalLanguageCoverage | undefined
  update: Action<UpdatePortalVariables>
  canEdit: boolean
}>

export function PortalLanguagesSection({
  portal,
  propertyId,
  coverage,
  update,
  canEdit,
}: Props) {
  const primary = portal.primaryGuestLocale ?? 'en'
  const additional = portal.additionalGuestLocales ?? []
  const onChange = usePortalLanguageChange(portal, update)
  const coverageOf = (locale: GuestLocale) =>
    coverage?.languages.find((row) => row.locale === locale) ?? null
  return (
    <div className="space-y-6">
      <ul aria-label="Languages" className="border-t">
        {[primary, ...additional].map((locale) => (
          <PortalLanguageRow
            key={locale}
            propertyId={propertyId}
            portalId={portal.id}
            locale={locale}
            isFallback={locale === primary}
            coverage={coverageOf(locale)}
            canEdit={canEdit}
            onChange={onChange}
          />
        ))}
      </ul>
      {canEdit ? (
        <PortalLanguageAddMenu
          addable={addableLanguages({ primary, additional })}
          hasLater={hasLaterLanguages()}
          onChange={onChange}
        />
      ) : null}
      <MissingTextNote
        primary={primary}
        coverage={coverage}
        propertyId={propertyId}
        portalId={portal.id}
      />
    </div>
  )
}

function MissingTextNote({
  primary,
  coverage,
  propertyId,
  portalId,
}: Readonly<{
  primary: GuestLocale
  coverage: PortalLanguageCoverage | undefined
  propertyId: string
  portalId: string
}>) {
  const effects =
    coverage?.languages.flatMap((row) => describeFallbackEffect(row, primary) ?? []) ?? []
  const fallback = languageDisplayName(primary).english
  return (
    <section
      aria-labelledby="portal-languages-missing-heading"
      className="space-y-2 border-t pt-6"
    >
      <h3 id="portal-languages-missing-heading" className="font-medium">
        When a text is missing
      </h3>
      <p className="text-sm">
        Guests see the text in the fallback language, {fallback}. It is copied into the
        page when you publish, so nothing on the page is ever blank.
      </p>
      {coverage !== undefined ? (
        <p className="text-sm text-muted-foreground">
          {effects.length === 0
            ? 'Now: every language has all its text.'
            : `Now: ${effects.join(' · ')}.`}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Write each language&rsquo;s text in{' '}
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId }}
          search={{ tab: 'page', section: 'welcome' }}
          className="text-link underline-offset-4 hover:underline"
        >
          Welcome
        </Link>{' '}
        and{' '}
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId }}
          search={{ tab: 'page', section: 'linktree' }}
          className="text-link underline-offset-4 hover:underline"
        >
          Linktree
        </Link>
        .
      </p>
    </section>
  )
}
