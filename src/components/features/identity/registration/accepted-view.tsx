import { InlineLink } from '#/components/ui/inline-link'
import { AuthCard } from '#/components/layout/auth-layout'

type Props = Readonly<{ organizationName?: string; staff?: boolean }>

/** Shown once an invitation is accepted, from the link or from the list. */
export function AcceptedView({ organizationName, staff = false }: Props) {
  return (
    <AuthCard
      title="Welcome to the team!"
      description={
        organizationName
          ? `You've joined ${organizationName}.`
          : "You've successfully joined the organization."
      }
    >
      <div className="text-center">
        <InlineLink to={staff ? '/my' : '/properties'} className="text-sm">
          {staff ? 'Go to your code' : 'Go to your workspace'}
        </InlineLink>
      </div>
    </AuthCard>
  )
}
