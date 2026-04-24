// Login page
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { getSession, ensureActiveOrg } from '#/shared/auth/auth.functions'
import { AuthCard, AuthFooterLink } from '#/components/features/identity/AuthLayout'
import { LoginForm } from '#/components/features/identity/LoginForm'
import { signInUser } from '#/contexts/identity/server/organizations'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const session = await getSession()
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
      // After sign-in, ensure an org is active (handles users whose
      // registration didn't set the active org correctly).
      await ensureActiveOrg()
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
