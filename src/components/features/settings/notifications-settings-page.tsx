// Notifications settings page — per-type in-app/email channel toggles.
// Preferences are sparse: a type with no saved row defaults to both channels on
// (see notification context, insert-notification use case). Toggles are optimistic
// and revert on mutation failure.

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Switch } from '#/components/ui/switch'
import { Label } from '#/components/ui/label'
import type { Action } from '#/components/hooks/use-action'
import type {
  NotificationType,
  NotificationPreference,
} from '#/contexts/notification/application/public-api'

type Channels = Readonly<{ emailEnabled: boolean; inAppEnabled: boolean }>

type UpdateInput = Readonly<{
  data: Readonly<{ type: NotificationType; emailEnabled: boolean; inAppEnabled: boolean }>
}>

type Props = Readonly<{
  preferences: readonly NotificationPreference[]
  updatePreference: Action<UpdateInput, NotificationPreference>
}>

// Display metadata for every notification type the backend recognises.
// Keep in sync with NOTIFICATION_TYPES in notification/server/notifications.ts.
const TYPE_ROWS: ReadonlyArray<{
  type: NotificationType
  label: string
  description: string
}> = [
  {
    type: 'review.created',
    label: 'New reviews',
    description: 'A new review is published for a property.',
  },
  {
    type: 'feedback.created',
    label: 'New feedback',
    description: 'A guest submits new feedback.',
  },
  {
    type: 'reply.pending_approval',
    label: 'Reply pending approval',
    description: 'A reply is awaiting approval.',
  },
  {
    type: 'reply.approved',
    label: 'Reply approved',
    description: 'A reply you submitted is approved.',
  },
  {
    type: 'reply.rejected',
    label: 'Reply rejected',
    description: 'A reply you submitted is rejected.',
  },
  {
    type: 'reply.published',
    label: 'Reply published',
    description: 'A reply is published publicly.',
  },
  {
    type: 'reply.publish_failed',
    label: 'Reply publish failed',
    description: 'A reply failed to publish.',
  },
  {
    type: 'inbox.escalated',
    label: 'Escalated items',
    description: 'An inbox item is escalated.',
  },
  {
    type: 'inbox.assigned',
    label: 'Assignments',
    description: 'An inbox item is assigned to you.',
  },
  {
    type: 'inbox_note.added',
    label: 'Notes',
    description: 'A note is added to an inbox item.',
  },
  {
    type: 'goal.completed',
    label: 'Goals completed',
    description: 'A goal is completed.',
  },
  { type: 'badge.awarded', label: 'Badges awarded', description: 'A badge is awarded.' },
]

function buildState(
  preferences: readonly NotificationPreference[],
): Record<NotificationType, Channels> {
  return Object.fromEntries(
    TYPE_ROWS.map(({ type }) => {
      const saved = preferences.find((p) => p.type === type)
      return [type, saved ?? { emailEnabled: true, inAppEnabled: true }]
    }),
  ) as Record<NotificationType, Channels>
}

export function NotificationsSettingsPage({ preferences, updatePreference }: Props) {
  const [state, setState] = useState<Record<NotificationType, Channels>>(() =>
    buildState(preferences),
  )

  const toggle = async (
    type: NotificationType,
    channel: keyof Channels,
    next: boolean,
  ) => {
    const prev = state[type]
    const updated = { ...prev, [channel]: next }
    setState((s) => ({ ...s, [type]: updated }))
    try {
      await updatePreference({
        data: {
          type,
          emailEnabled: updated.emailEnabled,
          inAppEnabled: updated.inAppEnabled,
        },
      })
    } catch {
      // Revert optimistic update on failure.
      setState((s) => ({ ...s, [type]: prev }))
      toast.error('Failed to update notification preference')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>
          Choose which events notify you in-app and by email.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {TYPE_ROWS.map(({ type, label, description }) => {
          const channels = state[type]
          return (
            <div
              key={type}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="max-w-sm">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <div className="flex items-center gap-5">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor={`${type}-inapp`}
                    className="text-xs text-muted-foreground"
                  >
                    In-app
                  </Label>
                  <Switch
                    id={`${type}-inapp`}
                    checked={channels.inAppEnabled}
                    onCheckedChange={(v) => toggle(type, 'inAppEnabled', v)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor={`${type}-email`}
                    className="text-xs text-muted-foreground"
                  >
                    Email
                  </Label>
                  <Switch
                    id={`${type}-email`}
                    checked={channels.emailEnabled}
                    onCheckedChange={(v) => toggle(type, 'emailEnabled', v)}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
