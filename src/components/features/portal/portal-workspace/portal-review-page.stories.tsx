// The review page's interim body: publication state and the one publish or
// pause action, with the saved-changes status above it.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'
import type { Action } from '#/components/hooks/use-action'
import type { UpdatePortalVariables } from '../shared/types'
import { PortalReviewPage } from './portal-review-page'

const meta: Meta<typeof PortalReviewPage> = {
  title: 'Portal/PortalReviewPage',
  component: PortalReviewPage,
  parameters: { layout: 'padded' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalReviewPage>

const idleMutation = Object.assign(
  async (_input: UpdatePortalVariables) => ({ success: true }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<UpdatePortalVariables, { success: boolean }>

const portal = {
  id: 'p-1',
  name: 'Pool & Terrace',
  slug: 'pool-terrace',
  description: null,
  heroImageUrl: null,
  theme: { primaryColor: '#6366f1' },
  privateFeedbackThreshold: 3,
  publicationState: 'published' as const,
}

const live = {
  activationSequence: 5,
  version: 5,
  kind: 'publish' as const,
  activatedBy: { userId: 'user-1', displayName: 'Georgi Ivanov' },
  activatedAt: '2026-09-22T10:00:00.000Z',
  deactivatedAt: null,
  deactivationReason: null,
}

export const LiveWithChangesWaiting: Story = {
  args: {
    portal,
    canManage: true,
    mutation: idleMutation,
    publicationHistory: {
      current: live,
      priorActivations: [],
      hasPendingChanges: true,
      nextCursor: null,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 2, name: 'Publication' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText(/saved changes are ready/i)).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: /disable public page/i }),
    ).toBeInTheDocument()
  },
}

export const DraftReadyToPublish: Story = {
  args: {
    portal: { ...portal, publicationState: 'draft' },
    canManage: true,
    mutation: idleMutation,
    publicationHistory: {
      current: null,
      priorActivations: [],
      hasPendingChanges: false,
      nextCursor: null,
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: /publish portal/i }),
    ).toBeInTheDocument()
  },
}

export const ViewerWithoutUpdateRights: Story = {
  args: { ...LiveWithChangesWaiting.args, canManage: false },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: /disable public page/i }),
    ).not.toBeInTheDocument()
  },
}
