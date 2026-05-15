import { Check } from 'lucide-react'

type Org = Readonly<{ id: string; name: string }>

type Props = Readonly<{
  organizations: ReadonlyArray<Org>
  activeOrganizationId: string | null
  onSwitch: (orgId: string) => Promise<void>
  isPending?: boolean
}>

export function OrganizationSwitchList({
  organizations,
  activeOrganizationId,
  onSwitch,
  isPending,
}: Props) {
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
              disabled={isActive || isPending}
              onClick={() => {
                onSwitch(org.id).catch(() => {})
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
