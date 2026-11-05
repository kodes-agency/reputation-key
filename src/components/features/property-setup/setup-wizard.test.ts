import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SetupWizard } from './setup-wizard'
import { SETUP_WIZARD_STEPS } from './setup-wizard-steps'

describe('SetupWizard', () => {
  it.each(SETUP_WIZARD_STEPS)('marks only $title as the current step', (step) => {
    const html = renderToStaticMarkup(
      createElement(SetupWizard, { step: step.id, children: 'Property questions' }),
    )
    const list = html.match(/<ol\b[^>]*aria-label="Import steps"[^>]*>(.*?)<\/ol>/u)?.[1]

    expect(list).toBeDefined()
    const items = [...list!.matchAll(/<li\b([^>]*)>(.*?)<\/li>/gu)]
    expect(items).toHaveLength(5)
    expect([...list!.matchAll(/<svg\b/gu)]).toHaveLength(SETUP_WIZARD_STEPS.indexOf(step))
    items.forEach(([_, attributes, content], index) => {
      expect(content).toContain(SETUP_WIZARD_STEPS[index]!.title)
      expect(content).toContain(SETUP_WIZARD_STEPS[index]!.description)
      expect(attributes!.includes('aria-current="step"')).toBe(
        SETUP_WIZARD_STEPS[index]!.id === step.id,
      )
    })
    expect(html).toContain(
      `Step ${SETUP_WIZARD_STEPS.indexOf(step) + 1} of 5: ${step.title}`,
    )
    expect(html).toContain('Property questions')
  })

  it('leaves navigation to the screen instead of offering interactive steps', () => {
    const html = renderToStaticMarkup(
      createElement(SetupWizard, { step: 'confirm', children: 'Property questions' }),
    )

    expect(html).not.toMatch(/<(?:button|a)\b|\btabindex=|role="tab(?:list|panel)?"/u)
  })
})
