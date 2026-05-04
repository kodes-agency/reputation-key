import { useNavigate } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useAction } from '#/components/hooks/use-action'
import { useServerFn } from '@tanstack/react-start'
import { setActiveOrganization } from '#/contexts/identity/server/organizations'

type Org = Readonly<{ id: string; name: string }>

type Props = Readonly<{
  organizations: ReadonlyArray<Org>
  activeOrganizationId: string | null
}>

export function OrganizationSwitchList({ organizations, activeOrganizationId }: Props) {
  const navigate = useNavigate()
  const switchOrg = useAction(useServerFn(setActiveOrganization))

  if (organizations.length <= 1) return null

  return (
    <div className="rounded-lg border">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-medium">Organizations</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Switch to a different organization.
        </p>
      </div>
      <div className="divide-y">
        {organizations.map((org) => {
          const isActive = org.id === activeOrganizationId
          return (
            <button
              key={org.id}
              type="button"
              disabled={isActive || switchOrg.isPending}
              onClick={() => {
                switchOrg({ data: { organizationId: org.id } })
                  .then(() => navigate({ to: '/properties' }))
                  .catch(() => {})
              }}
              className={
                'flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-accent' +
                (isActive ? ' bg-accent/50' : '')
              }
            >
              <span className={isActive ? 'font-medium' : ''}>{org.name}</span>
              {isActive && <Check className="size-4 text-accent-foreground" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
