// The phone-width helper, on real elements with the real stylesheet: a state that
// fits passes, and planted overflow and undersized targets are found.
import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect } from 'storybook/test'
import { assertPhoneWidth, checkPhoneWidths, phoneWidthFindings } from './phone-width'

const meta: Meta = {
  title: 'Testing/Phone width',
  parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobileNarrow' } },
}

export default meta
type Story = StoryObj

function Surface({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex flex-col items-start gap-4 p-4">{children}</div>
}

const BIG_BUTTON = 'h-11 min-w-11 rounded-md border px-3'

export const Fits: Story = {
  render: () => (
    <Surface>
      <button type="button" className={BIG_BUTTON}>
        Save
      </button>
      <p className="text-sm">
        Read the{' '}
        <a href="#terms" className="underline">
          terms
        </a>{' '}
        first.
      </p>
      <div
        role="region"
        aria-label="Wide table"
        tabIndex={0}
        className="w-full overflow-x-auto"
      >
        <table className="w-[560px] text-sm">
          <tbody>
            <tr>
              <td className="p-2">A wide table</td>
              <td className="p-2">holds its own sideways scroll</td>
            </tr>
          </tbody>
        </table>
      </div>
      <label className="flex h-11 items-center gap-2">
        <input type="checkbox" className="sr-only" />
        Remember me
      </label>
    </Surface>
  ),
  play: () => {
    expect(phoneWidthFindings()).toEqual([])
    expect(() => assertPhoneWidth()).not.toThrow()
  },
}

export const PageScrollsSideways: Story = {
  render: () => (
    <Surface>
      <div className="h-11 w-[480px] border">Too wide</div>
    </Surface>
  ),
  play: () => {
    const findings = phoneWidthFindings()
    expect(findings).toContainEqual(
      expect.stringMatching(/^the page scrolls sideways: \d+ px wide in 320 px/),
    )
    expect(findings).toContainEqual(
      expect.stringMatching(/^Too wide extends past the right edge/),
    )
    expect(() => assertPhoneWidth()).toThrow(/320 px: the page scrolls sideways/)
  },
}

export const LayerHangsOffTheWindow: Story = {
  render: () => (
    <div role="menu" className="fixed top-2 left-2 w-[480px] border">
      <button type="button" role="menuitem" className="h-11 w-full text-left">
        Long menu row
      </button>
    </div>
  ),
  play: () => {
    // A fixed layer adds nothing to the page's own width, so only its box shows it.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    expect(phoneWidthFindings()).toContainEqual(
      expect.stringMatching(/extends past the right edge: 488 px in 320 px/),
    )
  },
}

export const ScrollerMustFitItself: Story = {
  render: () => (
    <Surface>
      <div className="w-[480px] overflow-x-auto border">
        <div className="w-[900px]">Inside a scroller too wide for the window</div>
      </div>
    </Surface>
  ),
  play: () => {
    const findings = phoneWidthFindings()
    // The page, and the scroller's own box (496 px), not the 900 px it holds.
    expect(findings).toHaveLength(2)
    expect(findings[1]).toMatch(/extends past the right edge: 496 px/)
  },
}

export const UndersizedTarget: Story = {
  render: () => (
    <Surface>
      <button type="button" className="h-9 min-w-11 rounded-md border px-3">
        Edit
      </button>
    </Surface>
  ),
  play: () => {
    expect(phoneWidthFindings()).toEqual([
      expect.stringMatching(/^Edit is \d+x36; a target is at least 44 px$/),
    ])
  },
}

export const NarrowTarget: Story = {
  render: () => (
    <Surface>
      <button type="button" aria-label="Close" className="h-11 w-8 border" />
    </Surface>
  ),
  play: () => {
    expect(phoneWidthFindings()).toEqual([
      expect.stringMatching(/^Close is 32x44; a target is at least 44 px$/),
    ])
  },
}

export const PadMakesTheTarget: Story = {
  render: () => (
    <Surface>
      <button
        type="button"
        aria-label="Dismiss"
        className="relative size-6 border after:absolute after:-inset-3 after:content-['']"
      />
    </Surface>
  ),
  play: () => {
    expect(phoneWidthFindings()).toEqual([])
  },
}

export const HiddenInputTakesItsLabel: Story = {
  render: () => (
    <Surface>
      <label className="flex h-7 items-center gap-2">
        <input type="checkbox" className="sr-only" />
        Remember me
      </label>
    </Surface>
  ),
  play: () => {
    expect(phoneWidthFindings()).toEqual([
      expect.stringMatching(/^Remember me is 1x1, \d+x28; a target is at least 44 px$/),
    ])
  },
}

export const FocusStopIsNoTarget: Story = {
  render: () => (
    <Surface>
      <div tabIndex={0} className="h-8 w-full overflow-y-auto border">
        A scroll region takes focus and is not pressed
      </div>
    </Surface>
  ),
  play: () => {
    expect(phoneWidthFindings()).toEqual([])
  },
}

export const EveryPhoneWidth: Story = {
  render: Fits.render,
  play: async () => {
    const before = window.innerWidth
    await checkPhoneWidths()
    expect(window.innerWidth).toBe(before)
  },
}

export const OnlyTheNarrowWidthFails: Story = {
  render: () => (
    <Surface>
      <div className="h-11 w-[340px] border">Wider than the narrowest phone</div>
    </Surface>
  ),
  play: async () => {
    const failure = await checkPhoneWidths().then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).toMatch(/^320 px: the page scrolls sideways: \d+ px wide in 320 px/)
    expect(message).not.toMatch(/390 px:/)
  },
}
