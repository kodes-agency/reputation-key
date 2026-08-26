import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut, Moon, Sun, Monitor } from 'lucide-react'
import { SidebarTrigger } from '#/components/ui/sidebar'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { authClient } from '#/shared/auth/auth-client'
import { NotificationPanel } from '#/components/features/notification/notification-panel'
import type { NotificationServerFns } from '#/components/features/notification/types'
import { useThemeMode } from '#/components/hooks/use-theme-mode'
import { BetaFeedbackLauncher } from '#/components/features/beta-feedback/beta-feedback-launcher'
import type { SubmitBetaFeedback } from '#/components/features/beta-feedback/beta-feedback-form-context'
import { clearTenantCacheAfterSessionEnd } from '#/shared/queries/tenant-cache-transition'

type Props = Readonly<{
  user: { id: string; name: string; email: string; image: string | null }
  organizationId: string
  notificationFns: NotificationServerFns
  submitBetaFeedback?: SubmitBetaFeedback
}>

export function AppTopBar({
  user,
  organizationId,
  notificationFns,
  submitBetaFeedback,
}: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { mode, setMode } = useThemeMode()

  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor

  const initials = user.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U'

  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />

      <div className="flex-1" />

      {/* Notifications + User menu */}
      {submitBetaFeedback && <BetaFeedbackLauncher submitFeedback={submitBetaFeedback} />}
      <NotificationPanel
        notificationFns={notificationFns}
        organizationId={organizationId}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label="Account menu"
          >
            {user.image ? (
              <img src={user.image} alt="" className="size-7 rounded-full object-cover" />
            ) : (
              <div className="flex size-7 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {initials}
              </div>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              setMode(mode === 'dark' ? 'light' : mode === 'light' ? 'auto' : 'dark')
            }
          >
            <ThemeIcon className="size-4" />
            {mode === 'dark'
              ? 'Light mode'
              : mode === 'light'
                ? 'System theme'
                : 'Dark mode'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await clearTenantCacheAfterSessionEnd(
                queryClient,
                () => authClient.signOut(),
                () => navigate({ to: '/login' }),
              )
            }}
          >
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
