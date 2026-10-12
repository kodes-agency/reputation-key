// What a person does about a missing text: a link label is written in the
// Linktree; a welcome line or link preview is the property's wording, which only
// an account admin writes, in Welcome. Anyone else is told who writes it, so the
// gap is never a dead end.

import { describe, expect, it } from 'vitest'
import type { MissingPortalText } from '#/contexts/portal/application/public-api'
import { missingTextAction } from './portal-languages-rules'

const gap = (
  kind: MissingPortalText['kind'],
  blocksPublish = false,
): MissingPortalText => ({
  key: kind === 'link_label' ? 'link:l-1' : kind,
  kind,
  linkId: kind === 'link_label' ? 'l-1' : null,
  linkLabel: kind === 'link_label' ? 'Menu' : null,
  blocksPublish,
})

describe('missingTextAction', () => {
  it('sends a link label to the Linktree for anyone', () => {
    for (const canWriteProperty of [true, false]) {
      expect(missingTextAction(gap('link_label'), canWriteProperty)).toEqual({
        kind: 'write',
        section: 'linktree',
      })
    }
  })

  it.each(['title', 'description'] as const)(
    'sends a %s to Welcome for someone who writes the property wording',
    (kind) => {
      expect(missingTextAction(gap(kind), true)).toEqual({
        kind: 'write',
        section: 'welcome',
      })
    },
  )

  it.each(['title', 'description'] as const)(
    'tells everyone else that an account admin writes a %s',
    (kind) => {
      expect(missingTextAction(gap(kind), false)).toEqual({
        kind: 'ask_account_admin',
        section: 'welcome',
      })
    },
  )

  it('sends the same gap to the same place whether or not it blocks publishing', () => {
    expect(missingTextAction(gap('title', true), true)).toEqual(
      missingTextAction(gap('title', false), true),
    )
    expect(missingTextAction(gap('link_label', true), false)).toEqual({
      kind: 'write',
      section: 'linktree',
    })
  })
})
