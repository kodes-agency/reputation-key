// The Languages section: each language the portal offers with how much of its
// wording is written, the gaps it names, and the menus that change the set. The
// story wraps the section in the autosave coordinator the workspace provides,
// because every change is written through it.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { Action } from '#/components/hooks/use-action'
import type { PortalLanguageCoverage } from '#/contexts/portal/application/public-api'
import { PortalDraftAutosaveProvider } from '../portal-editor/portal-draft-autosave-context'
import type { UpdatePortalVariables } from '../shared/types'
import { PortalLanguagesSection } from './portal-languages-section'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'

const meta: Meta<typeof PortalLanguagesSection> = {
  title: 'Portal/PortalLanguagesSection',
  component: PortalLanguagesSection,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <PortalDraftAutosaveProvider>
        <div className="max-w-2xl">
          <Story />
        </div>
      </PortalDraftAutosaveProvider>
    ),
    AuthedRouterDecorator,
  ],
}
export default meta
type Story = StoryObj<typeof PortalLanguagesSection>

function update(): Action<UpdatePortalVariables> {
  return Object.assign(
    fn(async (_input: UpdatePortalVariables) => undefined),
    { isPending: false, error: null as unknown, isSuccess: false, data: null },
  ) as unknown as Action<UpdatePortalVariables>
}

const complete = (locale: 'en' | 'bg', isFallback: boolean) => ({
  locale,
  isFallback,
  total: 5,
  present: 5,
  missing: [],
})

const coverage: PortalLanguageCoverage = {
  portalId: 'p-1',
  fallbackLocale: 'en',
  languages: [
    complete('en', true),
    {
      locale: 'bg',
      isFallback: false,
      total: 5,
      present: 3,
      missing: [
        {
          key: 'description',
          kind: 'description',
          linkId: null,
          linkLabel: null,
          blocksPublish: false,
        },
        {
          key: 'link:l-2',
          kind: 'link_label',
          linkId: 'l-2',
          linkLabel: 'Spa',
          blocksPublish: false,
        },
      ],
    },
  ],
  missingTotal: 2,
}

const portal = {
  id: 'p-1',
  primaryGuestLocale: 'en' as const,
  additionalGuestLocales: ['bg' as const],
}

export const WithGaps: Story = {
  args: {
    portal,
    propertyId: 'prop-1',
    coverage,
    update: update(),
    canEdit: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      within(canvas.getByRole('list', { name: 'Languages' })).getByText('English'),
    ).toBeVisible()
    await expect(canvas.getByText('Fallback')).toBeVisible()
    await expect(canvas.getByText('Used when a text is missing')).toBeVisible()
    await expect(canvas.getByText('All 5 texts')).toBeVisible()
    await expect(canvas.getByText('3 of 5 · 2 missing')).toBeVisible()
    await expect(
      canvas.getByText(
        'Now: Bulgarian guests see the description and 1 link label in English.',
      ),
    ).toBeVisible()
    // There is no AI translation control.
    await expect(canvas.queryByText(/translate with ai/i)).not.toBeInTheDocument()
  },
}

export const ShowMissingNamesEachGap: Story = {
  args: { ...WithGaps.args, update: update() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Show missing texts in Bulgarian' }),
    )
    const list = canvas.getByRole('list', { name: 'Missing in Bulgarian' })
    await expect(within(list).getByText('Description')).toBeVisible()
    await expect(within(list).getByText('Needs the Property’s wording')).toBeVisible()
    await expect(within(list).getByText('Label for “Spa”')).toBeVisible()
    await expect(
      within(list).getByRole('link', { name: 'Write it in Linktree' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Hide missing texts in Bulgarian' }),
    ).toBeVisible()
  },
}

export const AddMenuOffersTheLaunchSet: Story = {
  args: {
    ...WithGaps.args,
    portal: { ...portal, additionalGuestLocales: [] },
    coverage: { ...coverage, languages: [complete('en', true)], missingTotal: 0 },
    update: update(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add language' }))
    const menu = within(await within(document.body).findByRole('menu'))
    // Every launch language has a v2 pack, so all five others are offered and
    // nothing is left for "More languages later".
    await expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'EspañolSpanish',
      'ItalianoItalian',
      'FrançaisFrench',
      'DeutschGerman',
      'БългарскиBulgarian',
    ])
    await expect(menu.queryByText('More languages later')).not.toBeInTheDocument()
    await userEvent.click(menu.getByRole('menuitem', { name: /Български/ }))
    await waitFor(() =>
      expect(args.update).toHaveBeenCalledWith({
        data: {
          portalId: 'p-1',
          primaryGuestLocale: 'en',
          additionalGuestLocales: ['bg'],
        },
      }),
    )
  },
}

export const MakeFallbackSwapsTheLanguages: Story = {
  args: { ...WithGaps.args, update: update() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for Български' }),
    )
    await userEvent.click(
      await within(document.body).findByRole('menuitem', {
        name: 'Make fallback language',
      }),
    )
    await waitFor(() =>
      expect(args.update).toHaveBeenCalledWith({
        data: {
          portalId: 'p-1',
          primaryGuestLocale: 'bg',
          additionalGuestLocales: ['en'],
        },
      }),
    )
  },
}

export const RemoveAnAdditionalLanguage: Story = {
  args: { ...WithGaps.args, update: update() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for Български' }),
    )
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Remove language' }),
    )
    await waitFor(() =>
      expect(args.update).toHaveBeenCalledWith({
        data: {
          portalId: 'p-1',
          primaryGuestLocale: 'en',
          additionalGuestLocales: [],
        },
      }),
    )
  },
}

export const FallbackLanguageCannotBeRemoved: Story = {
  args: { ...WithGaps.args, update: update() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for English' }),
    )
    const remove = await within(document.body).findByRole('menuitem', {
      name: 'Remove language',
    })
    await expect(remove).toHaveAttribute('aria-disabled', 'true')
    await expect(args.update).not.toHaveBeenCalled()
  },
}

export const ReadOnlyForAViewer: Story = {
  args: { ...WithGaps.args, canEdit: false, update: update() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('3 of 5 · 2 missing')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Add language' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /More actions/ })).toBeNull()
  },
}

export const BeforeCoverageArrives: Story = {
  args: { ...WithGaps.args, coverage: undefined, update: update() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Fallback')).toBeVisible()
    await expect(canvas.queryByText(/\d+ missing/)).toBeNull()
  },
}
