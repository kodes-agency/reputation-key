// Password reset request and completion page
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { authClient } from '#/shared/auth/auth-client'
import { AuthCard, AuthFooterLink } from '#/components/layout/auth-layout'
import { ResetPasswordForm, SetNewPasswordForm } from '#/components/features/identity'
import { useAction } from '#/components/hooks/use-action'

const resetPasswordSearch = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
})

export const Route = createFileRoute('/reset-password')({
  validateSearch: resetPasswordSearch,
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { token, error } = Route.useSearch()

  if (error) {
    return (
      <AuthCard
        title="Reset link expired"
        description="This password reset link is invalid or has expired. Request a new link to try again."
      >
        <div className="text-center">
          <Link
            to="/reset-password"
            className="text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            Request a new reset link
          </Link>
        </div>
      </AuthCard>
    )
  }

  if (token) return <CompletePasswordReset token={token} />

  return <RequestPasswordReset />
}

function CompletePasswordReset({ token }: Readonly<{ token: string }>) {
  const mutation = useAction(
    async (input: { newPassword: string; confirmPassword: string }) => {
      const result = await authClient.resetPassword({
        newPassword: input.newPassword,
        token,
      })
      if (result.error) {
        const invalidToken = result.error.code === 'INVALID_TOKEN'
        throw Object.assign(
          new Error(
            invalidToken
              ? 'This reset link is invalid or expired.'
              : (result.error.message ?? 'Failed to reset password.'),
          ),
          {
            _tag: 'AuthClientError' as const,
            code: invalidToken
              ? ('invalid_reset_token' as const)
              : ('reset_failed' as const),
          },
        )
      }
      return result.data
    },
  )

  if (mutation.isSuccess) {
    return (
      <AuthCard
        title="Password updated"
        description="Your password has been reset. You can now sign in with your new password."
      >
        <div className="text-center">
          <Link
            to="/login"
            className="text-sm font-medium text-link underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Enter a new password with at least 8 characters."
    >
      <SetNewPasswordForm mutation={mutation} />
    </AuthCard>
  )
}

function RequestPasswordReset() {
  const mutation = useAction(async (input: { email: string }) => {
    const result = await authClient.requestPasswordReset({
      email: input.email,
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (result.error) {
      throw Object.assign(
        new Error(result.error.message ?? 'Failed to send reset email.'),
        { _tag: 'AuthClientError' as const, code: 'reset_failed' as const },
      )
    }
    return input.email
  })

  if (mutation.data) {
    return (
      <AuthCard
        title="Check your email"
        description={`If an account exists for ${mutation.data}, you'll receive a password reset link shortly.`}
      >
        <div className="text-center">
          <Link
            to="/login"
            className="text-sm font-medium text-link underline-offset-4 hover:underline"
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
