// LIF-01-T17 — what each Organization Export state means to a tenant.
//
// Extracted from the panel so the copy that tells somebody whether they can
// still download their data is reviewable on its own, and so the panel stays
// under the file-size budget without collapsing states into one generic
// "processing" label.

import type { OrganizationExportView } from '#/contexts/identity/application/dto/organization-closure.dto'

export type ExportState = OrganizationExportView['state']

export type ExportStateCopy = Readonly<{ label: string; description: string }>

export const EXPORT_STATE_COPY: Readonly<Record<ExportState, ExportStateCopy>> = {
  requested: {
    label: 'Requested',
    description: 'Queued. The archive is built from a snapshot taken at request time.',
  },
  generating: {
    label: 'Generating',
    description: 'Collecting every context contribution into one archive.',
  },
  egress_pending: {
    label: 'Finishing upload',
    description:
      'The archive and its checksums are recorded. Confirming the encrypted upload.',
  },
  ready: {
    label: 'Ready',
    description: 'Request a single-use link to download the archive.',
  },
  retrieval_issued: {
    label: 'Link issued',
    description: 'A single-use link is active. It expires 24 hours after it was issued.',
  },
  retrieved: {
    label: 'Downloaded',
    description: 'The archive was downloaded. Request a new export to download again.',
  },
  delete_pending: {
    label: 'Expiring',
    description: 'The stored archive is being deleted.',
  },
  deleted: {
    label: 'Expired',
    description: 'The stored archive was deleted. Request a new export if you need one.',
  },
  failed: {
    label: 'Failed',
    description: 'The export could not be produced. Request a new one.',
  },
}

/**
 * A new export may only be requested when no request is still in flight —
 * the `organization_exports_one_open_per_org_idx` partial unique index refuses
 * a second open row, so offering the button would produce a server error.
 */
export function canRequestNewExport(state: ExportState | null): boolean {
  return (
    state === null || state === 'retrieved' || state === 'deleted' || state === 'failed'
  )
}
