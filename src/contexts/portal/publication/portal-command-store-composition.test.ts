import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
// F3: the Portal command store is composed from per-family command modules
// behind the one PortalCommandStore port. No database is touched here: the
// composition only builds closures.
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { createAtomicPortalCommandStore } from './portal-command-store.server'
import { createPortalGroupCommands } from './portal-group-commands.server'
import { createPortalLinkCommands } from './portal-link-commands.server'
import { createPortalLinktreeCommands } from './portal-linktree-commands.server'
import { createPortalPublicationCommands } from '../infrastructure/portal-publication-commands'
import { createPortalTokenCommands } from './portal-token-commands.server'

const db = {} as Database

const LINK = [
  'createPortalLink',
  'updatePortalLink',
  'deletePortalLink',
  'reorderPortalLinks',
]
const LINKTREE = ['savePortalLinkTexts', 'savePortalLinktreeSettings']
const GROUP = [
  'createPortalGroup',
  'updatePortalGroup',
  'addPortalToGroup',
  'removePortalFromGroup',
  'movePortalToGroup',
  'deletePortalGroup',
]
const TOKEN = ['issuePortalToken', 'rotatePortalToken', 'revokePortalTokens']
const PUBLICATION = ['republishPortal']
const CORE = [
  'createPortal',
  'updatePortal',
  'deletePortal',
  'replacePersonalPortalContent',
]

describe('Portal command store composition', () => {
  it('each family module owns exactly its commands', () => {
    expect(Object.keys(createPortalLinkCommands(db)).sort()).toEqual(
      [...LINK, ...LINKTREE].sort(),
    )
    expect(Object.keys(createPortalLinktreeCommands(db)).sort()).toEqual(
      [...LINKTREE].sort(),
    )
    expect(Object.keys(createPortalGroupCommands(db)).sort()).toEqual([...GROUP].sort())
    expect(Object.keys(createPortalTokenCommands(db)).sort()).toEqual([...TOKEN].sort())
    expect(Object.keys(createPortalPublicationCommands(db)).sort()).toEqual(
      [...PUBLICATION].sort(),
    )
  })

  it('the atomic store exposes every command of the port once', () => {
    const keys = Object.keys(
      createAtomicPortalCommandStore(db, createPortalRatingGoalGuard()),
    ).sort()
    expect(keys).toEqual(
      [...CORE, ...LINK, ...LINKTREE, ...GROUP, ...TOKEN, ...PUBLICATION].sort(),
    )
  })
})
