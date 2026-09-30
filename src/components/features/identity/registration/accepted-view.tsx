import { Link } from '@tanstack/react-router'
import { AuthCard } from '#/components/layout/auth-layout'

type Props = Readonly<{ organizationName?: string }>

/** Shown once an invitation is accepted, from the link or from the list. */
export function AcceptedView({ organizationName }: Props) {
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
        <Link
          to="/properties"
          className="text-sm font-medium text-link underline-offset-4 hover:underline"
        >
          Go to your workspace
        </Link>
      </div>
    </AuthCard>
  )
}
