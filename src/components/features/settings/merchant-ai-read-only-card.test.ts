// What a PropertyManager reads where an AccountAdmin changes AI consent: the state,
// the lock and who decides. It carries no control, because the server refuses them.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  MerchantAiReadOnlyCard,
  merchantAiReadOnlyState,
  type MerchantAiReadOnlyState,
} from './merchant-ai-read-only-card'

const render = (state: MerchantAiReadOnlyState) =>
  renderToStaticMarkup(
    createElement(MerchantAiReadOnlyCard, { propertyName: 'Harborline Suites', state }),
  )

describe('MerchantAiReadOnlyCard', () => {
  it('says AI is on, and who decides', () => {
    const html = render('on')

    expect(html).toContain('AI is on for Harborline Suites.')
    expect(html).toContain('An account admin decides whether AI is on.')
  })

  it('says AI is off, and who decides', () => {
    const html = render('off')

    expect(html).toContain('AI is off for Harborline Suites.')
    expect(html).toContain('An account admin decides whether AI is on.')
  })

  it('offers no way to change it', () => {
    const html = render('off')

    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<a ')
  })

  it('waits for the state rather than guessing it', () => {
    const html = render('checking')

    expect(html).toContain('Checking whether AI is on')
    expect(html).not.toContain('AI is off for')
    expect(html).not.toContain('AI is on for')
  })

  it('says so when the state could not be read, rather than guessing it', () => {
    const html = render('unavailable')

    expect(html).toContain('could not be checked')
    expect(html).not.toContain('AI is off for')
    expect(html).not.toContain('AI is on for')
    expect(html).toContain('An account admin decides whether AI is on.')
  })

  it('hides the lock from assistive technology; the sentence beside it says it', () => {
    expect(render('on')).toMatch(/<svg[^>]*aria-hidden="true"/u)
  })
})

describe('merchantAiReadOnlyState', () => {
  it('reports the state once it is read, whatever the failure flag says', () => {
    expect(merchantAiReadOnlyState(true, false)).toBe('on')
    expect(merchantAiReadOnlyState(false, false)).toBe('off')
    expect(merchantAiReadOnlyState(false, true)).toBe('off')
  })

  it('is checking while nothing is read and nothing has failed, unavailable once it has', () => {
    expect(merchantAiReadOnlyState(undefined, false)).toBe('checking')
    expect(merchantAiReadOnlyState(undefined, true)).toBe('unavailable')
  })
})
