// Shared auth UI components — eliminates duplication across login/register/reset pages.
// AuthCard and AuthFooterLink are identity-specific layout components.
// For error display, use FormErrorBanner from components/forms/ directly.

import { Link } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { AlertCircle } from 'lucide-react'

// Backwards-compatible error banner for routes still being migrated.
// New code should import FormErrorBanner directly from components/forms/.
// accept-invitation.tsx uses this because it has a plain string error, not a mutation error.
export function ErrorBanner({ message }: Readonly<{ message: string | null }>) {
  if (!message) return null
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

type AuthCardProps = Readonly<{
  title: string
  description: string
  children: React.ReactNode
}>

export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <div className="page-wrap flex min-h-[60vh] items-center justify-center px-4 pb-8 pt-14">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

type AuthFooterLinkProps = Readonly<{
  message: string
  linkText: string
  to:
    | '/login'
    | '/register'
    | '/join'
    | '/reset-password'
    | '/dashboard'
    | '/accept-invitation'
}>

export function AuthFooterLink({ message, linkText, to }: AuthFooterLinkProps) {
  return (
    <p className="mt-6 text-center text-sm text-muted-foreground">
      {message}{' '}
      <Link
        to={to}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {linkText}
      </Link>
    </p>
  )
}
