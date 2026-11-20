// The checks under a chosen picture: a rule that fails reads as an error, advice
// that is not taken reads as the warning tone, and each is said aloud as what it
// is, since neither the icon nor the colour reaches a screen reader.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ImageCheck } from './image-checks'
import { ImageChecksList } from './image-checks-list'

const html = (checks: readonly ImageCheck[]) =>
  renderToStaticMarkup(createElement(ImageChecksList, { checks }))

const PASSED: ImageCheck = { id: 'format', passed: true, label: 'JPG, PNG or WebP' }
const FAILED: ImageCheck = { id: 'size', passed: false, label: 'Too small' }
const ADVICE: ImageCheck = {
  id: 'print',
  passed: false,
  advisory: true,
  label: 'May look soft in print: use a photo at least 1000 px wide',
}

/** The markup of the one line that carries `data-state`. */
const lineOf = (markup: string, state: string) =>
  markup.match(new RegExp(`<li[^>]*data-state="${state}".*?</li>`, 'su'))?.[0] ?? ''

describe('ImageChecksList', () => {
  it('shows advice that is not taken as a warning, said as advice, not as a failure', () => {
    const line = lineOf(html([ADVICE]), 'advice')

    expect(line).toContain('text-warn')
    expect(line).not.toContain('text-negative')
    expect(line).toContain('Advice: ')
    expect(line).not.toContain('Failed: ')
    expect(line).toContain('May look soft in print')
  })

  it('shows a rule that fails as an error', () => {
    const line = lineOf(html([FAILED]), 'failed')

    expect(line).toContain('text-negative')
    expect(line).toContain('Failed: ')
  })

  it('shows a check that passes as passed, whether it is a rule or advice', () => {
    const rule = lineOf(html([PASSED]), 'passed')
    const advice = lineOf(html([{ ...ADVICE, passed: true }]), 'passed')

    expect(rule).toContain('Passed: ')
    expect(advice).toContain('Passed: ')
    expect(advice).not.toContain('text-warn')
  })

  it('lists them in the order given, under one announced list', () => {
    const markup = html([FAILED, ADVICE, PASSED])

    expect(markup).toContain('aria-label="Checks"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup.indexOf('Too small')).toBeLessThan(markup.indexOf('May look soft'))
    expect(markup.indexOf('May look soft')).toBeLessThan(markup.indexOf('JPG, PNG'))
  })
})
