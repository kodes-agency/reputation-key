// The preview's controls: which language, the draft or the live version, and
// "Try as guest". The language switch is absent for a portal with one language,
// as the guest page shows no chip then.

import { Smartphone } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { GUEST_LOCALE_METADATA, type GuestLocale } from '#/shared/domain/guest-locale'
import type { PortalPreviewSource } from '#/contexts/portal/application/public-api'

type Props = Readonly<{
  locales: readonly GuestLocale[]
  locale: GuestLocale
  onLocaleChange: (locale: GuestLocale) => void
  source: PortalPreviewSource
  onSourceChange: (source: PortalPreviewSource) => void
  isTrying: boolean
  onTryChange: (isTrying: boolean) => void
  /** The page is not drawn (loading, nothing live), so there is nothing to try. */
  canTry: boolean
}>

export function PortalPreviewToolbar({
  locales,
  locale,
  onLocaleChange,
  source,
  onSourceChange,
  isTrying,
  onTryChange,
  canTry,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {locales.length > 1 ? (
        <SegmentedControl
          aria-label="Preview language"
          value={locale}
          onValueChange={(value) => {
            const next = locales.find((candidate) => candidate === value)
            if (next !== undefined) onLocaleChange(next)
          }}
          options={locales.map((code) => ({
            value: code,
            label: GUEST_LOCALE_METADATA[code].chipLabel,
            accessibleLabel: GUEST_LOCALE_METADATA[code].englishName,
          }))}
        />
      ) : null}
      <SegmentedControl
        aria-label="Preview version"
        value={source}
        onValueChange={(value) => {
          if (value === 'draft' || value === 'live') onSourceChange(value)
        }}
        options={[
          { value: 'draft', label: 'Draft' },
          { value: 'live', label: 'Live' },
        ]}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-auto"
        aria-pressed={isTrying}
        disabled={!canTry}
        onClick={() => onTryChange(!isTrying)}
      >
        <Smartphone aria-hidden="true" />
        {isTrying ? 'Stop trying' : 'Try as guest'}
      </Button>
    </div>
  )
}
