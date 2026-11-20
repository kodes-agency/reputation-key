// The setup parts as the server draws them. The Google rating goal passes them
// everything they take (a labelled panel, a quoted lead, a status line with no
// live region of its own to speak); the branches below are the ones a goal that
// passes less takes, and a branch no test names would change under it unseen.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '#/components/ui/tooltip'
import {
  GoalAside,
  GoalHeroStepper,
  GoalRecommendedTag,
  GoalSetupLinks,
  GoalSetupPanel,
  GoalSetupStatusLine,
  HERO_STEPPER_GAP,
  HERO_STEPPER_TOUCH,
  type GoalStatusPart,
} from './goal-setup-parts'

const noop = () => undefined

const statusLine = (
  parts: readonly GoalStatusPart<number>[],
  props: Partial<Parameters<typeof GoalSetupStatusLine<number>>[0]> = {},
) =>
  renderToStaticMarkup(
    createElement(GoalSetupStatusLine<number>, {
      slot: 'a-goal-status',
      parts,
      small: false,
      onAction: noop,
      ...props,
    }),
  )

describe('GoalHeroStepper', () => {
  const stepper = (props: { small?: boolean; inert?: boolean } = {}) =>
    renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(GoalHeroStepper, {
          small: props.small ?? false,
          lower: { label: 'Lower to 35', inert: props.inert ?? false, onPress: noop },
          raise: { label: 'Raise to 45', inert: false, onPress: noop },
          children: createElement('b', null, '40'),
        }),
      ),
    )

  it('draws the goal between the lower and the raise, each named', () => {
    const html = stepper()

    expect(html.indexOf('Lower to 35')).toBeLessThan(html.indexOf('<b>40</b>'))
    expect(html.indexOf('<b>40</b>')).toBeLessThan(html.indexOf('Raise to 45'))
  })

  it('keeps a stepper that does nothing in the tab order, saying so', () => {
    const html = stepper({ inert: true })

    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/u)
  })

  it('leaves the gap to the figure: 40 px, 16 px on a phone', () => {
    expect(stepper()).toContain('gap:40px')
    expect(stepper({ small: true })).toContain('gap:16px')
  })

  it('names the gaps and the touch width a goal fits its figure to, as it draws them', () => {
    expect(stepper()).toContain(`gap:${HERO_STEPPER_GAP.desktop}px`)
    expect(stepper({ small: true })).toContain(`gap:${HERO_STEPPER_GAP.phone}px`)
    expect(HERO_STEPPER_TOUCH).toBe(44)
  })
})

describe('GoalSetupStatusLine', () => {
  it('draws the tag, the words and the link in their order, a quiet dot between them', () => {
    const html = statusLine([
      { kind: 'tag', text: 'The tag' },
      { kind: 'text', text: 'the words' },
      { kind: 'link', text: 'The link', action: 7 },
    ])

    expect(html).toContain('data-slot="a-goal-status"')
    expect(html.indexOf('The tag')).toBeLessThan(html.indexOf('the words'))
    expect(html.indexOf('the words')).toBeLessThan(html.indexOf('The link'))
    expect(html.match(/aria-hidden="true"[^>]*>·</gu)).toHaveLength(2)
  })

  it('says nothing about being live unless the goal asks', () => {
    const parts: readonly GoalStatusPart<number>[] = [{ kind: 'text', text: 'Words' }]

    expect(statusLine(parts)).not.toContain('aria-live')
    expect(statusLine(parts, { live: 'polite' })).toContain('aria-live="polite"')
    expect(statusLine(parts, { live: 'off' })).toContain('aria-live="off"')
  })

  it('disables the links while the goal is saving, and only then', () => {
    const parts: readonly GoalStatusPart<number>[] = [
      { kind: 'link', text: 'The link', action: 7 },
    ]

    expect(statusLine(parts)).not.toMatch(/\sdisabled=""/u)
    expect(statusLine(parts, { disabled: true })).toMatch(/\sdisabled=""/u)
  })

  it('wraps and centres on a phone, and holds a line of room either way', () => {
    const parts: readonly GoalStatusPart<number>[] = [{ kind: 'text', text: 'Words' }]

    expect(statusLine(parts)).toContain('min-height:30px')
    expect(statusLine(parts)).not.toContain('flex-wrap')
    expect(statusLine(parts, { small: true })).toContain('min-height:28px')
    expect(statusLine(parts, { small: true })).toContain('flex-wrap')
  })

  it('stacks its parts, one to a line and no dot between them, when the goal asks', () => {
    const parts: readonly GoalStatusPart<number>[] = [
      { kind: 'tag', text: 'The tag' },
      { kind: 'text', text: 'the words' },
      { kind: 'link', text: 'The link', action: 7 },
    ]
    const stacked = statusLine(parts, { small: true, stack: true })

    expect(stacked).toContain('flex-col')
    expect(stacked).not.toContain('flex-wrap')
    expect(stacked).not.toContain('·')
    expect(stacked.indexOf('The tag')).toBeLessThan(stacked.indexOf('the words'))
    expect(stacked.indexOf('the words')).toBeLessThan(stacked.indexOf('The link'))
  })

  it('draws the row of parts and its dots unless the goal asks to stack', () => {
    const parts: readonly GoalStatusPart<number>[] = [
      { kind: 'tag', text: 'The tag' },
      { kind: 'text', text: 'the words' },
    ]

    expect(statusLine(parts, { small: true })).toContain('·')
    expect(statusLine(parts, { small: true })).not.toContain('flex-col')
    expect(statusLine(parts, { small: true, stack: false })).toBe(
      statusLine(parts, { small: true }),
    )
  })

  it('draws the tag as the shared recommendation tag', () => {
    expect(statusLine([{ kind: 'tag', text: 'Tag' }])).toContain(
      renderToStaticMarkup(createElement(GoalRecommendedTag, null, 'Tag')),
    )
  })
})

describe('GoalSetupPanel', () => {
  const panel = (props: { label?: string; small?: boolean }) =>
    renderToStaticMarkup(
      createElement(GoalSetupPanel, {
        small: props.small ?? false,
        ...(props.label ? { label: props.label } : {}),
        children: createElement('i', null, 'the way to choose'),
      }),
    )

  it('is a named region when it has a label', () => {
    const html = panel({ label: 'The choices' })

    expect(html).toMatch(/^<section aria-label="The choices"/u)
    expect(html).toContain('the way to choose')
  })

  it('is a plain block with no label, so a control inside it can carry the name alone', () => {
    const html = panel({})

    expect(html).toMatch(/^<div /u)
    expect(html).not.toContain('aria-label')
    expect(html).not.toContain('<section')
  })

  it('takes less room on a phone', () => {
    expect(panel({})).toContain('px-6 py-4')
    expect(panel({ small: true })).toContain('px-4 py-3')
  })
})

describe('GoalAside', () => {
  const aside = (lead?: string) =>
    renderToStaticMarkup(
      createElement(GoalAside, {
        ...(lead === undefined ? {} : { lead }),
        children: 'The line itself.',
      }),
    )

  it('quotes the line with no lead when the goal has none', () => {
    const html = aside()

    expect(html).toContain('The line itself.')
    expect(html).not.toContain('<b')
  })

  it('leads with a bold word or two when the goal gives them', () => {
    expect(aside('How to ask:')).toContain(
      '<b class="font-semibold text-foreground">How to ask:</b> The line itself.',
    )
  })
})

describe('GoalSetupLinks', () => {
  const links = (small: boolean) =>
    renderToStaticMarkup(
      createElement(GoalSetupLinks, {
        sentence: 'How it counts.',
        small,
        children: createElement('a', null, 'a link'),
      }),
    )

  it('says how the goal counts before its links', () => {
    const html = links(false)

    expect(html.indexOf('How it counts.')).toBeLessThan(html.indexOf('a link'))
  })

  it('leaves the sentence out on a phone, where the room is short, and keeps the links', () => {
    const html = links(true)

    expect(html).not.toContain('How it counts.')
    expect(html).toContain('a link')
  })
})
