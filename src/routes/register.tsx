// Register page — creates user + organization in one step
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { getSession, ensureActiveOrg } from '#/shared/auth/auth.functions'
import { AuthCard, AuthFooterLink } from '#/components/features/identity/AuthLayout'
import { RegisterForm } from '#/components/features/identity/RegisterForm'
import { registerUserAndOrg } from '#/contexts/identity/server/organizations'
import type { RegisterUserInput } from '#/contexts/identity/application/dto/invitation.dto'
import { useState } from 'react'

export const Route = createFileRoute('/register')({
  beforeLoad: async () => {
    const session = await getSession()
    if (session) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: RegisterPage,
})

function RegisterPage() {
  const [success, setSuccess] = useState(false)

  const mutation = useMutation({
    mutationFn: (input: RegisterUserInput) => registerUserAndOrg({ data: input }),
    // Per architecture: "The mutation is defined in the route, not in the form component."
    // onSuccess drives the UI state change — the form component just submits.
    onSuccess: async () => {
      await ensureActiveOrg()
      setSuccess(true)
    },
  })

  if (success) {
    return (
      <AuthCard
        title="Account created!"
        description="Your account and organization are ready. Sign in to get started."
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
    <AuthCard title="Create your account" description="Get started with Reputation Key">
      <RegisterForm mode="register" mutation={mutation} />
      <AuthFooterLink message="Already have an account?" linkText="Sign in" to="/login" />
    </AuthCard>
  )
}
