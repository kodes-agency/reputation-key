// Timezone and date format, on Profile (D6, docs/design/notifications). They
// are the person's clock rather than a notification setting: quiet hours, the
// daily digest and every time the app writes in a notification go by it. The
// notification settings page used to hold them between the Property picker
// and quiet hours, where they read as one Property's.
//
// The row is per Organization membership (ADR 0046 r.3), so the card says
// which Organization it sets them for. Profile does not wait for it: the card
// shows its own loading and failure, and the name and avatar never do.

import type { Action } from '#/components/hooks/use-action'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import type { EffectiveNotificationSettings } from '#/contexts/feed/application/public-api'
import {
  NotificationFormattingForm,
  type NotificationSettingsUpdate,
} from './notification-formatting-form'

type Props = Readonly<{
  /**
   * What delivery uses now: the saved values, or the Organization's timezone.
   * Undefined until the read answers.
   */
  settings: EffectiveNotificationSettings | undefined
  /** A failed read, shown only while there is nothing to edit. */
  error: Error | null
  onRetry: () => void
  organizationName: string
  updateUserSettings: Action<NotificationSettingsUpdate, EffectiveNotificationSettings>
}>

export function TimezoneAndFormatCard({
  settings,
  error,
  onRetry,
  organizationName,
  updateUserSettings,
}: Props) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        {/*
          Not "Language": every word in the product is English (docs/BETA.md),
          and this control only chooses how a date and a time are written.
        */}
        <CardTitle>Timezone and date format</CardTitle>
        <CardDescription>
          Your timezone decides when quiet hours start and end and when the daily digest
          arrives (08:00), at every property in {organizationName}. Notification times are
          shown in it too.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings ? (
          <NotificationFormattingForm
            // Remounting on the server values is the re-sync. The inputs need
            // local edit state, but seeding it once meant a refetch — or
            // another session — never reached the fields. Keying on the
            // effective values reseeds them exactly when the server truth
            // changes and never while the user is mid-edit.
            key={`${settings.locale}:${settings.timezone}:${settings.timezoneSource}`}
            settings={settings}
            updateUserSettings={updateUserSettings}
          />
        ) : error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span>Couldn't load your timezone and date format.</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : (
          <div role="status" aria-busy="true" className="grid gap-4 sm:grid-cols-2">
            <span className="sr-only">Loading your timezone and date format…</span>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
