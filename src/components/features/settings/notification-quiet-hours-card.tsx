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
import { InheritedSetting } from '#/components/forms/inherited-setting'
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type {
  EffectiveNotificationSettings,
  PersonalDeliveryWindow,
} from '#/contexts/feed/application/public-api'
import { QuietHoursEditor } from './quiet-hours-editor'
import { actionFailureMessage } from '#/components/hooks/use-action-mutation'
import { InlineLink } from '#/components/ui/inline-link'

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

/** A window in words, for the setting that follows it: "22:00 to 07:00", or no window at all. */
const quietHoursWords = (start: string | null, end: string | null): string =>
  start !== null && end !== null ? `${start} to ${end}` : 'no quiet hours'

/** The bypass saves as it is flipped: it says so while the request runs. */
function UrgentBypassSwitch({
  id,
  checked,
  disabled,
  accessibleName,
  onChange,
}: Readonly<{
  id: string
  checked: boolean
  /** Another quiet-hours save is running. */
  disabled: boolean
  accessibleName?: string
  /** Saves and reports its own refusal (a toast), so it never rejects. */
  onChange: (value: boolean) => Promise<unknown>
}>) {
  const [saving, setSaving] = useState(false)
  return (
    <SettingSwitchRow
      id={id}
      label="Let urgent email through anyway"
      accessibleName={accessibleName}
      commit="immediate"
      pending={saving}
      disabled={disabled}
      checked={checked}
      onCheckedChange={(value) => {
        setSaving(true)
        void onChange(value).finally(() => setSaving(false))
      }}
    />
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
  const [following, setFollowing] = useState(false)

  // A Save is a form submit: a refusal is the editor's banner, so it is rethrown
  // to the editor. A switch or a button is an immediate action: its refusal is a
  // toast.
  const saveEditor = async (data: QuietHoursUpdate['data'], done: string) => {
    await updateQuietHours({ data })
    toast.success(done)
  }
  const save = async (data: QuietHoursUpdate['data'], done: string): Promise<boolean> => {
    try {
      await saveEditor(data, done)
      return true
    } catch (error) {
      toast.error(actionFailureMessage("Couldn't update quiet hours.")(error))
      return false
    }
  }
  // Following again saves the end of the override, and the row shows the override
  // until that has been saved: a refusal leaves it where it was.
  const followHere = async () => {
    if (override === null) {
      setOverriding(false)
      return
    }
    setFollowing(true)
    const saved = await save(
      { propertyId: property.id, follow: true },
      `${property.name} follows your quiet hours again`,
    )
    setFollowing(false)
    if (saved) setOverriding(false)
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Quiet hours</CardTitle>
        <CardDescription>
          Email waits until quiet hours are over, at every property, on your own clock (
          {clockLabel}, set in{' '}
          <InlineLink to="/settings/profile" underline="always">
            Profile
          </InlineLink>
          ). The daily digest waits as a whole, so it stays one email.
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
              saveEditor(
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
            onChange={(urgentBypassEnabled) =>
              save(
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
          <InheritedSetting
            source={
              <InlineLink
                to="/settings/notifications"
                hash="quiet-hours-personal"
                underline="always"
              >
                your quiet hours
              </InlineLink>
            }
            value={quietHoursWords(settings.quietHoursStart, settings.quietHoursEnd)}
            overridden={overriding}
            commit="immediate"
            pending={following}
            disabled={pending}
            overrideLabel="Use different hours here"
            inheritLabel="Follow my quiet hours here"
            onOverride={() => setOverriding(true)}
            onInherit={() => void followHere()}
            note={overriding ? undefined : 'The daily digest always does.'}
          />
          {overriding ? (
            <>
              <QuietHoursEditor
                key={`${property.id}:${override?.quietHoursStart}:${override?.quietHoursEnd}`}
                start={override?.quietHoursStart ?? null}
                end={override?.quietHoursEnd ?? null}
                categoryLabel={property.name}
                disabled={pending}
                onSave={(quietHoursStart, quietHoursEnd) =>
                  saveEditor(
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
                accessibleName={`Let urgent email through anyway at ${property.name}`}
                onChange={(urgentBypassEnabled) =>
                  save(
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
            </>
          ) : null}
        </section>
      </CardContent>
    </Card>
  )
}
