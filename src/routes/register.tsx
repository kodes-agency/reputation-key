// Register page — creates user + organization in one step
// B0.6: Registration is gated behind the identity.register capability.
// In beta, this capability is OFF by default — only operators can enable it.
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { getSession, ensureActiveOrg } from '#/shared/auth/auth.functions'
import {
  assertGlobalCapability,
  BetaCapabilityError,
} from '#/shared/auth/beta-capabilities'
import { AuthCard, AuthFooterLink } from '#/components/layout/auth-layout'
import { RegisterForm } from '#/components/features/identity'
import { registerUserAndOrg } from '#/contexts/identity/server/organizations'
import { useAction, wrapAction } from '#/components/hooks/use-action'

export const Route = createFileRoute('/register')({
  beforeLoad: async () => {
    // B0.6: Block registration unless the identity.register capability is on.
    try {
      assertGlobalCapability('identity.register')
    } catch (err) {
      if (err instanceof BetaCapabilityError) {
        throw redirect({ to: '/login' })
      }
      throw err
    }
    const session = await getSession()
    if (session) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: RegisterPage,
})

function RegisterPage() {
  const register = useAction(useServerFn(registerUserAndOrg))

  const mutation = wrapAction(register, async () => {
    await ensureActiveOrg()
  })

  if (mutation.isSuccess) {
    return (
      <AuthCard
        title="Account created!"
        description="Your account and organization are ready. Sign in to get started."
      >
        <div className="text-center">
          <Link
            to="/login"
            className="text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            Sign in to your account
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Create your account" description="Get started with Reputation Key">
      <RegisterForm mode="register" mutation={mutation} />
      <AuthFooterLink message="Already have an account?" linkText="Sign in" to="/login" />
    </AuthCard>
  )
}
