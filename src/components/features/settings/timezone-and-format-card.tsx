// Timezone and date format, on Profile (D6, docs/design/notifications). They
// are the person's clock rather than a notification setting: quiet hours, the
// daily digest and every time the app writes in a notification go by it. The
// notification settings page used to hold them between the Property picker
// and quiet hours, where they read as one Property's.
//
// The row is per Organization membership (ADR 0046 r.3), so the card says
// which Organization it sets them for. A failed read shows here, with Try
// again, rather than as an error for the whole of Profile.

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
  /** The read has failed and there is nothing to edit yet. */
  failed: boolean
  /**
   * Try again is reading. A retry clears the query's error while it reads, so
   * the alert stays — its button busy — rather than giving way to the loading
   * state, which dropped focus onto <body>.
   */
  retrying: boolean
  onRetry: () => void
  organizationName: string
  updateUserSettings: Action<NotificationSettingsUpdate, EffectiveNotificationSettings>
}>

export function TimezoneAndFormatCard({
  settings,
  failed,
  retrying,
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
        ) : failed ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <span>Couldn't load your timezone and date format.</span>
            <Button
              variant="outline"
              size="sm"
              aria-disabled={retrying}
              onClick={() => {
                if (!retrying) onRetry()
              }}
            >
              {retrying ? 'Trying again…' : 'Try again'}
            </Button>
          </div>
        ) : (
          <div role="status" className="grid gap-4 sm:grid-cols-2">
            <span className="sr-only">Loading your timezone and date format…</span>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
