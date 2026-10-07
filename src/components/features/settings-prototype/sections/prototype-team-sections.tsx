// PROTOTYPE — Team: Team & access, Workspace (the organization's identity, which stops
// being called "organization"), and Google accounts (shown from 2 properties).
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
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import type { MemberFixture } from '../settings-prototype-types'
import {
  LockedNotice,
  SaveRow,
  TextRow,
  type SectionProps,
} from './prototype-section-kit'
import { usePrototypeForm } from './use-prototype-form'

const ROLE: StatusMap<MemberFixture['role']> = {
  AccountAdmin: { label: 'Account admin', tone: 'positive' },
  PropertyManager: { label: 'Property manager', tone: 'neutral' },
  Member: { label: 'Member', tone: 'neutral' },
}

export function TeamSection({ ctx }: SectionProps) {
  const locked = ctx.shape.access.team === 'lock'
  const { members } = ctx.data
  return (
    <div className="space-y-5">
      {locked ? <LockedNotice ctx={ctx} what="You can see who is on the team." /> : null}
      <Card>
        <CardHeader>
          <CardTitle as="h3">People ({members.length})</CardTitle>
          <CardDescription>Everyone with access, and what they can do.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="max-h-[28rem] divide-y overflow-auto rounded-lg border">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {m.name}
                    {m.isViewer ? ' (you)' : ''}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {m.email}
                  </span>
                </span>
                {m.status === 'invited' ? <Badge variant="warn">Invited</Badge> : null}
                <StatusBadge status={m.role} map={ROLE} />
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter>
          <Button disabled={locked}>Invite people</Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export function WorkspaceSection({ ctx }: SectionProps) {
  const { workspace } = ctx.data
  const form = usePrototypeForm({
    name: workspace.name,
    contactEmail: workspace.contactEmail,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Workspace</CardTitle>
        <CardDescription>
          The account your team and your locations live under.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <TextRow
          id="workspace-name"
          label="Workspace name"
          value={form.value.name}
          onChange={(name) => form.set({ name })}
        />
        <TextRow
          id="workspace-email"
          label="Contact email"
          type="email"
          value={form.value.contactEmail}
          onChange={(contactEmail) => form.set({ contactEmail })}
        />
        <DescriptionList stacked>
          <DescriptionItem term="Short name" note="Used in links. Cannot be changed.">
            {workspace.slug}
          </DescriptionItem>
        </DescriptionList>
        <div className="flex items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-lg border bg-muted text-lg font-semibold">
            {workspace.name.slice(0, 2).toUpperCase()}
          </div>
          <Button variant="outline">Upload logo</Button>
        </div>
      </CardContent>
      <CardFooter>
        <SaveRow form={form} />
      </CardFooter>
    </Card>
  )
}

export function GoogleAccountsSection({ ctx }: SectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Google accounts ({ctx.data.googleAccounts.length})</CardTitle>
        <CardDescription>
          Each location reads and answers reviews through one of these.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border">
          {ctx.data.googleAccounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{account.email}</span>
                <span className="block text-xs text-muted-foreground">
                  Used by {account.propertyCount}{' '}
                  {account.propertyCount === 1 ? 'location' : 'locations'}
                </span>
              </span>
              <Button variant="outline" size="sm">
                Reconnect
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button variant="outline">Connect another account</Button>
      </CardFooter>
    </Card>
  )
}
