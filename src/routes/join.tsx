// Join page — creates user account only (no organization).
// Used by invited members who don't have an account yet.
// After registration, redirects to the invitation acceptance page (via ?redirect= param).
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { getSession } from '#/shared/auth/auth.functions'
import { AuthCard, AuthFooterLink } from '#/components/layout/auth-layout'
import { RegisterForm } from '#/components/features/identity'
import { registerMember } from '#/contexts/identity/server/organizations'
import { useAction, wrapAction } from '#/components/hooks/use-action'
import { useState } from 'react'

export const Route = createFileRoute('/join')({
  beforeLoad: async () => {
    const session = await getSession()
    if (session) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: JoinPage,
})

function JoinPage() {
  const search = Route.useSearch() as { redirect?: string }
  const router = useRouter()
  const [success, setSuccess] = useState(false)
  const register = useAction(useServerFn(registerMember))

  const mutation = wrapAction(register, async () => {
    await router.invalidate()
    if (search.redirect) {
      router.history.push(search.redirect)
    } else {
      setSuccess(true)
    }
  })

  if (success) {
    return (
      <AuthCard
        title="Account created!"
        description="Your account is ready. Sign in to get started."
      >
        <div className="text-center">
          <Link
            to="/login"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in to your account
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Create your account" description="Join your team on Reputation Key">
      <RegisterForm mode="join" mutation={mutation} />
      <AuthFooterLink message="Already have an account?" linkText="Sign in" to="/login" />
    </AuthCard>
  )
}
