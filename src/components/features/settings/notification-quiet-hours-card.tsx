// Quiet hours and the urgent bypass: one answer for every property the person
// has, with an optional override for the property in view (ADR 0046, amended
// 2026-09-23).
//
// They used to sit inside every category row, per property: a manager with 30
// properties needed about 60 saves to stop 03:00 email, and a window set on
// only some properties split the one daily digest in two.

import { useState } from 'react'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import type {
  EffectiveNotificationSettings,
  PersonalDeliveryWindow,
} from '#/contexts/feed/application/public-api'
import { QuietHoursEditor } from './quiet-hours-editor'

export type QuietHoursUpdate = Readonly<{
  data: Readonly<{
    propertyId?: string
    follow?: boolean
    quietHoursStart?: string | null
    quietHoursEnd?: string | null
    urgentBypassEnabled?: boolean
  }>
}>

type Props = Readonly<{
  /** The person's own window, as delivery reads it. */
  settings: EffectiveNotificationSettings
  /** The property in view, and its override if it has one. */
  property: Readonly<{ id: string; name: string }>
  override: PersonalDeliveryWindow | null
  /** The recipient's delivery clock, e.g. "Sofia (UTC+3)" (ADR 0046 r.3). */
  clockLabel: string
  updateQuietHours: Action<QuietHoursUpdate, EffectiveNotificationSettings>
}>

function UrgentBypassSwitch({
  id,
  checked,
  disabled,
  label,
  onChange,
}: Readonly<{
  id: string
  checked: boolean
  disabled: boolean
  label: string
  onChange: (value: boolean) => void
}>) {
  return (
    <Label className="flex items-center gap-2">
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onChange}
      />
      Let urgent email through anyway
    </Label>
  )
}

export function NotificationQuietHoursCard({
  settings,
  property,
  override,
  clockLabel,
  updateQuietHours,
}: Props) {
  const pending = updateQuietHours.isPending
  const [overriding, setOverriding] = useState(override !== null)

  const save = async (data: QuietHoursUpdate['data'], done: string) => {
    try {
      await updateQuietHours({ data })
      toast.success(done)
    } catch {
      toast.error('Could not update quiet hours')
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Quiet hours</CardTitle>
        <CardDescription>
          Email waits until quiet hours are over, at every property, on your own clock (
          {clockLabel}). The daily digest waits as a whole, so it stays one email.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-labelledby="quiet-hours-personal" className="space-y-3">
          <h3 id="quiet-hours-personal" className="text-sm font-medium">
            Your quiet hours
          </h3>
          <QuietHoursEditor
            key={`personal:${settings.quietHoursStart}:${settings.quietHoursEnd}`}
            start={settings.quietHoursStart}
            end={settings.quietHoursEnd}
            categoryLabel="Your quiet hours"
            disabled={pending}
            onSave={(quietHoursStart, quietHoursEnd) =>
              void save(
                {
                  quietHoursStart,
                  quietHoursEnd,
                  urgentBypassEnabled: settings.urgentBypassEnabled,
                },
                'Quiet hours updated',
              )
            }
          />
          <UrgentBypassSwitch
            id="quiet-hours-urgent-bypass"
            checked={settings.urgentBypassEnabled}
            disabled={pending}
            label="Let urgent email through your quiet hours"
            onChange={(urgentBypassEnabled) =>
              void save(
                {
                  quietHoursStart: settings.quietHoursStart,
                  quietHoursEnd: settings.quietHoursEnd,
                  urgentBypassEnabled,
                },
                'Quiet hours updated',
              )
            }
          />
        </section>

        <section
          aria-labelledby="quiet-hours-property"
          className="space-y-3 border-t pt-5"
        >
          <h3 id="quiet-hours-property" className="text-sm font-medium">
            {property.name}
          </h3>
          {overriding ? (
            <>
              <QuietHoursEditor
                key={`${property.id}:${override?.quietHoursStart}:${override?.quietHoursEnd}`}
                start={override?.quietHoursStart ?? null}
                end={override?.quietHoursEnd ?? null}
                categoryLabel={property.name}
                disabled={pending}
                onSave={(quietHoursStart, quietHoursEnd) =>
                  void save(
                    {
                      propertyId: property.id,
                      quietHoursStart,
                      quietHoursEnd,
                      urgentBypassEnabled: override?.urgentBypassEnabled ?? false,
                    },
                    `Quiet hours updated for ${property.name}`,
                  )
                }
              />
              <UrgentBypassSwitch
                id="quiet-hours-property-urgent-bypass"
                checked={override?.urgentBypassEnabled ?? false}
                disabled={pending}
                label={`Let urgent email through quiet hours at ${property.name}`}
                onChange={(urgentBypassEnabled) =>
                  void save(
                    {
                      propertyId: property.id,
                      quietHoursStart: override?.quietHoursStart ?? null,
                      quietHoursEnd: override?.quietHoursEnd ?? null,
                      urgentBypassEnabled,
                    },
                    `Quiet hours updated for ${property.name}`,
                  )
                }
              />
              <p className="text-sm text-muted-foreground">
                Leave both times empty to send this property&apos;s email at any hour.
              </p>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setOverriding(false)
                  if (override !== null) {
                    void save(
                      { propertyId: property.id, follow: true },
                      `${property.name} follows your quiet hours again`,
                    )
                  }
                }}
              >
                Follow my quiet hours here
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Follows your quiet hours. The daily digest always does.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOverriding(true)}
              >
                Use different hours here
              </Button>
            </>
          )}
        </section>
      </CardContent>
    </Card>
  )
}
