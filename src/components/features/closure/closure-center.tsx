// LIF-01-T17 — the Closure Center.
//
// An authenticated, READ-ONLY status surface for designated AccountAdmins,
// plus exactly four commands: request a closure, cancel one, request/retrieve
// an export, and (once cancelled) explicitly reactivate.
//
// POSTURE (program bullet 8): the request is gated by a TYPED CONFIRMATION and
// nothing else. There is no password field, no MFA prompt and no step-up
// challenge anywhere on this page or on the export retrieval path — MFA is a
// dark capability, and introducing an authentication factor here would change
// the beta's authentication posture through a settings screen. Typing the
// organization name proves INTENT; the session and the server-side AccountAdmin
// re-check prove IDENTITY.

import { useState } from 'react'
import {
  ClosureReadOnlyNotice,
  ClosureRequestError,
  ClosureUnavailableNotice,
} from './closure-request-notices'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { AnyAction } from '#/components/hooks/use-action'
import type { ClosureCenterView } from '#/contexts/identity/application/dto/organization-closure.dto'
import { ClosureStatusCard } from './closure-status-card'
import { OrganizationExportPanel } from './organization-export-panel'
import { ReactivationChecklist } from './reactivation-checklist'

const REQUEST_REASONS = [
  { value: 'account_admin_request', label: 'We no longer need this workspace' },
  { value: 'contract_ended', label: 'Our contract ended' },
  { value: 'duplicate_workspace', label: 'This is a duplicate workspace' },
  { value: 'privacy_request', label: 'Privacy request' },
  { value: 'test_workspace', label: 'This was a test workspace' },
] as const

export type ClosureCenterProps = Readonly<{
  view: ClosureCenterView
  requestClosure: AnyAction
  cancelClosure: AnyAction
  reactivate: AnyAction
  requestExport: AnyAction
  issueRetrieval: AnyAction
  downloadExport: AnyAction
  onArchive?: (input: Readonly<{ filename: string; archiveBase64: string }>) => void
}>

export function ClosureCenter({
  view,
  requestClosure,
  cancelClosure,
  reactivate,
  requestExport,
  issueRetrieval,
  downloadExport,
  onArchive,
}: ClosureCenterProps) {
  const [typedConfirmation, setTypedConfirmation] = useState('')
  const [reasonCode, setReasonCode] = useState<(typeof REQUEST_REASONS)[number]['value']>(
    'account_admin_request',
  )
  const [supportEvidenceRef, setSupportEvidenceRef] = useState('')

  const confirmationMatches = typedConfirmation === view.confirmationPhrase
  const evidenceValid = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u.test(supportEvidenceRef)
  // Availability first, and server-computed: arming this control where closure
  // is refused would offer a destructive action that can only 403.
  const canRequestClosure =
    view.closureRequestAvailable && view.state === 'active' && !view.reactivationRequired
  const awaitingReactivation = view.state === 'active' && view.reactivationRequired

  return (
    <div className="space-y-6" data-testid="closure-center">
      <ClosureStatusCard view={view} />

      {view.state === 'active' && !view.closureRequestAvailable ? (
        <ClosureUnavailableNotice />
      ) : null}

      {view.state !== 'active' ? <ClosureReadOnlyNotice /> : null}

      <OrganizationExportPanel
        organizationExport={view.export}
        timezone={view.timezone}
        requestExport={requestExport}
        issueRetrieval={issueRetrieval}
        downloadExport={downloadExport}
        onArchive={onArchive}
      />

      {view.cancellable ? (
        <Card data-testid="cancel-closure-card">
          <CardHeader>
            <CardTitle>Cancel this closure</CardTitle>
            <CardDescription>
              Cancelling stops the deletion. It does not resume the workspace — you will
              have to reactivate it deliberately afterwards.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant="outline"
              disabled={cancelClosure.isPending}
              data-testid="cancel-closure"
              onClick={() =>
                void cancelClosure({
                  data: {
                    reasonCode: 'closure_cancelled',
                    supportEvidenceRef: 'closure-center:cancel',
                  },
                })
              }
            >
              Cancel closure
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {awaitingReactivation ? (
        <ReactivationChecklist checks={view.reactivationChecks} reactivate={reactivate} />
      ) : null}

      {canRequestClosure ? (
        <Card data-testid="request-closure-card">
          <CardHeader>
            <CardTitle>Close this organization</CardTitle>
            <CardDescription>
              The workspace becomes read only immediately. Nothing is deleted until the
              recovery deadline passes, and you can cancel at any point before it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="closure-reason">Reason</Label>
              <Select
                value={reasonCode}
                onValueChange={(next) =>
                  setReasonCode(next as (typeof REQUEST_REASONS)[number]['value'])
                }
              >
                <SelectTrigger id="closure-reason" data-testid="closure-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_REASONS.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="closure-evidence">Your reference</Label>
              <Input
                id="closure-evidence"
                value={supportEvidenceRef}
                onChange={(event) => setSupportEvidenceRef(event.target.value)}
                placeholder="ticket-1234"
                data-testid="closure-evidence"
              />
              <p className="text-muted-foreground text-xs">
                A short identifier for your own records. Letters, numbers and
                <code> : _ . / -</code> only — do not put customer details here.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="closure-confirmation">
                Type <span className="font-mono">{view.confirmationPhrase}</span> to
                confirm
              </Label>
              <Input
                id="closure-confirmation"
                value={typedConfirmation}
                onChange={(event) => setTypedConfirmation(event.target.value)}
                autoComplete="off"
                data-testid="closure-confirmation"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant="destructive"
              disabled={
                !confirmationMatches || !evidenceValid || requestClosure.isPending
              }
              data-testid="request-closure"
              onClick={() => {
                // Rendered, not floated: dropping the rejection turned a
                // deliberate refusal into an uncaught error.
                requestClosure({
                  data: { reasonCode, supportEvidenceRef, typedConfirmation },
                }).catch(() => undefined)
              }}
            >
              Request closure
            </Button>
            <ClosureRequestError error={requestClosure.error} />
          </CardFooter>
        </Card>
      ) : null}
    </div>
  )
}
