// The editor's navigation guard, driven through a real (memory) router: it must
// write what is waiting before any navigation continues, stay quiet when that
// worked, and ask only when a save could not be made — naming what was not
// saved, and offering to try again when a write failed.
import type { Meta, StoryObj } from '@storybook/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { useMemo } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import {
  PortalDraftAutosaveProvider,
  usePortalDraftAutosave,
} from '../portal-editor/portal-draft-autosave-context'
import { PortalUnsavedChangesPrompt } from './portal-unsaved-changes-prompt'

const saveSpy = fn(async () => undefined)

/** `once`: the first write fails and a retry works; `always`: every write fails. */
type Failing = false | 'once' | 'always'

function Editing({ failing }: Readonly<{ failing: Failing }>) {
  const autosave = usePortalDraftAutosave()
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <div className="space-y-3 p-6">
      <PortalUnsavedChangesPrompt />
      <p>Location: {pathname}</p>
      <Button
        onClick={() =>
          autosave.schedule('welcome', async () => {
            await saveSpy()
            const calls = saveSpy.mock.calls.length
            if (failing === 'always' || (failing === 'once' && calls === 1)) {
              throw new Error('offline')
            }
            return 'saved'
          })
        }
      >
        Edit the name
      </Button>
      <Button
        variant="outline" // Through the history, where blockers listen — as a Link click or Back does.
        onClick={() => router.history.push('/elsewhere')}
      >
        Leave
      </Button>
    </div>
  )
}

function Harness({ failing }: Readonly<{ failing: Failing }>) {
  const router = useMemo(() => {
    const root = createRootRoute({ component: Outlet })
    const editor = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <Editing failing={failing} />,
    })
    const elsewhere = createRoute({
      getParentRoute: () => root,
      path: '/elsewhere',
      component: () => <p>Somewhere else</p>,
    })
    return createRouter({
      routeTree: root.addChildren([editor, elsewhere]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
  }, [failing])
  return (
    <PortalDraftAutosaveProvider>
      <RouterProvider router={router} />
    </PortalDraftAutosaveProvider>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Portal/PortalUnsavedChangesPrompt',
  component: Harness,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => saveSpy.mockClear(),
}
export default meta
type Story = StoryObj<typeof Harness>

export const WritesWhatIsWaitingThenLeavesQuietly: Story = {
  args: { failing: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit the name' }))
    // Still inside the debounce: leaving now must write it first, not lose it.
    await userEvent.click(canvas.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(canvas.getByText('Somewhere else')).toBeVisible())
    await expect(saveSpy).toHaveBeenCalledTimes(1)
    await expect(canvas.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

// A write failed: the question names what was not saved, and trying again is
// the main way on. A retry that fails again says so and stays.
export const AsksWhenTheSaveFailed: Story = {
  args: { failing: 'always' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit the name' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Leave' }))
    const dialog = await body.findByRole('alertdialog', {
      name: 'Save before you leave?',
    })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveTextContent('Not saved: the portal’s name.')
    await expect(canvas.getByText('Location: /')).toBeVisible()

    // Keep editing: stays put.
    await userEvent.click(body.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(body.queryByRole('alertdialog')).not.toBeInTheDocument())
    await expect(canvas.getByText('Location: /')).toBeVisible()

    // Try saving again, which fails again: the dialog stays and says so.
    await userEvent.click(canvas.getByRole('button', { name: 'Leave' }))
    await userEvent.click(await body.findByRole('button', { name: 'Try saving again' }))
    await expect(await body.findByRole('alert')).toBeVisible()
    await expect(canvas.getByText('Location: /')).toBeVisible()

    // Leave and discard: goes, and the failed save is forgotten.
    await userEvent.click(body.getByRole('button', { name: 'Leave and discard' }))
    await waitFor(() => expect(canvas.getByText('Somewhere else')).toBeVisible())
  },
}

// The connection came back: trying again saves the edit and the navigation
// carries on.
export const TryingAgainSavesAndLeaves: Story = {
  args: { failing: 'once' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit the name' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Leave' }))
    await userEvent.click(await body.findByRole('button', { name: 'Try saving again' }))
    await waitFor(() => expect(canvas.getByText('Somewhere else')).toBeVisible())
    await expect(saveSpy).toHaveBeenCalledTimes(2)
  },
}
