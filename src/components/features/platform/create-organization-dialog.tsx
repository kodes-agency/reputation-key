// "New Organization" (ADR 0063): the dialog the operator creates an
// Organization from, and the result it ends on. The body mounts on every open,
// so a second Organization starts from an empty form with no stale error.

import { useState } from 'react'
import { CheckCircle2, TriangleAlert, Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { useAction, type Action } from '#/components/hooks/use-action'
import type {
  ProvisionOrganizationInput,
  ProvisionOrganizationResult,
} from '#/contexts/identity/application/dto/platform-console.dto'
import { CreateOrganizationForm } from './create-organization-form'

export type ProvisionOrganizationAction = Action<
  { data: ProvisionOrganizationInput },
  ProvisionOrganizationResult
>

type CreatedProps = Readonly<{
  result: ProvisionOrganizationResult
  adminEmail: string
}>

function CreatedOrganization({ result, adminEmail }: CreatedProps) {
  const Icon = result.emailSent ? CheckCircle2 : TriangleAlert
  return (
    <>
      <DialogHeader>
        <DialogTitle>Organization created</DialogTitle>
        <DialogDescription>
          <code className="font-mono">{result.slug}</code> is listed, with no members yet.
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-start gap-3 text-sm" role="status">
        <Icon
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 ${result.emailSent ? 'text-positive' : 'text-warn'}`}
        />
        {result.emailSent ? (
          <p>
            An invitation went to <strong className="font-medium">{adminEmail}</strong>.
            They join as the Organization&apos;s Account Admin.
          </p>
        ) : (
          <p>
            The invitation for <strong className="font-medium">{adminEmail}</strong>{' '}
            exists, but its email could not be sent. Use Resend on the Organization&apos;s
            row.
          </p>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
      </DialogFooter>
    </>
  )
}

function NewOrganizationBody({
  provision,
}: Readonly<{ provision: ProvisionOrganizationAction }>) {
  // Own state over the shared Action: a fresh open starts with no result and no error.
  const create = useAction(provision)
  const [adminEmail, setAdminEmail] = useState('')

  if (create.data) {
    return <CreatedOrganization result={create.data} adminEmail={adminEmail} />
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>New Organization</DialogTitle>
        <DialogDescription>
          Create an Organization and invite its first Account Admin. You are not added to
          it.
        </DialogDescription>
      </DialogHeader>
      <CreateOrganizationForm provision={create} onAttempt={setAdminEmail} />
    </>
  )
}

type Props = Readonly<{ provision: ProvisionOrganizationAction }>

export function CreateOrganizationDialog({ provision }: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          New Organization
        </Button>
      </DialogTrigger>
      <DialogContent>
        <NewOrganizationBody provision={provision} />
      </DialogContent>
    </Dialog>
  )
}
