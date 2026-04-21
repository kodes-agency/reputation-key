// Shared auth UI components — eliminates duplication across login/register/reset pages
import { Link } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

interface ErrorBannerProps {
  message: string | null
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
      {message}
    </div>
  )
}

interface AuthCardProps {
  title: string
  description: string
  children: React.ReactNode
}

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

interface AuthFooterLinkProps {
  message: string
  linkText: string
  to: '/login' | '/register' | '/reset-password'
}

export function AuthFooterLink({ message, linkText, to }: AuthFooterLinkProps) {
  return (
    <p className="mt-6 text-center text-sm text-[var(--sea-ink-soft)]">
      {message}{' '}
      <Link
        to={to}
        className="font-medium text-[var(--lagoon)] no-underline hover:underline"
      >
        {linkText}
      </Link>
    </p>
  )
}
