// The guarded route error pattern: what any route error component gets from
// `useGuardedRouteError` before it adds its own frame. These stories use the
// recommended shape (frame + ErrorState fed by the hook) and prove the four
// behaviours the Portal routes used to lose: an unexpected failure is reported,
// an expected refusal is not, Try again re-runs the loaders, and a 401 sends
// the person to sign in instead of showing an error.
//
// The stories run in development mode, so the raw message shows; the production
// rule (generic or page sentence, never the raw text) is unit-tested in
// `use-guarded-route-error.test.ts` against `routeErrorFacts`.
import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, spyOn, userEvent, waitFor, within } from 'storybook/test'
import { PageGutterDecorator } from '../../../.storybook/PageGutterDecorator'
import { setBrowserExceptionCapture } from '#/shared/observability/browser-exception-capture'
import { ErrorState } from './page-states'
import { PageHeader } from './page-header'
import { PageShell } from './page-shell'
import { SignedOutRedirect, useGuardedRouteError } from './use-guarded-route-error'

type HarnessProps = Readonly<{ error: unknown; fallback?: string }>

/** The story's router, handed out so a play can watch it. */
let storyRouter: ReturnType<typeof useRouter> | undefined

/** A route error component as a route would write it. */
function GuardedRouteError({ error, fallback }: HarnessProps) {
  const router = useRouter()
  useEffect(() => {
    storyRouter = router
  }, [router])
  const guarded = useGuardedRouteError(error, fallback)
  if (guarded.signedOut) return <SignedOutRedirect />
  return (
    <PageShell>
      <PageHeader title="Portals" description="Manage this property’s public pages." />
      <ErrorState message={guarded.message} onRetry={guarded.retry} />
    </PageShell>
  )
}

const withStatus = (status: number, message: string): Error =>
  Object.assign(new Error(message), { status })

/** What the browser capture seam received; cleared before every story. */
const reported = fn()

const meta: Meta<typeof GuardedRouteError> = {
  title: 'Patterns/Guarded route error',
  component: GuardedRouteError,
  parameters: { layout: 'fullscreen' },
  // A route error component sits in `<main>`, which pads the page.
  decorators: [PageGutterDecorator],
  beforeEach: () => {
    reported.mockClear()
    setBrowserExceptionCapture(reported)
    return () => setBrowserExceptionCapture(undefined)
  },
}
export default meta
type Story = StoryObj<typeof GuardedRouteError>

/** An unexpected failure keeps the page's frame, is reported, and can be retried. */
export const UnexpectedFailure: Story = {
  args: { error: new Error('The portals query failed.') },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const invalidate = spyOn(storyRouter!, 'invalidate')
    expect(canvas.getByRole('heading', { name: 'Portals' })).toBeVisible()
    expect(await canvas.findByText('The portals query failed.')).toBeVisible()
    // Storybook's dev-mode React re-runs effects, so assert "reported", not a count.
    await waitFor(() => expect(reported).toHaveBeenCalled())
    for (const [error] of reported.mock.calls) expect(error).toBe(args.error)
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    expect(invalidate).toHaveBeenCalledTimes(1)
    invalidate.mockRestore()
  },
}

export const UnexpectedFailureLight: Story = {
  ...UnexpectedFailure,
  parameters: { ...UnexpectedFailure.parameters, theme: 'light' },
}

/** An expected 4xx refusal is shown but never reported: it is an outcome, not a defect. */
export const ExpectedRefusal: Story = {
  args: { error: withStatus(403, 'You do not have access to this property.') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText('You do not have access to this property.'),
    ).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(reported).not.toHaveBeenCalled()
    expect(storyRouter!.state.location.pathname).not.toBe('/login')
  },
}

/** With no message to show, the page's own sentence stands in for the generic one. */
export const PageFallback: Story = {
  args: { error: new Error(), fallback: 'Portals could not be loaded.' },
  play: async ({ canvasElement }) => {
    expect(
      await within(canvasElement).findByText('Portals could not be loaded.'),
    ).toBeVisible()
  },
}

/** A 401 is an expired session: no error is shown, nothing is reported, sign-in is next. */
export const SignedOut: Story = {
  args: { error: withStatus(401, 'Unauthorized') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(storyRouter!.state.location.pathname).toBe('/login'))
    expect(canvas.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(canvas.queryByText('Unauthorized')).not.toBeInTheDocument()
    expect(reported).not.toHaveBeenCalled()
  },
}
