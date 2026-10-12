// Click a part of the page to edit it (boards 02 and 04). The preview pane with
// the editor's `selection`: each part of the phone's page has a button over it,
// the part of the active section is outlined and flagged, and Languages opens
// the sheet in the phone. The section is a prop here (the route owns it in the
// editor), so a story can hold it in state and watch the outline follow.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { PortalEditorSection } from '../portal-editor/portal-editor-sections'
import {
  PREVIEW_DRAFT_ONE_LANGUAGE,
  previewReader,
} from './__fixtures__/portal-preview-fixtures'
import { PortalPreviewPane } from './portal-preview-pane'
import type { PreviewPartSection } from './preview-parts'

const COLUMN_WIDTH = 480
const WAIT = { timeout: 5000 }

const onSelect = fn<(section: PreviewPartSection) => void>()

type StoryProps = Readonly<{
  initial: PortalEditorSection
  getPortalPreview: ReturnType<typeof previewReader>
  canEdit?: boolean
  /** A button that moves the editor to another section, as its section list does. */
  hasSectionButton?: boolean
}>

/** The editor's job in miniature: the active section is state, and a part's click moves it. */
function PaneWithSection({
  initial,
  getPortalPreview,
  hasSectionButton,
  canEdit = true,
}: StoryProps) {
  const [active, setActive] = useState<PortalEditorSection>(initial)
  return (
    <div>
      {hasSectionButton ? (
        <button type="button" onClick={() => setActive('private-note')}>
          Go to Private note
        </button>
      ) : null}
      <PortalPreviewPane
        portalId="p-1"
        getPortalPreview={getPortalPreview}
        selection={{
          active,
          canEdit,
          onSelect: (section) => {
            onSelect(section)
            setActive(section)
          },
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Portal/PortalPreviewSelection',
  component: PaneWithSection,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: COLUMN_WIDTH, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
  args: { initial: 'linktree', getPortalPreview: previewReader() },
} satisfies Meta<typeof PaneWithSection>

export default meta
type Story = StoryObj<typeof meta>

const phone = (canvas: ReturnType<typeof within>) =>
  canvas.findByRole(
    'region',
    { name: (name: string) => name.startsWith('Preview of the guest page: ') },
    WAIT,
  )

/** The edit button over a part, found once the page has been laid out and measured. */
const part = (canvas: ReturnType<typeof within>, label: string) =>
  canvas.findByRole('button', { name: `Edit ${label}` }, WAIT)

/** Board 02: the Linktree is outlined and flagged, and the line under the phone says to click. */
export const OutlineAndFlagOnTheActivePart: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas)
    const linktree = await part(canvas, 'Linktree')
    await expect(linktree).toHaveAttribute('aria-current', 'true')
    await expect(linktree).toHaveTextContent('Linktree')
    await expect(canvas.getByText('Click any part of the page to edit it')).toBeVisible()
    // Only the active part carries a flag, and it sits on the Linktree block.
    const welcome = await part(canvas, 'Welcome')
    await expect(welcome).not.toHaveAttribute('aria-current')
    await expect(welcome.textContent).toBe('')
    const block = canvasElement.querySelector('[data-preview-part="linktree"]')
    const over = linktree.getBoundingClientRect()
    const under = block?.getBoundingClientRect()
    await expect(under).toBeDefined()
    await expect(Math.abs(over.top - (under?.top ?? 0))).toBeLessThan(8)
    await expect(Math.abs(over.height - (under?.height ?? 0))).toBeLessThan(12)
  },
}

/** Every part of the arrival page has a button, in the order the page has them. */
export const EveryPartIsAButton: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas)
    await part(canvas, 'Linktree')
    const names = canvas
      .getAllByRole('button', { name: /^Edit / })
      .map((button) => button.getAttribute('aria-label'))
    await expect(names).toEqual([
      'Edit Languages',
      'Edit Welcome',
      'Edit Rating & Google',
      'Edit Linktree',
      'Edit Footer',
    ])
  },
}

/** A click opens that part's section: the editor is told which, and the outline moves. */
export const ClickAPartToEditIt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas)
    onSelect.mockClear()
    await userEvent.click(await part(canvas, 'Rating & Google'))
    await expect(onSelect).toHaveBeenCalledWith('rating')
    await waitFor(async () => {
      await expect(await part(canvas, 'Rating & Google')).toHaveAttribute(
        'aria-current',
        'true',
      )
    }, WAIT)
    await expect(await part(canvas, 'Linktree')).not.toHaveAttribute('aria-current')
  },
}

/** The keyboard moves between the parts with Tab, top to bottom, and chooses one with Enter or Space. */
export const ChooseAPartWithTheKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas)
    onSelect.mockClear()
    const button = (label: string) =>
      canvas.getByRole('button', { name: `Edit ${label}` })
    await part(canvas, 'Linktree')
    button('Languages').focus()
    await userEvent.tab()
    await expect(button('Welcome')).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(onSelect).toHaveBeenLastCalledWith('welcome')
    await userEvent.tab()
    await expect(button('Rating & Google')).toHaveFocus()
    await userEvent.tab()
    await expect(button('Linktree')).toHaveFocus()
    await userEvent.tab()
    await expect(button('Footer')).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect(onSelect).toHaveBeenLastCalledWith('footer')
  },
}

/** Board 04: editing Languages draws the language sheet open in the phone. */
export const LanguagesOpensTheSheet: Story = {
  args: { initial: 'languages' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const frame = await phone(canvas)
    const languages = await part(canvas, 'Languages')
    await expect(languages).toHaveAttribute('aria-current', 'true')
    await expect(languages).toHaveTextContent('Languages')
    const sheet = within(frame).getByText('Language', { selector: 'h2' })
    await expect(sheet).toBeVisible()
    await expect(within(frame).getByText('Български')).toBeVisible()
    // The sheet is the part: the outline sits on it, not on the chip behind it.
    const sheetBox = canvasElement
      .querySelector('[data-preview-part="language-sheet"]')
      ?.getBoundingClientRect()
    await expect(
      Math.abs(languages.getBoundingClientRect().bottom - (sheetBox?.bottom ?? 0)),
    ).toBeLessThan(12)
    // The page does not scroll away from under it.
    await expect(frame.scrollTop).toBe(0)
    // The sheet covers the page: only its own part is live, so no other part's
    // button sits over it or takes the focus (and the scroll) away.
    await expect(canvas.getAllByRole('button', { name: /^Edit / })).toEqual([languages])
    const rect = sheetBox ?? languages.getBoundingClientRect()
    for (const at of [0.5, 0.9]) {
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height * at,
      )
      await expect(hit?.getAttribute('aria-label')).toBe('Edit Languages')
    }
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.tab()
    await expect(frame.scrollTop).toBe(0)
  },
}

/** The chip is the part until the sheet is open: a click on it opens Languages. */
export const TheChipOpensLanguages: Story = {
  args: { initial: 'welcome' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const frame = await phone(canvas)
    await expect(within(frame).queryByText('Language', { selector: 'h2' })).toBeNull()
    onSelect.mockClear()
    await userEvent.click(await part(canvas, 'Languages'))
    await expect(onSelect).toHaveBeenCalledWith('languages')
    await within(frame).findByText('Language', { selector: 'h2' }, WAIT)
  },
}

/** A portal with one language has no chip and so no sheet to open, and no Languages part. */
export const OneLanguageHasNoSheet: Story = {
  args: {
    initial: 'languages',
    getPortalPreview: previewReader({ draft: PREVIEW_DRAFT_ONE_LANGUAGE }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const frame = await phone(canvas)
    await part(canvas, 'Welcome')
    await expect(canvas.queryByRole('button', { name: 'Edit Languages' })).toBeNull()
    await expect(within(frame).queryByText('Language', { selector: 'h2' })).toBeNull()
  },
}

/** The private note is only on the page after a low rating, so editing it shows that state. */
export const PrivateNoteShowsAfterALowRating: Story = {
  args: { initial: 'private-note' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('Draft · After 2★ · English', undefined, WAIT),
    ).toBeVisible()
    const note = await part(canvas, 'Private note')
    await expect(note).toHaveAttribute('aria-current', 'true')
    await expect(note).toHaveTextContent('Private note')
    // The manager can still choose another state; the part is then not there.
    await userEvent.click(canvas.getByRole('button', { name: 'Arrival' }))
    await canvas.findByText('Draft · Arrival · English', undefined, WAIT)
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: 'Edit Private note' })).toBeNull()
    }, WAIT)
  },
}

/** Moving to another section brings the state that draws its part, but keeps one that already does. */
export const FollowsTheSection: Story = {
  args: { initial: 'welcome', hasSectionButton: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas)
    await canvas.findByText('Draft · Arrival · English', undefined, WAIT)
    await userEvent.click(canvas.getByRole('button', { name: 'Go to Private note' }))
    await canvas.findByText('Draft · After 2★ · English', undefined, WAIT)
    await expect(await part(canvas, 'Private note')).toHaveAttribute(
      'aria-current',
      'true',
    )
    // The state the manager is in already draws the Linktree: nothing moves.
    await userEvent.click(await part(canvas, 'Linktree'))
    await canvas.findByText('Draft · After 2★ · English', undefined, WAIT)
  },
}

/** "Try as guest" turns part selection off: no buttons, no hint, a page that answers its guest. */
export const TryAsGuestTurnsSelectionOff: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas)
    await part(canvas, 'Linktree')
    await userEvent.click(canvas.getByRole('button', { name: 'Try as guest' }))
    await canvas.findByRole('region', { name: 'Guest page you can try' }, WAIT)
    await expect(canvas.queryByRole('button', { name: /^Edit / })).toBeNull()
    await expect(canvas.queryByText('Click any part of the page to edit it')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Stop trying' }))
    await part(canvas, 'Linktree')
    await expect(canvas.getByText('Click any part of the page to edit it')).toBeVisible()
  },
}

/** Without a selection (the Review page) the phone is a picture: no buttons, no hint. */
export const WithoutSelectionThePhoneIsAPicture: StoryObj<typeof PortalPreviewPane> = {
  render: () => <PortalPreviewPane portalId="p-1" getPortalPreview={previewReader()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas)
    await expect(canvas.queryByRole('button', { name: /^Edit / })).toBeNull()
    await expect(canvas.queryByText('Click any part of the page to edit it')).toBeNull()
  },
}

/** A reader (no portal.update, or an archived portal) is told the parts open settings, not that they edit. */
export const ReadOnlyPartsSayOpen: Story = {
  args: { initial: 'welcome', canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await phone(canvas)
    await canvas.findByRole('button', { name: 'Open Welcome' }, WAIT)
    await expect(canvas.queryByRole('button', { name: /^Edit / })).toBeNull()
    await expect(
      canvas.getByText('Click any part of the page to see its settings'),
    ).toBeVisible()
  },
}
