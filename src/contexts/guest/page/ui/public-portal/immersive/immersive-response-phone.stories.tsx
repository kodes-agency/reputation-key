import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { bgCopy } from '../language-packs/bg'
import { deCopy } from '../language-packs/de'
import { enCopy } from '../language-packs/en'
import { esCopy } from '../language-packs/es'
import { frCopy } from '../language-packs/fr'
import { itCopy } from '../language-packs/it'
import { immersiveResponseProps } from './immersive-response-preview'
import { ImmersiveResponseView } from './immersive-response-view'
import { ImmersiveShell } from './immersive-shell'

const props = immersiveResponseProps(
  { kind: 'note-writing', rating: 2 },
  { pack: enCopy, displayName: 'Avela Resort' },
)

// Leave the feedback error, correction form and withdrawal confirmation open
// together so the shared phone-width gate measures their controls in every language.
const meta: Meta<typeof ImmersiveResponseView> = {
  title: 'Features/Guest/ImmersiveResponsePhone',
  component: ImmersiveResponseView,
  parameters: { layout: 'fullscreen' },
  args: {
    ...props,
    yourResponse: props.yourResponse && { ...props.yourResponse, initialOpen: true },
  },
  render: (args) => (
    <>
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
      <ImmersiveShell
        brand={{ accentColour: '#EAD6A8', fieldColour: '#15110D', hero: null }}
        heroAlt={{ value: '' }}
        lang={args.pack.locale}
        height="page"
      >
        <h1 className="ih-display ih-title__name">Avela Resort</h1>
        <ImmersiveResponseView {...args} />
      </ImmersiveShell>
    </>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const { copy } = args.pack
    await userEvent.click(canvas.getByRole('button', { name: copy.noteSend }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(copy.noteRequired)
    await userEvent.click(
      canvas.getByRole('button', {
        name: `${copy.ratingChange} ${copy.responseChangeTitle}`,
      }),
    )
    await expect(canvas.getByRole('radiogroup')).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: copy.responseChangeSave }),
    ).toBeEnabled()
    await userEvent.click(
      canvas.getByRole('button', {
        name: `${copy.responseRemoveAllAction} ${copy.responseRemoveRatingTitle}`,
      }),
    )
    const confirmation = canvas.getByRole('group', {
      name: copy.responseRemoveRatingConfirmTitle,
    })
    await expect(confirmation).toBeVisible()
    await expect(
      within(confirmation).getByRole('button', { name: copy.responseRemoveRatingCancel }),
    ).toBeEnabled()
    await expect(
      canvas.getByRole('button', {
        name: `${copy.googleAction} ${copy.googleOpensLabel}`,
      }),
    ).toBeVisible()
  },
}
export default meta

type Story = StoryObj<typeof ImmersiveResponseView>

export const English: Story = {}
export const Bulgarian: Story = { args: { pack: bgCopy } }
export const German: Story = { args: { pack: deCopy } }
export const Spanish: Story = { args: { pack: esCopy } }
export const French: Story = { args: { pack: frCopy } }
export const Italian: Story = { args: { pack: itCopy } }
