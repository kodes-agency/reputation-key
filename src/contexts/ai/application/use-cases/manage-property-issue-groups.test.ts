import { describe, expect, it } from 'vitest'
import type {
  AiIssueGroupStorePort,
  PropertyIssueGroup,
  PropertyIssueScope,
} from '../ports/ai-issue-group-store.port'
import { createManagePropertyIssueGroups } from './manage-property-issue-groups'

const NOW = new Date('2026-10-30T08:00:00.000Z')
const SCOPE = {
  organizationId: 'org-property-issue-unit',
  propertyId: '00000000-0000-4000-8000-000000000201',
} as const
const SOURCE = '00000000-0000-4000-8000-000000000202'
const TARGET = '00000000-0000-4000-8000-000000000203'
const REDIRECT = '00000000-0000-4000-8000-000000000204'

function issue(
  id: string,
  overrides: Partial<PropertyIssueGroup> = {},
): PropertyIssueGroup {
  return {
    id,
    ...SCOPE,
    topic: 'facilities_equipment',
    canonicalThing: 'air conditioning',
    canonicalKey: 'air conditioning',
    displayName: null,
    mergedIntoIssueId: null,
    hiddenAt: null,
    hiddenBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    lastSeenAt: NOW,
    expiresAt: new Date('2028-10-30T08:00:00.000Z'),
    normalizationVersion: 'property-issue-normalization-v1',
    ...overrides,
  }
}

function fakeStore(seed: readonly PropertyIssueGroup[] = [issue(SOURCE), issue(TARGET)]) {
  const groups = new Map(seed.map((group) => [group.id, group]))
  const renameInputs: Array<string | null> = []
  let visibilityWrites = 0

  const scoped = (scope: PropertyIssueScope, id: string) => {
    const row = groups.get(id)
    if (
      row === undefined ||
      row.organizationId !== scope.organizationId ||
      row.propertyId !== scope.propertyId
    ) {
      return null
    }
    return row
  }
  const resolve = (scope: PropertyIssueScope, id: string) => {
    const row = scoped(scope, id)
    if (row === null) return null
    return row.mergedIntoIssueId === null
      ? row
      : (scoped(scope, row.mergedIntoIssueId) ?? null)
  }

  const store: AiIssueGroupStorePort = {
    async rename(scope, id, displayName, updatedAt) {
      renameInputs.push(displayName)
      const row = resolve(scope, id)
      if (row === null) return { status: 'not_found' }
      const updated = { ...row, displayName, updatedAt }
      groups.set(updated.id, updated)
      return { status: 'applied', issue: updated }
    },
    async setHidden(scope, id, hidden, updatedAt) {
      const row = resolve(scope, id)
      if (row === null) return { status: 'not_found' }
      const noChange = hidden === null ? row.hiddenAt === null : row.hiddenAt !== null
      if (noChange) return { status: 'applied', changed: false, issue: row }
      visibilityWrites += 1
      const updated = {
        ...row,
        hiddenAt: hidden?.at ?? null,
        hiddenBy: hidden?.by ?? null,
        updatedAt,
      }
      groups.set(updated.id, updated)
      return { status: 'applied', changed: true, issue: updated }
    },
    async merge(scope, sourceId, targetId, updatedAt) {
      const source = resolve(scope, sourceId)
      const target = resolve(scope, targetId)
      if (source === null || target === null) return { status: 'not_found' }
      if (source.id === target.id) return { status: 'same_issue' }
      if (source.topic !== target.topic) return { status: 'cross_topic' }
      for (const row of groups.values()) {
        if (row.mergedIntoIssueId === source.id) {
          groups.set(row.id, { ...row, mergedIntoIssueId: target.id, updatedAt })
        }
      }
      groups.set(source.id, { ...source, mergedIntoIssueId: target.id, updatedAt })
      const updatedTarget = {
        ...target,
        expiresAt:
          target.expiresAt > source.expiresAt ? target.expiresAt : source.expiresAt,
        updatedAt,
      }
      groups.set(target.id, updatedTarget)
      return { status: 'applied', issue: updatedTarget, sourceIssueId: source.id }
    },
    async resolve(scope, id) {
      const requested = scoped(scope, id)
      const row = resolve(scope, id)
      if (requested === null || row === null) return { status: 'not_found' }
      return {
        status: 'found',
        issue: row,
        redirectedFromIssueId: requested.id === row.id ? null : requested.id,
      }
    },
  }
  return {
    store,
    groups,
    renameInputs,
    visibilityWrites: () => visibilityWrites,
  }
}

function harness(seed?: readonly PropertyIssueGroup[]) {
  const fake = fakeStore(seed)
  return {
    ...fake,
    commands: createManagePropertyIssueGroups({ store: fake.store, clock: () => NOW }),
  }
}

describe('manage Property issue groups', () => {
  it('normalizes a manager display name and can clear it', async () => {
    const { commands, renameInputs } = harness()

    await commands.rename(SCOPE, SOURCE, '  Ｃｏｏｌｉｎｇ   system  ')
    await commands.rename(SCOPE, SOURCE, '   ')

    expect(renameInputs).toEqual(['Cooling system', null])
  })

  it('refuses control characters, line breaks and names over 80 characters', async () => {
    const { commands } = harness()

    await expect(commands.rename(SCOPE, SOURCE, 'Cooling\nunit')).rejects.toMatchObject({
      _tag: 'AiError',
      code: 'invalid_request',
      message: 'Property issue display name is invalid',
    })
    await expect(commands.rename(SCOPE, SOURCE, 'x'.repeat(81))).rejects.toMatchObject({
      _tag: 'AiError',
      code: 'invalid_request',
      message: 'Property issue display name is invalid',
    })
  })

  it('hides and shows an issue with the injected clock', async () => {
    const { commands } = harness()

    const hidden = await commands.hide(SCOPE, SOURCE, 'manager-unit')
    const shown = await commands.show(SCOPE, SOURCE)

    expect(hidden).toMatchObject({
      status: 'applied',
      changed: true,
      issue: { hiddenAt: NOW, hiddenBy: 'manager-unit' },
    })
    expect(shown).toMatchObject({
      status: 'applied',
      changed: true,
      issue: { hiddenAt: null, hiddenBy: null },
    })
  })

  it('treats repeated hide and show commands as no-op successes', async () => {
    const { commands, visibilityWrites } = harness()

    await commands.hide(SCOPE, SOURCE, 'manager-unit')
    const hiddenAgain = await commands.hide(SCOPE, SOURCE, 'manager-other')
    await commands.show(SCOPE, SOURCE)
    const shownAgain = await commands.show(SCOPE, SOURCE)

    expect(hiddenAgain).toMatchObject({ status: 'applied', changed: false })
    expect(shownAgain).toMatchObject({ status: 'applied', changed: false })
    expect(visibilityWrites()).toBe(2)
  })

  it('refuses an invalid actor id without calling the store', async () => {
    const { commands, visibilityWrites } = harness()

    await expect(commands.hide(SCOPE, SOURCE, ' manager ')).rejects.toMatchObject({
      _tag: 'AiError',
      code: 'invalid_request',
      message: 'Property issue actor is invalid',
    })
    expect(visibilityWrites()).toBe(0)
  })

  it('returns every merge refusal as a closed tagged outcome', async () => {
    const otherTopic = issue(REDIRECT, { topic: 'cleanliness' })
    const { commands } = harness([issue(SOURCE), issue(TARGET), otherTopic])

    await expect(commands.merge(SCOPE, SOURCE, SOURCE)).resolves.toEqual({
      status: 'same_issue',
    })
    await expect(commands.merge(SCOPE, SOURCE, REDIRECT)).resolves.toEqual({
      status: 'cross_topic',
    })
    await expect(
      commands.merge(SCOPE, SOURCE, '00000000-0000-4000-8000-000000000299'),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('resolves old ids before merging and flattens redirects into the target', async () => {
    const oldRedirect = issue(REDIRECT, { mergedIntoIssueId: SOURCE })
    const { commands, groups } = harness([issue(SOURCE), issue(TARGET), oldRedirect])

    const merged = await commands.merge(SCOPE, REDIRECT, TARGET)

    expect(merged).toMatchObject({ status: 'applied', sourceIssueId: SOURCE })
    expect(groups.get(SOURCE)?.mergedIntoIssueId).toBe(TARGET)
    expect(groups.get(REDIRECT)?.mergedIntoIssueId).toBe(TARGET)
  })

  it('keeps the target hidden state and raises only its expiry on merge', async () => {
    const later = new Date('2029-01-01T00:00:00.000Z')
    const target = issue(TARGET, {
      hiddenAt: NOW,
      hiddenBy: 'manager-unit',
      expiresAt: new Date('2028-01-01T00:00:00.000Z'),
    })
    const { commands } = harness([issue(SOURCE, { expiresAt: later }), target])

    const result = await commands.merge(SCOPE, SOURCE, TARGET)

    expect(result).toMatchObject({
      status: 'applied',
      issue: { hiddenAt: NOW, hiddenBy: 'manager-unit', expiresAt: later },
    })
  })

  it('resolves a redirect and reports the old id for a drawer redirect', async () => {
    const { commands } = harness([
      issue(TARGET),
      issue(REDIRECT, { mergedIntoIssueId: TARGET }),
    ])

    await expect(commands.resolve(SCOPE, REDIRECT)).resolves.toMatchObject({
      status: 'found',
      issue: { id: TARGET },
      redirectedFromIssueId: REDIRECT,
    })
  })

  it('does not reveal an issue from another tenant scope', async () => {
    const { commands } = harness()

    await expect(
      commands.resolve({ ...SCOPE, organizationId: 'org-other' }, SOURCE),
    ).resolves.toEqual({ status: 'not_found' })
  })
})
