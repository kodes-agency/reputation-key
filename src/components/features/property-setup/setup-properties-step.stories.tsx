import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'
import { SetupPropertiesStep } from './setup-properties-step'
import {
  createSetupFnsFixture,
  STORY_ADMIN,
  STORY_MANAGER,
} from './setup.stories.fixtures'

const BERLIN = '20000000-0000-4000-8000-000000000001'
const LISBON = '20000000-0000-4000-8000-000000000002'
const ATHENS = '20000000-0000-4000-8000-000000000003'

const batch = [
  { propertyId: BERLIN, name: 'Hotel Berlin Mitte', countryCode: 'DE' },
  { propertyId: LISBON, name: 'Casa Lisboa', countryCode: 'PT' },
  { propertyId: ATHENS, name: 'Athens Rooms', countryCode: 'GR' },
] as const

const imported = batch.map((property) => ({
  propertyId: property.propertyId,
  propertyName: property.name,
}))

const meta = {
  title: 'PropertySetup/SetupPropertiesStep',
  component: SetupPropertiesStep,
  parameters: { layout: 'padded' },
  decorators: [AuthedRouterDecorator],
} satisfies Meta<typeof SetupPropertiesStep>

export default meta
type Story = StoryObj<typeof meta>

async function next(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^next$/i }))
}

/**
 * Twenty locations get the same three questions as one: suggested languages,
 * the importing admin as manager, one consent ceremony naming every property.
 */
export const ThreePropertiesOneCeremony: Story = {
  args: {
    properties: imported,
    viewerUserId: STORY_ADMIN.userId,
    fns: createSetupFnsFixture({ properties: batch }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const fns = args.fns as ReturnType<typeof createSetupFnsFixture>

    await expect(
      canvas.findByText(/German for Hotel Berlin Mitte; Portuguese for Casa Lisboa/i),
    ).resolves.toBeVisible()
    await expect(canvas.getByText('Question 1 of 3')).toBeVisible()
    await next(canvasElement)

    await expect(canvas.getByRole('checkbox', { name: STORY_ADMIN.name })).toBeChecked()
    await next(canvasElement)

    await userEvent.click(canvas.getByRole('radio', { name: /turn on ai features/i }))
    await userEvent.click(canvas.getByRole('button', { name: /review answers/i }))

    const table = within(await canvas.findByRole('table'))
    await expect(table.getByRole('rowheader', { name: 'Casa Lisboa' })).toBeVisible()
    await expect(table.getAllByText(STORY_ADMIN.name)).toHaveLength(3)
    const cta = canvas.getByRole('button', {
      name: 'Enable AI features for Hotel Berlin Mitte, Casa Lisboa and Athens Rooms',
    })
    await expect(cta).toBeDisabled()
    await userEvent.click(
      canvas.getByRole('checkbox', { name: /I have read this notice and agree/i }),
    )
    await userEvent.click(cta)

    await expect(canvas.findByText('Setup saved')).resolves.toBeVisible()
    await expect(fns.enableMerchantAiForProperties).toHaveBeenCalledOnce()
    await expect(fns.enableMerchantAiForProperties).toHaveBeenCalledWith({
      data: expect.objectContaining({
        propertyIds: [BERLIN, LISBON, ATHENS],
        capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
      }),
    })
    await expect(fns.updateProperty).toHaveBeenCalledWith({
      data: { propertyId: LISBON, defaultReplyLanguage: 'pt-Latn' },
    })
    await expect(fns.updateProperty).toHaveBeenCalledWith({
      data: { propertyId: ATHENS, defaultReplyLanguage: 'en-Latn' },
    })
    await expect(fns.updatePropertyResponsibleManagers).toHaveBeenCalledTimes(3)
    await expect(
      canvas.findByRole('progressbar', { name: /reviews analysed at casa lisboa/i }),
    ).resolves.toBeVisible()
    await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
  },
}

/** One property answers differently: its own language, manager, and "not now". */
export const PerPropertyOverrides: Story = {
  args: {
    properties: imported,
    viewerUserId: STORY_ADMIN.userId,
    fns: createSetupFnsFixture({ properties: batch }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    const fns = args.fns as ReturnType<typeof createSetupFnsFixture>

    await userEvent.click(
      await canvas.findByRole('radio', { name: /choose the language/i }),
    )
    await userEvent.click(canvas.getByRole('switch', { name: /same answer for all 3/i }))
    await userEvent.click(
      canvas.getByRole('combobox', { name: /reply language for athens rooms/i }),
    )
    await userEvent.click(await page.findByRole('option', { name: 'Spanish' }))
    await next(canvasElement)

    await userEvent.click(canvas.getByRole('switch', { name: /same answer for all 3/i }))
    await userEvent.click(
      canvas.getByRole('combobox', { name: /responsible manager for casa lisboa/i }),
    )
    await userEvent.click(await page.findByRole('option', { name: STORY_MANAGER.name }))
    await next(canvasElement)

    await userEvent.click(canvas.getByRole('radio', { name: /turn on ai features/i }))
    await userEvent.click(canvas.getByRole('switch', { name: /same answer for all 3/i }))
    await userEvent.click(
      canvas.getByRole('switch', { name: /ai features for athens rooms/i }),
    )
    await userEvent.click(canvas.getByRole('button', { name: /review answers/i }))

    await userEvent.click(
      await canvas.findByRole('checkbox', { name: /I have read this notice and agree/i }),
    )
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Enable AI features for Hotel Berlin Mitte and Casa Lisboa',
      }),
    )

    await expect(canvas.findByText('Setup saved')).resolves.toBeVisible()
    await expect(fns.deferMerchantAiDecision).toHaveBeenCalledOnce()
    await expect(fns.deferMerchantAiDecision).toHaveBeenCalledWith({
      data: { propertyId: ATHENS },
    })
    await expect(fns.updateProperty).toHaveBeenCalledWith({
      data: { propertyId: ATHENS, defaultReplyLanguage: 'es-Latn' },
    })
    await expect(fns.updatePropertyResponsibleManagers).toHaveBeenCalledWith({
      data: expect.objectContaining({
        propertyId: LISBON,
        managerUserIds: [STORY_MANAGER.userId],
      }),
    })
  },
}

/** Skipping every question saves nothing; the checklist keeps the steps. */
export const NotNowAndSkip: Story = {
  args: {
    properties: [imported[0]!],
    viewerUserId: STORY_ADMIN.userId,
    fns: createSetupFnsFixture({ properties: [batch[0]] }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const fns = args.fns as ReturnType<typeof createSetupFnsFixture>

    await userEvent.click(await canvas.findByRole('button', { name: /skip for now/i }))
    await userEvent.click(canvas.getByRole('button', { name: /skip for now/i }))
    await userEvent.click(canvas.getByRole('radio', { name: /not now/i }))
    await userEvent.click(canvas.getByRole('button', { name: /review answers/i }))

    const table = within(await canvas.findByRole('table'))
    await expect(table.getAllByText('Skipped')).toHaveLength(2)
    await expect(table.getByText('Not now')).toBeVisible()
    await expect(
      canvas.queryByRole('checkbox', { name: /I have read this notice/i }),
    ).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Save setup' }))

    await expect(canvas.findByText('Setup saved')).resolves.toBeVisible()
    await expect(fns.deferMerchantAiDecision).toHaveBeenCalledOnce()
    await expect(fns.updateProperty).not.toHaveBeenCalled()
    await expect(fns.enableMerchantAiForProperties).not.toHaveBeenCalled()
  },
}

/** A failed write is reported per property and retried on its own. */
export const RetryAFailedAnswer: Story = {
  args: {
    properties: imported.slice(0, 2),
    viewerUserId: STORY_ADMIN.userId,
    fns: createSetupFnsFixture({
      properties: batch.slice(0, 2),
      failLanguageFor: [LISBON],
    }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const fns = args.fns as ReturnType<typeof createSetupFnsFixture>

    await next(canvasElement)
    await next(canvasElement)
    await userEvent.click(await canvas.findByRole('radio', { name: /not now/i }))
    await userEvent.click(canvas.getByRole('button', { name: /review answers/i }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Save setup' }))

    await expect(canvas.findByText('Some answers were not saved')).resolves.toBeVisible()
    await expect(
      canvas.getByText(/Reply language: The property could not be reached/),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /try again/i }))

    await expect(canvas.findByText('Setup saved')).resolves.toBeVisible()
    await waitFor(() => expect(fns.updateProperty).toHaveBeenCalledTimes(3))
    await expect(fns.deferMerchantAiDecision).toHaveBeenCalledTimes(2)
  },
}

/** A relinked property that is already configured is not asked again. */
export const NothingLeftToAsk: Story = {
  args: {
    properties: [imported[0]!],
    viewerUserId: STORY_ADMIN.userId,
    fns: createSetupFnsFixture({
      properties: [
        {
          ...batch[0],
          defaultReplyLanguage: 'de-Latn',
          aiEnabled: true,
          managerIds: [STORY_MANAGER.userId],
        },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('Nothing left to ask')).resolves.toBeVisible()
    await expect(canvas.queryByRole('group', { name: /set up properties/i })).toBeNull()
  },
}
