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
import { SecuritySettingsForm } from '#/contexts/identity/members/ui/security-settings-form'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { useSignOut } from '#/components/hooks/use-sign-out'
import { invalidateShellContext } from '#/shared/queries/shell-context-cache'
import type { StaffHomeFns } from './types'

const FeedbackBody = lazy(
  () => import('#/contexts/identity/feedback/ui/beta-feedback-dialog-body'),
)

export function StaffAccountMenu({ fns }: Readonly<{ fns: StaffHomeFns }>) {
  const [panel, setPanel] = useState<'password' | 'report' | null>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  const password = useActionMutation(fns.changePassword, {
    successMessage: 'Password updated',
    onSuccess: () => {
      invalidateShellContext(client)
      setPanel(null)
    },
  })
  const leave = useSignOut({ onSignedOut: () => navigate({ to: '/login' }) })
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
            onSelect={() => void leave().catch(() => undefined)}
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
                staff
              />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
