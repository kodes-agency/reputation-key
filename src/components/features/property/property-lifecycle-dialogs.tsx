import { useState } from 'react'
import { Archive, Link2Off, RotateCcw, Trash2 } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'
import { Button } from '#/components/ui/button'
import { describedByOf, FormFieldFrame } from '#/components/forms/form-field-frame'
import { Textarea } from '#/components/ui/textarea'

const ARCHIVE_NOTE_HELP =
  'Add a short note (3–500 characters) for your management record.'

export type ArchiveLifecycleAction = Action<{
  data: Readonly<{ propertyId: string; reason: string }>
}>
export type TargetLifecycleAction = Action<{
  data: Readonly<{ propertyId: string }>
}>

export function PropertyRemoveDialog({
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
  return (
    <ConfirmationDialog
      trigger={
        <ConfirmationTrigger tone="destructive" disabled={disabled}>
          <Trash2 aria-hidden="true" />
          Remove from workspace
        </ConfirmationTrigger>
      }
      title={`Remove ${propertyName} from your workspace?`}
      // Deliberately explicit that this is not destruction. Calling it "delete"
      // while a 30-day restore window is running would be a lie the operator
      // only discovers when they go looking for data they thought was gone.
      description="It leaves your property list and navigation, and its Google connection is disconnected so no further reviews or reports are collected. Nothing is deleted — reviews, settings and history are retained, and you can restore it from the Removed list for 30 days."
      cancelLabel="Keep property"
      confirmLabel="Remove property"
      pendingLabel="Removing…"
      tone="destructive"
      onConfirm={() => action({ data: { propertyId, reason: 'Removed from workspace' } })}
    />
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
        <ConfirmationTrigger tone="neutral" disabled={disabled}>
          <Archive aria-hidden="true" />
          Archive property
        </ConfirmationTrigger>
      }
      title={`Archive ${propertyName}?`}
      description="Guests and new provider work will pause. Retained settings, reviews, manager work, metrics, and identifiers stay in place, and you have 30 days to restore the Property yourself."
      cancelLabel="Keep property active"
      confirmLabel="Archive property"
      pendingLabel="Archiving…"
      confirmDisabled={!valid}
      onOpenChange={(open) => {
        if (!open) setReason('')
      }}
      onConfirm={() => action({ data: { propertyId, reason: normalizedReason } })}
    >
      <FormFieldFrame
        id="property-archive-reason"
        label="Archive note"
        description={ARCHIVE_NOTE_HELP}
        invalid={false}
      >
        <Textarea
          id="property-archive-reason"
          value={reason}
          maxLength={500}
          placeholder="For example: Property is temporarily closed"
          onChange={(event) => setReason(event.target.value)}
          aria-describedby={describedByOf('property-archive-reason', ARCHIVE_NOTE_HELP)}
        />
      </FormFieldFrame>
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
          Restore property
        </Button>
      }
      title={`Restore ${propertyName}?`}
      description="Current Responsible Manager, Data Cell, and Google binding readiness will be checked again. If Google needs reconnection, the Property will restore without silently restarting provider work."
      cancelLabel="Keep archived"
      confirmLabel="Restore property"
      pendingLabel="Restoring…"
      onConfirm={() => action({ data: { propertyId } })}
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
        <ConfirmationTrigger tone="destructive" disabled={disabled}>
          <Link2Off aria-hidden="true" />
          Disconnect this property from Google
        </ConfirmationTrigger>
      }
      title={`Disconnect Google from ${propertyName}?`}
      description="This stops this archived Property from using its current Google profile binding. Your Organization's Google connection stays available to other Properties, and this Property's retained history stays in place."
      cancelLabel="Keep connected"
      confirmLabel="Disconnect this property"
      pendingLabel="Disconnecting…"
      tone="destructive"
      onConfirm={() => action({ data: { propertyId } })}
    />
  )
}
