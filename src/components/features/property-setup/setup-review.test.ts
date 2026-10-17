// The consent ceremony at the end of the setup review (merchant-ai-notice-2026-10-17.v1).
//
// Naming every Property in the call to action made one button line as long as
// the batch: twenty names ran it off the page. The button now only says what it
// does, "Enable AI features", for one Property or many, and the acknowledgement
// carries the names: one in its sentence, several as a list under it. These
// checks pin the markup (server-rendered, no DOM); the ticking and the save run
// in the Storybook project.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MERCHANT_AI_NOTICE } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import type { PropertySetupPlan } from './setup-plan'
import { SetupReview } from './setup-review'

function entry(name: string, ai: PropertySetupPlan['ai'] = 'enable'): PropertySetupPlan {
  return {
    propertyId: `property-${name.toLowerCase().replaceAll(' ', '-')}`,
    propertyName: name,
    displayName: null,
    language: null,
    managerIds: null,
    ai,
  }
}

function render(properties: readonly PropertySetupPlan[]): string {
  return renderToStaticMarkup(
    createElement(SetupReview, {
      plan: {
        properties,
        aiCapabilities: properties.some((property) => property.ai === 'enable')
          ? ['review_analysis', 'reply_drafting', 'property_trends']
          : [],
      },
      facts: [],
      members: new Map(),
      notice: MERCHANT_AI_NOTICE,
      acknowledged: false,
      onAcknowledgedChange: () => undefined,
      saving: false,
      onBack: () => undefined,
      onSave: () => undefined,
    }),
  )
}

const textOf = (markup: string): string => markup.replace(/<[^>]+>/gu, '')

/** The save button: the last button of the review, after Back. */
function saveButtonText(html: string): string {
  const buttons = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/gu)]
  return textOf(buttons.at(-1)?.[1] ?? '')
}

function acknowledgement(html: string): string {
  return textOf(
    html.match(/<label[^>]*for="setup-ai-acknowledgement"[^>]*>(.*?)<\/label>/u)?.[1] ??
      '',
  )
}

function listedProperties(html: string): readonly string[] {
  const list = html.match(/<div id="setup-ai-acknowledgement-details"[^>]*>(.*?)<\/div>/u)
  return [...(list?.[1] ?? '').matchAll(/<li[^>]*>(.*?)<\/li>/gu)].map((item) =>
    textOf(item[1]),
  )
}

describe('SetupReview consent', () => {
  it('names the one Property in the acknowledgement and none on the button', () => {
    const html = render([entry('Harbour Inn')])

    expect(saveButtonText(html)).toBe('Enable AI features')
    expect(acknowledgement(html)).toBe(
      'I have read this notice and agree to this data use for Harbour Inn on behalf of my organization.',
    )
    expect(html).not.toContain('setup-ai-acknowledgement-details')
  })

  it('lists every Property the consent covers under the acknowledgement, in order', () => {
    const names = Array.from({ length: 24 }, (_, index) => `Sample Property ${index + 1}`)
    const html = render([
      ...names.map((name) => entry(name)),
      entry('Deferred Place', 'defer'),
    ])

    expect(saveButtonText(html)).toBe('Enable AI features')
    expect(acknowledgement(html)).toBe(
      'I have read this notice and agree to this data use on behalf of my organization for these 24 properties:',
    )
    expect(listedProperties(html)).toEqual(names)
    // The list is the checkbox's description, ahead of its line of help.
    expect(html).toContain(
      'aria-describedby="setup-ai-acknowledgement-details setup-ai-acknowledgement-description"',
    )
  })

  it('lets a long name wrap rather than widen the page', () => {
    const long = `Property${'Name'.repeat(30)}`
    const html = render([entry(long), entry('Harbour Inn')])

    expect(listedProperties(html)).toEqual([long, 'Harbour Inn'])
    expect(html).toMatch(/<li class="[^"]*wrap-anywhere[^"]*">Property(?:Name)+<\/li>/u)
    // The button keeps the base button's single line: its words never grow.
    expect(saveButtonText(html)).toBe('Enable AI features')
  })

  it('asks for no consent when nothing turns AI on', () => {
    const html = render([entry('Harbour Inn', 'defer')])

    expect(saveButtonText(html)).toBe('Save setup')
    expect(html).not.toContain('setup-ai-acknowledgement')
  })
})
