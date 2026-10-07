// PROTOTYPE — Details, Google, People and Portals: the Business rows that are plain
// data and a handful of fields. Shared by every variant; Save is a fake.
import { Link } from '@tanstack/react-router'
import { Link2Off } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { EmptyState } from '#/components/ui/empty-state'
import { Label } from '#/components/ui/label'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import type { GoogleState, PropertyFixture } from '../settings-prototype-types'
import {
  LockedNotice,
  SaveRow,
  SelectRow,
  TextRow,
  type SectionProps,
} from './prototype-section-kit'
import { usePrototypeForm } from './use-prototype-form'

const CATEGORY: Readonly<Record<PropertyFixture['kind'], string>> = {
  hotel: 'Hotel',
  restaurant: 'Restaurant',
  salon: 'Salon',
}
const CATEGORIES = ['Hotel', 'Restaurant', 'Salon', 'Other']
const TIMEZONES = [
  'Europe/Sofia',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Zurich',
  'Europe/Lisbon',
  'Europe/Vienna',
  'Europe/Athens',
  'Europe/Prague',
  'Europe/Madrid',
]

export const GOOGLE_STATUS: StatusMap<GoogleState> = {
  linked: { label: 'Linked', tone: 'positive' },
  not_linked: { label: 'Not linked', tone: 'negative' },
  needs_reconnect: { label: 'Needs reconnect', tone: 'warn' },
}

export function DetailsSection({ ctx }: SectionProps) {
  const p = ctx.property
  if (p === null) return null
  return <DetailsCard property={p} />
}

function DetailsCard({ property: p }: Readonly<{ property: PropertyFixture }>) {
  const form = usePrototypeForm({
    displayName: p.name,
    category: CATEGORY[p.kind],
    timezone: TIMEZONES.includes(p.timezone) ? p.timezone : (TIMEZONES[0] ?? p.timezone),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Business details</CardTitle>
        <CardDescription>What guests see, and where you are.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <TextRow
          id="details-name"
          label="Display name"
          value={form.value.displayName}
          onChange={(displayName) => form.set({ displayName })}
          description="Shown on your portals and in every reply."
        />
        <SelectRow
          id="details-category"
          label="Category"
          value={form.value.category}
          options={CATEGORIES}
          onChange={(category) => form.set({ category })}
        />
        <SelectRow
          id="details-timezone"
          label="Time zone"
          value={form.value.timezone}
          options={TIMEZONES}
          onChange={(timezone) => form.set({ timezone })}
        />
        <DescriptionList stacked>
          <DescriptionItem term="Address" note="From Google">
            {p.address}
          </DescriptionItem>
        </DescriptionList>
      </CardContent>
      <CardFooter>
        <SaveRow form={form} />
      </CardFooter>
    </Card>
  )
}

export function GoogleSection({ ctx }: SectionProps) {
  const p = ctx.property
  if (p === null) return null
  const locked = ctx.shape.access.google === 'lock'
  const account = ctx.data.googleAccounts.find((a) => a.id === p.google.accountId)
  const linked = p.google.state !== 'not_linked'
  return (
    <div className="space-y-5">
      {locked ? (
        <LockedNotice ctx={ctx} what="The Google connection belongs to the workspace." />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle as="h3">Google account</CardTitle>
          <CardDescription>
            The account RepKey reads reviews from and replies through.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DescriptionList>
            <DescriptionItem term="Account">
              {account?.email ?? 'No account connected'}
            </DescriptionItem>
            <DescriptionItem term="Status">
              <StatusBadge status={p.google.state} map={GOOGLE_STATUS} />
            </DescriptionItem>
          </DescriptionList>
        </CardContent>
        <CardFooter className="gap-2">
          <Button variant="outline" disabled={locked}>
            {linked ? 'Reconnect' : 'Connect Google'}
          </Button>
        </CardFooter>
      </Card>
      {linked ? (
        <Card>
          <CardHeader>
            <CardTitle as="h3">Listing</CardTitle>
            <CardDescription>
              The Google Business Profile this location reads and answers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <DescriptionItem term="Listing">{p.google.listingName}</DescriptionItem>
              <DescriptionItem term="Address" note="From Google">
                {p.address}
              </DescriptionItem>
              <DescriptionItem term="Reviews">
                {p.google.reviewCount} imported
              </DescriptionItem>
            </DescriptionList>
          </CardContent>
          <CardFooter>
            <Button variant="outline" disabled={locked}>
              Change listing
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <EmptyState
          icon={Link2Off}
          title="No Google listing linked"
          description="Link a listing to start reading reviews and replying from RepKey."
          action={
            <Button disabled={locked} size="sm">
              Connect Google
            </Button>
          }
        />
      )}
    </div>
  )
}

export function PeopleSection({ ctx }: SectionProps) {
  const p = ctx.property
  if (p === null) return null
  return <PeopleCard ctx={ctx} property={p} />
}

function PeopleCard({
  ctx,
  property: p,
}: Readonly<{ ctx: SectionProps['ctx']; property: PropertyFixture }>) {
  const managers = ctx.data.members.filter((m) => m.role === 'PropertyManager')
  const initial = Object.fromEntries(
    managers.map((m) => [m.id, p.managerIds.includes(m.id)]),
  )
  const form = usePrototypeForm(initial)
  const chosen = managers.filter((m) => form.value[m.id]).length
  return (
    <div className="space-y-5">
      {chosen === 0 ? (
        <Alert variant="warning">
          <AlertTitle>No one is responsible yet</AlertTitle>
          <AlertDescription>
            New reviews and private feedback have nobody to go to.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle as="h3">Responsible managers</CardTitle>
          <CardDescription>
            They are told first about new reviews and private feedback here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="max-h-80 divide-y overflow-auto rounded-lg border">
            {managers.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <Checkbox
                  id={`people-${m.id}`}
                  checked={form.value[m.id] === true}
                  onCheckedChange={(next) => form.set({ [m.id]: next === true })}
                />
                <Label
                  htmlFor={`people-${m.id}`}
                  className="flex-1 flex-col items-start gap-0"
                >
                  <span>
                    {m.name}
                    {m.isViewer ? ' (you)' : ''}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {m.email}
                  </span>
                </Label>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter>
          <SaveRow form={form} />
        </CardFooter>
      </Card>
    </div>
  )
}

export function PortalsSection({ ctx }: SectionProps) {
  const p = ctx.property
  if (p === null) return null
  const liveNames = p.portals.names.slice(0, p.portals.live)
  const draftNames = p.portals.names.slice(p.portals.live)
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Portals</CardTitle>
        <CardDescription>
          Where guests leave a rating. Each portal has its own wording and publish step.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border">
          {liveNames.map((name) => (
            <li
              key={name}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              {name}
              <Badge variant="positive">Live</Badge>
            </li>
          ))}
          {draftNames.map((name) => (
            <li
              key={name}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              {name}
              <Badge variant="neutral">To publish</Badge>
            </li>
          ))}
          {p.portals.names.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted-foreground">No portals yet.</li>
          ) : null}
        </ul>
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline">
          {p.isReal ? (
            <Link to="/properties/$propertyId/portals" params={{ propertyId: p.id }}>
              Open portals
            </Link>
          ) : (
            <Link to="/portals">Open portals</Link>
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}
