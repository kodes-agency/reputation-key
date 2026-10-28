// What the empty To handle queue offers beside its explanation: "Set up a
// feedback page", for someone who may create a Portal, only where the scope has
// none, and asked only while that state shows (ADR 0057, amended 2026-10-28).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, waitFor, within } from 'storybook/test'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'
import { InboxFeedbackSetup } from './inbox-feedback-setup'
import type { InboxServerFns } from './types'

const HARBOR = '60000000-0000-4000-8000-000000000001'
const GARDEN = '60000000-0000-4000-8000-000000000002'

const presence = (hasPortal: boolean) =>
  fn<NonNullable<InboxServerFns['getPortalPresence']>>(async () => ({ hasPortal }))

const meta: Meta<typeof InboxFeedbackSetup> = {
  title: 'Inbox/Feedback Setup',
  component: InboxFeedbackSetup,
  parameters: { layout: 'centered' },
  args: {
    scopePropertyId: HARBOR,
    propertyChoices: [{ id: HARBOR }, { id: GARDEN }],
    getPortalPresence: presence(false),
  },
}
export default meta
type Story = StoryObj<typeof InboxFeedbackSetup>

/** The Property in view has no Portal: its own creation address opens. */
export const PropertyWithoutPortal: Story = {
  play: async ({ canvasElement, args }) => {
    const link = await within(canvasElement).findByRole('link', {
      name: 'Set up a feedback page',
    })

    await expect(link).toHaveAttribute('href', `/properties/${HARBOR}/portals/new`)
    await expect(args.getPortalPresence).toHaveBeenCalledWith({
      data: { propertyId: HARBOR },
    })
  },
}

/** All properties, and only one to choose: the creation address is that one's. */
export const OrganizationWithOneProperty: Story = {
  args: { scopePropertyId: undefined, propertyChoices: [{ id: GARDEN }] },
  play: async ({ canvasElement, args }) => {
    const link = await within(canvasElement).findByRole('link', {
      name: 'Set up a feedback page',
    })

    await expect(link).toHaveAttribute('href', `/properties/${GARDEN}/portals/new`)
    await expect(args.getPortalPresence).toHaveBeenCalledWith({ data: {} })
  },
}

/** All properties and several to choose from: the Portals page asks which one. */
export const OrganizationWithSeveralProperties: Story = {
  args: { scopePropertyId: undefined },
  play: async ({ canvasElement }) => {
    const link = await within(canvasElement).findByRole('link', {
      name: 'Set up a feedback page',
    })

    await expect(link).toHaveAttribute('href', '/portals')
  },
}

/** A scope that has a Portal offers nothing: the explanation above is enough. */
export const ScopeWithAPortal: Story = {
  args: { getPortalPresence: presence(true) },
  play: async ({ canvasElement, args }) => {
    await waitFor(() => expect(args.getPortalPresence).toHaveBeenCalled())

    await expect(within(canvasElement).queryByRole('link')).toBeNull()
  },
}

/** Someone who may not create a Portal is not asked, and is offered nothing. */
export const ReaderWhoCannotCreate: Story = {
  decorators: [withRole('Member')],
  play: async ({ canvasElement, args }) => {
    await expect(within(canvasElement).queryByRole('link')).toBeNull()
    await expect(args.getPortalPresence).not.toHaveBeenCalled()
  },
}

/** Where the Inbox has no way to ask, nothing is offered. */
export const WithoutTheRead: Story = {
  args: { getPortalPresence: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link')).toBeNull()
  },
}
