import { useMemo, useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import type { PortalData, UpdatePortalVariables } from '../shared/types'
import { PortalExperienceActionError } from './portal-experience-action-error'
import {
  OFFERED_GUEST_LOCALES,
  type GuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import {
  isOptionalGuestLocaleEnabled,
  PORTAL_GUEST_LOCALE_LABEL,
} from './portal-experience-settings-types'

const ENGLISH_ONLY: readonly OfferedGuestLocale[] = ['en']

export function PortalLocaleConfiguration({
  portal,
  update,
  disabled,
}: Readonly<{
  portal: PortalData
  update: Action<UpdatePortalVariables>
  disabled: boolean
}>) {
  const persistedPrimary = portal.primaryGuestLocale ?? 'en'
  const persistedBulgarian = isOptionalGuestLocaleEnabled(portal)
  const [primary, setPrimary] = useState<GuestLocale>(persistedPrimary)
  const [bulgarianEnabled, setBulgarianEnabled] = useState(persistedBulgarian)
  const enabled = useMemo<readonly OfferedGuestLocale[]>(
    () => (bulgarianEnabled ? OFFERED_GUEST_LOCALES : ENGLISH_ONLY),
    [bulgarianEnabled],
  )
  const effectivePrimary = enabled.find((locale) => locale === primary) ?? 'en'

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div>
        <h4 className="font-medium">Guest languages</h4>
        <p className="text-sm text-muted-foreground">
          English is always available. Add Bulgarian and choose the fallback language.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={bulgarianEnabled}
          disabled={disabled || update.isPending}
          onChange={(event) => {
            const next = event.currentTarget.checked
            setBulgarianEnabled(next)
            if (!next) setPrimary('en')
          }}
        />
        Offer Bulgarian
      </label>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="portal-primary-guest-locale">Fallback language</Label>
        <select
          id="portal-primary-guest-locale"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={effectivePrimary}
          disabled={disabled || update.isPending}
          onChange={(event) =>
            setPrimary(event.currentTarget.value as OfferedGuestLocale)
          }
        >
          {enabled.map((locale) => (
            <option key={locale} value={locale}>
              {PORTAL_GUEST_LOCALE_LABEL[locale]}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || update.isPending}
        onClick={() => {
          void update({
            data: {
              portalId: portal.id,
              primaryGuestLocale: effectivePrimary,
              additionalGuestLocales: enabled.filter(
                (locale) => locale !== effectivePrimary,
              ),
            },
          }).catch(() => undefined)
        }}
      >
        {update.isPending ? 'Saving languages…' : 'Save languages'}
      </Button>
      <PortalExperienceActionError action={update} />
    </div>
  )
}
