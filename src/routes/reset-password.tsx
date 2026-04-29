// Password reset request page
import { createFileRoute, Link } from '@tanstack/react-router'
import { authClient } from '#/shared/auth/auth-client'
import { AuthCard, AuthFooterLink } from '#/components/features/identity/AuthLayout'
import { ResetPasswordForm } from '#/components/features/identity/ResetPasswordForm'
import { useAction } from '#/components/hooks/use-action'
import { useState } from 'react'

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const [sentToEmail, setSentToEmail] = useState<string | null>(null)

  const mutation = useAction(async (input: { email: string }) => {
    const result = await authClient.requestPasswordReset({
      email: input.email,
      redirectTo: `${window.location.origin}/login`,
    })
    if (result.error) {
      throw Object.assign(
        new Error(result.error.message ?? 'Failed to send reset email.'),
        { _tag: 'AuthClientError' as const, code: 'reset_failed' as const },
      )
    }
    setSentToEmail(input.email)
    return input.email
  })

  if (sentToEmail) {
    return (
      <AuthCard
        title="Check your email"
        description={`If an account exists for ${sentToEmail}, you'll receive a password reset link shortly.`}
      >
        <div className="text-center">
          <Link
            to="/login"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we'll send you a reset link"
    >
      <ResetPasswordForm mutation={mutation} />
      <AuthFooterLink message="Remember your password?" linkText="Sign in" to="/login" />
    </AuthCard>
  )
}
