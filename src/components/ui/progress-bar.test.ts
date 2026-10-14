// A bar that shows how far a count has got toward a whole. It is read by people
// who cannot see it, so it carries its value, range and a sentence; and it moves
// with a transform, not with its width.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  composite,
  contrastRatio,
  readTokenBlock,
  resolveColour,
} from '#/shared/testing/oklch-contrast'
import { ProgressBar, progressFraction, TONE_BAR } from './progress-bar'
import type { Tone } from './tone'

const render = (props: Parameters<typeof ProgressBar>[0]) =>
  renderToStaticMarkup(createElement(ProgressBar, props))

describe('progressFraction', () => {
  it('is the share of the whole that has been reached', () => {
    expect(progressFraction(64, 120)).toBeCloseTo(0.5333, 4)
    expect(progressFraction(0, 120)).toBe(0)
    expect(progressFraction(120, 120)).toBe(1)
  })

  it('stays inside the bar for a count past its whole or below zero', () => {
    expect(progressFraction(150, 120)).toBe(1)
    expect(progressFraction(-3, 120)).toBe(0)
  })

  it('is empty, not a division by zero, for a whole of nothing', () => {
    expect(progressFraction(5, 0)).toBe(0)
    expect(progressFraction(0, 0)).toBe(0)
    expect(progressFraction(Number.NaN, 10)).toBe(0)
  })
})

describe('ProgressBar', () => {
  it('is a progressbar with its range, its value and its name', () => {
    const html = render({ value: 64, max: 120, label: 'Qualified scans this month' })

    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuemin="0"')
    expect(html).toContain('aria-valuemax="120"')
    expect(html).toContain('aria-valuenow="64"')
    expect(html).toContain('aria-label="Qualified scans this month"')
  })

  it('says its value as a sentence, "64 of 120" unless the caller words it', () => {
    expect(render({ value: 64, max: 120, label: 'Scans' })).toContain(
      'aria-valuetext="64 of 120"',
    )
    expect(
      render({ value: 64, max: 120, label: 'Scans', valueText: '64 of 120 so far' }),
    ).toContain('aria-valuetext="64 of 120 so far"')
  })

  it('keeps the value inside its range and says the whole truth in the sentence', () => {
    const html = render({ value: 150, max: 120, label: 'Scans' })

    expect(html).toContain('aria-valuenow="120"')
    expect(html).toContain('aria-valuetext="150 of 120"')
  })

  it('fills with a transform, never with a width or a layout property', () => {
    const html = render({ value: 60, max: 120, label: 'Scans' })

    expect(html).toContain('transform:scaleX(0.5)')
    expect(html).not.toMatch(/style="[^"]*(width|height|left|margin)/)
    expect(html).toContain('motion-reduce:transition-none')
  })

  it('is neutral unless it is given a tone, and wears the tone it is given', () => {
    expect(render({ value: 1, max: 2, label: 'x' })).toContain('data-tone="neutral"')
    const warn = render({ value: 1, max: 2, label: 'x', tone: 'warn' })
    expect(warn).toContain('data-tone="warn"')
    expect(warn).toContain(TONE_BAR.warn)
  })

  it('cuts a notch at a point on the way, placed by a transform and kept from assistive technology', () => {
    const html = render({ value: 1, max: 2, label: 'x', marker: 0.25 })

    expect(html).toMatch(/data-slot="progress-bar-marker" aria-hidden="true"/u)
    expect(html).toContain('transform:translateX(25%)')
    expect(html).not.toMatch(/style="[^"]*(width|height|left|margin)/)
    expect(render({ value: 1, max: 2, label: 'x' })).not.toContain('progress-bar-marker')
  })

  it('is a block the caller can size, with a track under the fill', () => {
    const html = render({ value: 1, max: 2, label: 'x', className: 'mt-2' })

    expect(html).toContain('data-slot="progress-bar"')
    expect(html).toContain('bg-muted')
    expect(html).toContain('mt-2')
  })
})

const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
const light = readTokenBlock(css, ':root')
const dark = readTokenBlock(css, '.dark')
const themeBlock = readTokenBlock(css, '@theme inline')

/** The token behind a `bg-*` class, by the stylesheet's `@theme` block. */
function fillToken(classes: string): { token: string; alpha: number } {
  const match = /(?:^|\s)bg-([\w-]+?)(?:\/(\d+))?(?:\s|$)/.exec(classes)
  if (!match) throw new Error(`No bg-* utility in: ${classes}`)
  const mapped = themeBlock.get(`--color-${match[1]}`)
  const token = mapped === undefined ? null : /^var\((--[\w-]+)\)$/.exec(mapped)?.[1]
  if (!token) throw new Error(`bg-${match[1]} is not a mapped colour`)
  return { token, alpha: match[2] === undefined ? 1 : Number(match[2]) / 100 }
}

describe.each([
  { name: 'light', tokens: light, base: new Map<string, string>() },
  { name: 'dark', tokens: dark, base: light },
])('$name theme bar tones', ({ tokens, base }) => {
  const TONES: readonly Tone[] = ['positive', 'warn', 'negative', 'info', 'neutral']

  it.each(TONES)('%s fill reads against the track at 3:1 (a graphic)', (tone) => {
    const track = resolveColour('--muted', tokens, base)
    const { token, alpha } = fillToken(TONE_BAR[tone])
    const fill = composite(resolveColour(token, tokens, base), track, alpha)

    expect(contrastRatio(fill, track)).toBeGreaterThanOrEqual(3)
  })
})
