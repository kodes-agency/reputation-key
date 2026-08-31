import { useState, type ReactNode } from 'react'
import { Archive, Link2Off, RotateCcw } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'

export type ArchiveLifecycleAction = Action<{
  data: Readonly<{ propertyId: string; reason: string }>
}>
export type TargetLifecycleAction = Action<{
  data: Readonly<{ propertyId: string }>
}>

function ConfirmationDialog({
  trigger,
  title,
  description,
  cancelLabel,
  confirmLabel,
  pendingLabel,
  pending,
  confirmDisabled = false,
  onConfirm,
  onOpenChange,
  children,
}: Readonly<{
  trigger: ReactNode
  title: string
  description: string
  cancelLabel: string
  confirmLabel: string
  pendingLabel: string
  pending: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}>) {
  return (
    <AlertDialog onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction disabled={pending || confirmDisabled} onClick={onConfirm}>
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function PropertyArchiveDialog({
  propertyId,
  propertyName,
  action,
  disabled,
}: Readonly<{
  propertyId: string
  propertyName: string
  action: ArchiveLifecycleAction
  disabled: boolean
}>) {
  const [reason, setReason] = useState('')
  const normalizedReason = reason.trim()
  const valid = normalizedReason.length >= 3 && normalizedReason.length <= 500
  return (
    <ConfirmationDialog
      trigger={
        <Button variant="outline" disabled={disabled}>
          <Archive aria-hidden="true" />
          Archive Property
        </Button>
      }
      title={`Archive ${propertyName}?`}
      description="Guests and new provider work will pause. Retained settings, reviews, manager work, metrics, and identifiers stay in place, and you have 30 days to restore the Property yourself."
      cancelLabel="Keep Property active"
      confirmLabel="Archive Property"
      pendingLabel="Archiving…"
      pending={action.isPending}
      confirmDisabled={!valid}
      onOpenChange={(open) => {
        if (!open) setReason('')
      }}
      onConfirm={() => {
        void action({ data: { propertyId, reason: normalizedReason } }).catch(
          () => undefined,
        )
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="property-archive-reason">Archive note</Label>
        <Textarea
          id="property-archive-reason"
          value={reason}
          maxLength={500}
          placeholder="For example: Property is temporarily closed"
          onChange={(event) => setReason(event.target.value)}
          aria-describedby="property-archive-reason-help"
        />
        <p id="property-archive-reason-help" className="text-xs text-muted-foreground">
          Add a short note (3–500 characters) for your management record.
        </p>
      </div>
    </ConfirmationDialog>
  )
}

export function PropertyRestoreDialog({
  propertyId,
  propertyName,
  action,
  disabled,
}: Readonly<{
  propertyId: string
  propertyName: string
  action: TargetLifecycleAction
  disabled: boolean
}>) {
  return (
    <ConfirmationDialog
      trigger={
        <Button disabled={disabled}>
          <RotateCcw aria-hidden="true" />
          Restore Property
        </Button>
      }
      title={`Restore ${propertyName}?`}
      description="Current Responsible Manager, Data Cell, and Google binding readiness will be checked again. If Google needs reconnection, the Property will restore without silently restarting provider work."
      cancelLabel="Keep archived"
      confirmLabel="Restore Property"
      pendingLabel="Restoring…"
      pending={action.isPending}
      onConfirm={() => {
        void action({ data: { propertyId } }).catch(() => undefined)
      }}
    />
  )
}

export function PropertyGoogleDisconnectDialog({
  propertyId,
  propertyName,
  action,
  disabled,
}: Readonly<{
  propertyId: string
  propertyName: string
  action: TargetLifecycleAction
  disabled: boolean
}>) {
  return (
    <ConfirmationDialog
      trigger={
        <Button variant="outline" disabled={disabled}>
          <Link2Off aria-hidden="true" />
          Disconnect this Property from Google
        </Button>
      }
      title={`Disconnect Google from ${propertyName}?`}
      description="This stops this archived Property from using its current Google profile binding. Your Organization's Google connection stays available to other Properties, and this Property's retained history stays in place."
      cancelLabel="Keep connected"
      confirmLabel="Disconnect this Property"
      pendingLabel="Disconnecting…"
      pending={action.isPending}
      onConfirm={() => {
        void action({ data: { propertyId } }).catch(() => undefined)
      }}
    />
  )
}
