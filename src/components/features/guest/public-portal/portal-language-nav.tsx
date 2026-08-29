import type { PortalLocalization } from './portal-localization'

/** Portal chrome colours, so the switcher never inherits app `--accent`. */
const LANGUAGE_LINK_STYLE = {
  color: 'var(--portal-text)',
  borderColor: 'var(--portal-accent-border)',
}

type Props = Readonly<{
  /** Omitted only by authenticated manager previews, which get no switcher. */
  token: string | undefined
  /** Public channel marker preserved when the guest switches language. */
  accessArtifactId: string | undefined
  localization: PortalLocalization | undefined
  navigationLabel: string
}>

export function PortalLanguageNav({
  token,
  accessArtifactId,
  localization,
  navigationLabel,
}: Props) {
  if (!token || !localization || localization.availableLocales.length <= 1) return null

  const artifactParam = accessArtifactId
    ? `&accessArtifact=${encodeURIComponent(accessArtifactId)}`
    : ''

  return (
    <nav aria-label={navigationLabel} className="flex justify-end gap-2 text-sm">
      {localization.availableLocales.map((locale) => (
        <a
          key={locale}
          href={`/p/${encodeURIComponent(token)}?locale=${locale}${artifactParam}`}
          hrefLang={locale}
          aria-current={locale === localization.selectedLocale ? 'page' : undefined}
          // The guest portal must not inherit app chrome colours: the global
          // bare-anchor rule paints links with `--accent`, which measures
          // 3.88:1 on white. Portal chrome uses the PORTAL's palette, whose
          // contrast is the palette's own contract.
          className="rounded-md border px-2 py-1"
          style={LANGUAGE_LINK_STYLE}
        >
          {locale === 'bg' ? 'Български' : 'English'}
        </a>
      ))}
    </nav>
  )
}
