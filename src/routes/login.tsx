// Login page
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { authClient } from '#/shared/auth/auth-client'
import { AuthCard, AuthFooterLink } from '#/components/features/identity/AuthLayout'
import { LoginForm } from '#/components/features/identity/LoginForm'
import { signInUser } from '#/contexts/identity/server/organizations'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession()
    if (session) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const search = Route.useSearch() as { redirect?: string }
  const navigate = useNavigate()
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      signInUser({ data: input }),
    onSuccess: async () => {
      // After sign-in, auth cookies have changed. Invalidate the router
      // to refresh session state, then navigate to the target page.
      // Per architecture: "Never use window.location.href — it causes a hard
      // page reload, losing router state, cached queries, and session context."
      await router.invalidate()
      await navigate({ to: search.redirect ?? '/dashboard' })
    },
  })

  return (
    <AuthCard title="Welcome back" description="Sign in to your Reputation Key account">
      <LoginForm mutation={mutation} />
      <div className="mt-2 text-right">
        <Link
          to="/reset-password"
          className="text-sm text-[var(--lagoon)] no-underline hover:underline"
        >
          Forgot password?
        </Link>
      </div>
      <AuthFooterLink
        message="Don't have an account?"
        linkText="Create one"
        to="/register"
      />
    </AuthCard>
  )
}
