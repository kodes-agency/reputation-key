// Shared auth UI components — eliminates duplication across login/join/reset pages.
// AuthCard and AuthFooterLink are identity-specific layout components.
// For error display, use FormErrorBanner from components/forms/ directly.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { InlineLink } from '#/components/ui/inline-link'

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
          <CardTitle as="h1" className="text-2xl">
            {title}
          </CardTitle>
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
  to: '/login' | '/join' | '/reset-password' | '/dashboard' | '/accept-invitation'
}>

export function AuthFooterLink({ message, linkText, to }: AuthFooterLinkProps) {
  return (
    <p className="mt-6 text-center text-sm text-muted-foreground">
      {message} <InlineLink to={to}>{linkText}</InlineLink>
    </p>
  )
}
