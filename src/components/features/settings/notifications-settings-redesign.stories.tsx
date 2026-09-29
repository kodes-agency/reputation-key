// DESIGN PROTOTYPE — story-only. The preferences page as "your defaults, plus
// exceptions", in place of one full form per property. The backend already
// models both halves: personal defaults (ADR 0046, amended 2026-09-23) and
// per-property rows. See docs/design/notifications/README.md.

import { useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Check, ChevronRight, Lock, MoreHorizontal, Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { cn } from '#/lib/utils'

type EmailChoice = 'off' | 'immediate' | 'daily'

type CategoryRow = Readonly<{
  key: string
  label: string
  description: string
  inApp: boolean | 'always'
  email: EmailChoice | 'always'
  emailChoices: ReadonlyArray<EmailChoice>
}>

const EMAIL_LABELS: Readonly<Record<EmailChoice, string>> = {
  off: 'Off',
  immediate: 'Right away',
  daily: 'Daily at 08:00',
}

const DEFAULTS: ReadonlyArray<CategoryRow> = [
  {
    key: 'urgent_operational',
    label: 'Urgent issues',
    description:
      'Escalations, low-rated private feedback, replies that failed to publish.',
    inApp: 'always',
    email: 'immediate',
    emailChoices: ['off', 'immediate', 'daily'],
  },
  {
    key: 'workflow_collaboration',
    label: 'Team and reviews',
    description: 'New reviews, assignments, internal notes, reply approvals.',
    inApp: true,
    email: 'off',
    emailChoices: ['off', 'immediate', 'daily'],
  },
  {
    key: 'recognition',
    label: 'Goals',
    description: 'Monthly goal results.',
    inApp: true,
    email: 'daily',
    emailChoices: ['off', 'daily'],
  },
  {
    key: 'mandatory',
    label: 'Account and security',
    description: 'Access, role changes and deletion notices. Required.',
    inApp: 'always',
    email: 'always',
    emailChoices: [],
  },
]

function Always() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Lock aria-hidden="true" className="size-3.5" />
      Always
    </span>
  )
}

function SavedMark({ visible }: Readonly<{ visible: boolean }>) {
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1 text-xs text-positive transition-opacity',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <Check aria-hidden="true" className="size-3.5" />
      Saved
    </span>
  )
}

function Matrix({
  rows,
  onChange,
  inheritedKeys,
}: Readonly<{
  rows: ReadonlyArray<CategoryRow>
  onChange: () => void
  /** Cells that still follow the defaults, in the exception editor. */
  inheritedKeys?: ReadonlySet<string>
}>) {
  return (
    <div role="table" aria-label="What reaches you" className="text-sm">
      <div
        role="row"
        className="hidden grid-cols-[1fr_7rem_12rem] gap-4 border-b pb-2 text-xs font-medium text-muted-foreground sm:grid"
      >
        <span role="columnheader">Category</span>
        <span role="columnheader">In the app</span>
        <span role="columnheader">Email</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          role="row"
          className="grid grid-cols-2 gap-x-4 gap-y-2 border-b py-3 last:border-b-0 sm:grid-cols-[1fr_7rem_12rem] sm:items-center"
        >
          <div role="rowheader" className="col-span-2 min-w-0 sm:col-span-1">
            <p className="font-medium">{row.label}</p>
            <p className="text-xs text-muted-foreground">{row.description}</p>
          </div>
          <div role="cell">
            {row.inApp === 'always' ? (
              <Always />
            ) : (
              <Label className="flex items-center gap-2 font-normal">
                <Switch
                  defaultChecked={row.inApp}
                  onCheckedChange={onChange}
                  aria-label={`${row.label}: in the app`}
                />
                <span className="sm:sr-only">In the app</span>
              </Label>
            )}
          </div>
          <div role="cell" className="flex items-center gap-2">
            {row.email === 'always' ? (
              <Always />
            ) : (
              <Select defaultValue={row.email} onValueChange={onChange}>
                <SelectTrigger
                  aria-label={`${row.label}: email`}
                  className="w-full sm:w-48"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {row.emailChoices.map((choice) => (
                    <SelectItem key={choice} value={choice}>
                      {EMAIL_LABELS[choice]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {inheritedKeys?.has(row.key) && (
              <span className="shrink-0 text-xs text-muted-foreground">Default</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function QuietHours({ onChange }: Readonly<{ onChange: () => void }>) {
  const [on, setOn] = useState(true)
  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-3 font-normal">
        <Switch
          checked={on}
          onCheckedChange={(next) => {
            setOn(next)
            onChange()
          }}
        />
        <span className="text-sm font-medium">Hold email overnight</span>
      </Label>
      {on && (
        <div className="flex flex-wrap items-center gap-2 pl-12 text-sm">
          <Input
            type="time"
            defaultValue="22:00"
            aria-label="Quiet from"
            className="w-28"
            onChange={onChange}
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="time"
            defaultValue="07:00"
            aria-label="Quiet until"
            className="w-28"
            onChange={onChange}
          />
          <Label className="ml-2 flex items-center gap-2 font-normal">
            <Checkbox defaultChecked onCheckedChange={onChange} />
            Urgent email still comes through
          </Label>
        </div>
      )}
      <p className="pl-12 text-xs text-muted-foreground">
        On your clock, Sofia (UTC+3). Notifications still arrive in the app.
      </p>
    </div>
  )
}

type Exception = Readonly<{
  id: string
  name: string
  summary: string
  emailUnavailable?: boolean
}>

const EXCEPTIONS: ReadonlyArray<Exception> = [
  {
    id: 'pine',
    name: 'Harbor & Pine',
    summary: 'Team and reviews email right away · quiet 23:00–06:00',
  },
  { id: 'river', name: 'Riverside Hotel', summary: 'Goals off' },
  {
    id: 'lake',
    name: 'Lakeside Lodge',
    summary: 'Email not available for this property',
    emailUnavailable: true,
  },
]

function Exceptions({ onEdit }: Readonly<{ onEdit?: (id: string) => void }>) {
  return (
    <div>
      <ul className="divide-y">
        {EXCEPTIONS.map((exception) => (
          <li key={exception.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{exception.name}</p>
              <p
                className={cn(
                  'truncate text-xs',
                  exception.emailUnavailable ? 'text-warn' : 'text-muted-foreground',
                )}
              >
                {exception.summary}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onEdit?.(exception.id)}>
              Edit
              <ChevronRight aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More for ${exception.name}`}
              className="text-muted-foreground"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" className="mt-3">
        <Plus aria-hidden="true" />
        Add an exception
      </Button>
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: Readonly<{ title: string; description?: string; children: ReactNode }>) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function useSavedFlash() {
  const [saved, setSaved] = useState(false)
  return {
    saved,
    flash: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    },
  }
}

function SettingsRedesign() {
  const { saved, flash } = useSavedFlash()
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your setup for all 12 properties, including ones you are given later.
          </p>
        </div>
        <SavedMark visible={saved} />
      </header>
      <Section title="What reaches you">
        <Matrix rows={DEFAULTS} onChange={flash} />
      </Section>
      <Section title="Quiet hours">
        <QuietHours onChange={flash} />
      </Section>
      <Section
        title="Property exceptions"
        description="A different setup for a property you watch more closely, or less."
      >
        <Exceptions />
      </Section>
      {/* The link sits beside the sentence, not inside it: an inline link in
          muted text fails axe's link-in-text-block in the light theme. */}
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <p className="text-muted-foreground">
          Times show in Sofia (UTC+3), written 23/09/2026, 18:04.
        </p>
        <a href="#" onClick={(event) => event.preventDefault()}>
          Change in your profile
        </a>
      </div>
    </main>
  )
}

function ExceptionEditor() {
  const { saved, flash } = useSavedFlash()
  const inherited = new Set(['urgent_operational', 'recognition'])
  const rows = DEFAULTS.filter((row) => row.key !== 'mandatory').map((row) =>
    row.key === 'workflow_collaboration' ? { ...row, email: 'immediate' as const } : row,
  )
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Notifications › Exceptions</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Harbor & Pine
          </h1>
        </div>
        <SavedMark visible={saved} />
      </header>
      <Section
        title="What reaches you here"
        description="Anything marked Default follows your setup for every property."
      >
        <Matrix rows={rows} onChange={flash} inheritedKeys={inherited} />
      </Section>
      <Section title="Quiet hours here">
        <QuietHours onChange={flash} />
      </Section>
      <div className="flex justify-between">
        <Button variant="ghost" size="sm" className="text-destructive">
          Remove exception
        </Button>
      </div>
    </main>
  )
}

const meta = {
  title: 'Design/Notification settings redesign',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const S_DefaultsAndExceptions: Story = { render: () => <SettingsRedesign /> }
export const S_ExceptionEditor: Story = { render: () => <ExceptionEditor /> }
export const S_Light: Story = {
  parameters: { theme: 'light' },
  render: () => <SettingsRedesign />,
}
