// PROTOTYPE — You: Profile (with Appearance, which replaces the old Preferences page)
// and Security. Nothing here depends on the property in scope.
import { useState } from 'react'
import { ThemeModeControl } from '#/components/layout/theme-mode-control'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { Badge } from '#/components/ui/badge'
import { Input } from '#/components/ui/input'
import { FormFieldFrame } from '#/components/forms/form-field-frame'
import { SaveRow, SelectRow, TextRow, type SectionProps } from './prototype-section-kit'
import { usePrototypeForm } from './use-prototype-form'

const ZONES = [
  'Europe/Sofia',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/London',
  'America/New_York',
]
const FOLLOW = 'Follow the business'

export function ProfileSection({ ctx }: SectionProps) {
  const single = ctx.shape.tier === 'single'
  const form = usePrototypeForm({
    name: ctx.data.viewer.name,
    timezone: single ? FOLLOW : (ZONES[0] ?? FOLLOW),
  })
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle as="h3">Your profile</CardTitle>
          <CardDescription>How you appear to your team.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <TextRow
            id="profile-name"
            label="Name"
            value={form.value.name}
            onChange={(name) => form.set({ name })}
          />
          <DescriptionList stacked>
            <DescriptionItem term="Email">{ctx.data.viewer.email}</DescriptionItem>
          </DescriptionList>
          <SelectRow
            id="profile-timezone"
            label="Time zone"
            value={form.value.timezone}
            options={single ? [FOLLOW, ...ZONES] : ZONES}
            onChange={(timezone) => form.set({ timezone })}
            description={
              single ? 'Following the business keeps your times on its clock.' : undefined
            }
          />
        </CardContent>
        <CardFooter>
          <SaveRow form={form} />
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h3" id="profile-appearance">
            Appearance
          </CardTitle>
          <CardDescription>This device only.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeModeControl labelledBy="profile-appearance" />
        </CardContent>
      </Card>
    </div>
  )
}

const SESSIONS = [
  {
    id: 'now',
    label: 'This device',
    detail: 'Chrome on macOS, active now',
    current: true,
  },
  { id: 'phone', label: 'Phone', detail: 'Safari on iOS, 2 days ago', current: false },
] as const

export function SecuritySection(_props: SectionProps) {
  const [updating, setUpdating] = useState(false)
  const updatePassword = () => {
    setUpdating(true)
    setTimeout(() => setUpdating(false), 600)
  }
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle as="h3">Password</CardTitle>
          <CardDescription>Use at least 12 characters.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <FormFieldFrame id="security-current" label="Current password" invalid={false}>
            <Input id="security-current" type="password" autoComplete="off" />
          </FormFieldFrame>
          <FormFieldFrame id="security-new" label="New password" invalid={false}>
            <Input id="security-new" type="password" autoComplete="off" />
          </FormFieldFrame>
        </CardContent>
        <CardFooter className="justify-end">
          <Button pending={updating} onClick={updatePassword}>
            Update password
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h3">Where you are signed in</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-lg border">
            {SESSIONS.map((session) => (
              <li key={session.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{session.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {session.detail}
                  </span>
                </span>
                {session.current ? <Badge variant="positive">This device</Badge> : null}
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter>
          <Button variant="outline">Sign out other devices</Button>
        </CardFooter>
      </Card>
    </div>
  )
}
