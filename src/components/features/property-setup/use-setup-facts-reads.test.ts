import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  QueryClient,
  QueryClientProvider,
  environmentManager,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createKeys,
  portalKeys,
  propertyKeys,
  reviewKeys,
} from '#/shared/queries/query-keys'
import type { PropertySetupFns } from './property-setup-contract'
import { useSetupFacts, type SetupFactsState } from './use-setup-facts'

const scope = { userId: 'user-1', organizationId: 'org-1' }
const { identityKeys } = createKeys(scope)

vi.mock('#/shared/hooks/useTenantScope', () => ({ useTenantScope: () => scope }))

const imported = [
  { propertyId: 'p1', propertyName: 'First' },
  { propertyId: 'p2', propertyName: 'Second' },
]

let client: QueryClient

beforeEach(() => {
  environmentManager.setIsServer(() => false)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  client.clear()
  environmentManager.setIsServer(() => typeof window === 'undefined')
})

function render(fns: PropertySetupFns): SetupFactsState {
  let state: SetupFactsState | undefined
  function Harness() {
    state = useSetupFacts(imported, fns)
    return null
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Harness)))
  if (!state) throw new Error('the hook did not render')
  return state
}

const asFns = (partial: Record<string, unknown>) => partial as unknown as PropertySetupFns

const managers = (userId: string) => ({
  assignments: [{ userId }],
  eligibleManagers: [{ userId }, { userId: 'spare' }],
})
const experience = (displayName: string | null) => ({
  profile: displayName ? { displayName } : null,
  publicDisplayNameConfirmed: displayName !== null,
})
const setup = (voiceComplete: boolean) => ({
  steps: [{ key: 'reply_voice', status: voiceComplete ? 'complete' : 'todo' }],
})

/** Put every read into the cache the way the hook's own queries would fill it. */
async function seed(options: { skip?: string; fail?: string } = {}) {
  const entries: Array<[readonly unknown[], unknown]> = [
    [
      propertyKeys.list(),
      {
        properties: [
          { id: 'p1', name: 'First', countryCode: 'US', defaultReplyLanguage: 'en' },
          { id: 'p2', name: 'Second' },
        ],
      },
    ],
    [identityKeys.merchantAiOverview(), { properties: [] }],
    [identityKeys.merchantAiNotice(), { version: 3, digest: 'd' }],
    [
      identityKeys.members(),
      { members: [{ userId: 'm1', name: 'Mo', email: 'mo@example.com' }] },
    ],
    [propertyKeys.responsibleManagers('p1'), managers('m1')],
    [propertyKeys.responsibleManagers('p2'), managers('m2')],
    [portalKeys.propertyExperience('p1'), experience('First Hotel')],
    [portalKeys.propertyExperience('p2'), experience(null)],
    [propertyKeys.setup('p1'), setup(true)],
    [propertyKeys.setup('p2'), setup(false)],
    [reviewKeys.replyLibrary('p1'), { voice: 'warm', voiceVersion: 2 }],
    [reviewKeys.replyLibrary('p2'), { voice: null, voiceVersion: 0 }],
  ]
  for (const [key, data] of entries) {
    const id = JSON.stringify(key)
    if (id === options.skip) continue
    if (id === options.fail) {
      await client
        .fetchQuery({ queryKey: key, queryFn: () => Promise.reject(new Error('x')) })
        .catch(() => {})
      continue
    }
    client.setQueryData(key, data)
  }
}

describe('useSetupFacts', () => {
  it('reads each fact from its own property, by position', async () => {
    await seed()

    const state = render(asFns({}))

    if (state.status !== 'ready') throw new Error('expected ready')
    expect(state.facts.map((fact) => fact.propertyId)).toEqual(['p1', 'p2'])
    expect(state.facts[0]).toMatchObject({
      publicDisplayName: 'First Hotel',
      publicDisplayNameConfirmed: true,
      countryCode: 'US',
      managerIds: ['m1'],
      replyVoiceConfigured: true,
      replyVoiceVersion: 2,
      propertyCount: 2,
    })
    expect(state.facts[1]).toMatchObject({
      publicDisplayName: null,
      managerIds: ['m2'],
      eligibleManagerIds: ['m2', 'spare'],
      replyVoiceConfigured: false,
      countryCode: null,
    })
    expect(state.members.get('m1')).toEqual({
      userId: 'm1',
      name: 'Mo',
      email: 'mo@example.com',
    })
    expect(state.notice).toEqual({ version: 3, digest: 'd' })
  })

  it('is loading while one per-property read has no data and nothing failed', async () => {
    await seed({ skip: JSON.stringify(reviewKeys.replyLibrary('p2')) })

    expect(render(asFns({})).status).toBe('loading')
  })

  it('reports an error when a read failed before everything loaded', async () => {
    await seed({ fail: JSON.stringify(propertyKeys.setup('p2')) })

    expect(render(asFns({})).status).toBe('error')
  })

  it('leaves out a property removed since the import finished', async () => {
    await seed()
    client.setQueryData(propertyKeys.list(), {
      properties: [{ id: 'p1', name: 'First' }],
    })

    const state = render(asFns({}))

    if (state.status !== 'ready') throw new Error('expected ready')
    expect(state.facts.map((fact) => fact.propertyId)).toEqual(['p1'])
    expect(state.facts[0]?.propertyCount).toBe(1)
  })
})
