// PROTOTYPE — Notifications. At one property there is no picker: the switches write
// the person's own default. From two properties a picker appears, and the first entry
// is "All my properties (my defaults)": the only place inheritance shows in Notifications.
import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Switch } from '#/components/ui/switch'
import { SaveRow, SelectRow, type SectionProps } from './prototype-section-kit'
import { usePrototypeForm } from './use-prototype-form'

const CATEGORIES = [
  'New reviews',
  'Low ratings',
  'Private feedback',
  'Replies that need a check',
  'Weekly summary',
] as const
const CHANNELS = ['In-app', 'Email'] as const
const ALL = 'All my properties (my defaults)'

const keyOf = (category: string, channel: string) => `${category}|${channel}`

export function NotificationsSection({ ctx }: SectionProps) {
  const picker = ctx.shape.showPropertySwitcher
  const [target, setTarget] = useState(ALL)
  const form = usePrototypeForm(
    Object.fromEntries(
      CATEGORIES.flatMap((category, i) =>
        CHANNELS.map((channel, j) => [keyOf(category, channel), (i + j) % 3 !== 2]),
      ),
    ),
  )
  const properties = ctx.data.properties.map((p) => p.name)
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">What you are told about</CardTitle>
        <CardDescription>
          {picker && target !== ALL
            ? `Your own settings for ${target}. Pick "${ALL}" to go back to your defaults.`
            : 'Choose how each kind of news reaches you.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {picker ? (
          <SelectRow
            id="notifications-property"
            label="For"
            value={target}
            options={[ALL, ...properties]}
            onChange={setTarget}
          />
        ) : null}
        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            <span>Kind of news</span>
            {CHANNELS.map((channel) => (
              <span key={channel} className="text-center">
                {channel}
              </span>
            ))}
          </div>
          <ul className="divide-y">
            {CATEGORIES.map((category) => (
              <li
                key={category}
                className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2 px-4 py-3 text-sm"
              >
                <span>{category}</span>
                {CHANNELS.map((channel) => (
                  <span key={channel} className="flex justify-center">
                    <Switch
                      aria-label={`${category}, ${channel}`}
                      checked={form.value[keyOf(category, channel)] === true}
                      onCheckedChange={(next) =>
                        form.set({ [keyOf(category, channel)]: next })
                      }
                    />
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardFooter>
        <SaveRow form={form} />
      </CardFooter>
    </Card>
  )
}
