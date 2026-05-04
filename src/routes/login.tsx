// Login page
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { getSession, ensureActiveOrg } from '#/shared/auth/auth.functions'
import { AuthCard, AuthFooterLink } from '#/components/layout/auth-layout'
import { LoginForm } from '#/components/features/identity'
import { signInUser } from '#/contexts/identity/server/organizations'
import { useAction, wrapAction } from '#/components/hooks/use-action'

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
  const signIn = useAction(useServerFn(signInUser))

  const mutation = wrapAction(signIn, async () => {
    await ensureActiveOrg()
    await router.invalidate()
    if (search.redirect) {
      router.history.push(search.redirect)
    } else {
      await navigate({ to: '/dashboard' })
    }
  })

  return (
    <AuthCard title="Welcome back" description="Sign in to your Reputation Key account">
      <LoginForm mutation={mutation} />
      <div className="mt-2 text-right">
        <Link
          to="/reset-password"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
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
