// LIF-01-T17 visual regression coverage.
//
// Six lifecycle states and four export states, because this is the one screen
// where a wrong label is a safety problem rather than a cosmetic one: the
// difference between "we can still stop this" and "this is permanent" has to
// survive a redesign, and a screenshot is what catches that.

import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { AnyAction } from '#/components/hooks/use-action'
import type { ClosureCenterView } from '#/contexts/identity/application/dto/organization-closure.dto'
import { ClosureCenter } from './closure-center'

const idleAction = (): AnyAction =>
  Object.assign(async () => undefined, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

const REQUESTED_AT = '2026-08-28T13:30:00.000Z'
const RECOVERABLE_UNTIL = '2026-09-27T13:30:00.000Z'

const baseView: ClosureCenterView = {
  organizationName: 'Harbour Group',
  timezone: 'America/New_York',
  state: 'active',
  revision: 0,
  closureRequestedAt: null,
  recoverableUntil: null,
  irreversibleAt: null,
  closedAt: null,
  reactivationRequired: false,
  cancellable: false,
  confirmationPhrase: 'CLOSE Harbour Group',
  reactivationChecks: [
    { id: 'data_cell_health', satisfied: true, detailCode: 'cell_us_accepting' },
    { id: 'responsible_manager', satisfied: true, detailCode: 'ready' },
    { id: 'google_authorization', satisfied: false, detailCode: 'stale_authorization' },
    { id: 'portal_reactivation', satisfied: false, detailCode: 'no_activation' },
    {
      id: 'schedule_quarantine_cleared',
      satisfied: false,
      detailCode: 'quarantined:advance-organization-lifecycle',
    },
  ],
  export: null,
}

const closing: ClosureCenterView = {
  ...baseView,
  state: 'closing',
  revision: 2,
  closureRequestedAt: REQUESTED_AT,
  recoverableUntil: RECOVERABLE_UNTIL,
  reactivationRequired: true,
  cancellable: true,
}

const exportOf = (
  state: ClosureCenterView['export'] extends infer T
    ? T extends { state: infer S }
      ? S
      : never
    : never,
): NonNullable<ClosureCenterView['export']> => ({
  requestId: '00000000-0000-4000-8000-000000000009',
  state,
  asOf: REQUESTED_AT,
  objectExpiresAt: '2026-09-04T13:30:00.000Z',
  retrievalExpiresAt: state === 'retrieval_issued' ? '2026-08-29T13:30:00.000Z' : null,
  archiveSha256:
    state === 'ready' || state === 'retrieval_issued' ? 'c'.repeat(64) : null,
  coverageSha256:
    state === 'ready' || state === 'retrieval_issued' ? 'a'.repeat(64) : null,
  lastErrorCode: null,
})

const meta = {
  title: 'Closure/ClosureCenter',
  component: ClosureCenter,
  args: {
    view: baseView,
    requestClosure: idleAction(),
    cancelClosure: idleAction(),
    reactivate: idleAction(),
    requestExport: idleAction(),
    issueRetrieval: idleAction(),
    downloadExport: idleAction(),
  },
} satisfies Meta<typeof ClosureCenter>

export default meta
type Story = StoryObj<typeof meta>

// ── The six lifecycle states ────────────────────────────────────────

export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('closure-state-badge')).toHaveTextContent('Active')
    // No fresh-password or MFA field is introduced by the closure request.
    await expect(canvasElement.querySelector('input[type="password"]')).toBeNull()
  },
}

export const ClosureRequested: Story = {
  args: {
    view: { ...closing, state: 'closure_requested', revision: 1 },
  },
}

export const Closing: Story = {
  args: { view: { ...closing, export: exportOf('ready') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('closure-recovery-deadline')).toHaveTextContent('EDT')
    await expect(canvas.getByTestId('cancel-closure')).toBeEnabled()
  },
}

export const PurgePending: Story = {
  args: {
    view: {
      ...closing,
      state: 'purge_pending',
      revision: 3,
      cancellable: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('closure-state-badge')).toHaveTextContent(
      'Purge pending',
    )
    await expect(canvas.queryByTestId('cancel-closure')).toBeNull()
  },
}

export const Purging: Story = {
  args: {
    view: {
      ...closing,
      state: 'purging',
      revision: 4,
      cancellable: false,
      irreversibleAt: '2026-09-28T13:30:00.000Z',
    },
  },
}

export const Closed: Story = {
  args: {
    view: {
      ...closing,
      state: 'closed',
      revision: 5,
      cancellable: false,
      irreversibleAt: '2026-09-28T13:30:00.000Z',
      closedAt: '2026-09-28T14:00:00.000Z',
    },
  },
}

export const AwaitingReactivation: Story = {
  args: {
    view: { ...baseView, state: 'active', revision: 3, reactivationRequired: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('reactivation-checklist')).toBeVisible()
    await expect(canvas.getByTestId('reactivate-organization')).toBeDisabled()
  },
}

// ── Export states ───────────────────────────────────────────────────

export const ExportRequested: Story = {
  args: { view: { ...closing, export: exportOf('requested') } },
}

export const ExportGenerating: Story = {
  args: { view: { ...closing, export: exportOf('generating') } },
}

export const ExportReady: Story = {
  args: { view: { ...closing, export: exportOf('ready') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('export-checksum')).toHaveTextContent('c'.repeat(64))
    // Object keys and token digests are absent from the view type entirely.
    await expect(canvasElement.textContent).not.toContain('private/organization-exports')
  },
}

export const ExportExpired: Story = {
  args: { view: { ...closing, export: exportOf('deleted') } },
}
