import { lazy, Suspense, useState } from 'react'
import { UserRound } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { IconButton } from '#/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#/components/ui/dialog'
import { SecuritySettingsForm } from '#/components/features/identity/security-settings-form'
import {
  useActionMutation,
  actionErrorMessage,
} from '#/components/hooks/use-action-mutation'
import { authClient } from '#/shared/auth/auth-client'
import { clearTenantCacheAfterSessionEnd } from '#/shared/queries/tenant-cache-transition'
import { invalidateShellContext } from '#/shared/queries/shell-context-cache'
import { useThemeMode } from '#/components/hooks/use-theme-mode'
import type { StaffHomeFns } from './types'

const FeedbackBody = lazy(
  () => import('#/components/features/beta-feedback/beta-feedback-dialog-body'),
)

export function StaffAccountMenu({ fns }: Readonly<{ fns: StaffHomeFns }>) {
  const [panel, setPanel] = useState<'password' | 'report' | null>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  useThemeMode()
  const password = useActionMutation(fns.changePassword, {
    successMessage: 'Password updated',
    onSuccess: () => {
      invalidateShellContext(client)
      setPanel(null)
    },
  })
  const leave = useActionMutation(
    async () =>
      clearTenantCacheAfterSessionEnd(
        client,
        async () => {
          const result = await authClient.signOut()
          if (result.error) throw new Error('Could not sign out. Please try again.')
        },
        () => navigate({ to: '/login' }),
      ),
    { errorMessage: actionErrorMessage },
  )
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Account menu" variant="ghost">
            <UserRound />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPanel('password')}>
            Change password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPanel('report')}>
            Report a problem
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={leave.isPending}
            onSelect={() => void leave(undefined).catch(() => undefined)}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null)
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {panel === 'password' ? 'Change password' : 'Report a problem'}
            </DialogTitle>
            <DialogDescription className="sr-only">Your account</DialogDescription>
          </DialogHeader>
          {panel === 'password' ? (
            <SecuritySettingsForm changePassword={password} staff />
          ) : (
            <Suspense fallback={<p role="status">Loading…</p>}>
              <FeedbackBody
                submitFeedback={fns.submitFeedback}
                listFeedback={fns.listFeedback}
                onReportsSeen={() => undefined}
                initialPanel="report"
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
