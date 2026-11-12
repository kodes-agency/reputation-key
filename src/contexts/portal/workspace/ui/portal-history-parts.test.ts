// The History tab's parts read for themselves: the ledger, the Versions rail and
// a confirmation each say so while their own read loads or if it cannot be read,
// and none holds up another. Rendered on the server from a seeded cache, which
// is how a part sees a read that has answered, has not, or was refused.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { portalKeys } from '#/shared/queries/query-keys'
import {
  STORY_ENTRIES,
  STORY_NOW,
  STORY_PORTAL_NAME,
  STORY_TIME_ZONE,
  STORY_VERSIONS,
  STORY_VERSION_DETAILS,
  storyPublicationHistory,
} from './__fixtures__/portal-history-stories-data'
import {
  PortalHistoryProvider,
  type HistorySelection,
  type MakeVersionLiveAction,
  type PortalHistoryReads,
} from './portal-history-context'
import { PortalHistoryView } from './portal-history-view'

const PORTAL_ID = 'portal-1'

type Answer = 'ready' | 'loading' | 'failed'
type Answers = Readonly<{
  entries?: Answer
  versions?: Answer
  publication?: Answer
  detail?: Answer
}>

const makeLive = Object.assign(vi.fn(), {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
}) as unknown as MakeVersionLiveAction

const reads = {} as PortalHistoryReads

const refused = () => Promise.reject(new Error('not read'))

async function clientWith(answers: Answers): Promise<QueryClient> {
  const { entries = 'ready', versions = 'ready', publication = 'ready' } = answers
  const { detail = 'ready' } = answers
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (entries === 'ready') {
    client.setQueryData(portalKeys.historyFor(PORTAL_ID, 'all'), {
      pages: [{ entries: STORY_ENTRIES, nextCursor: null }],
      pageParams: [undefined],
    })
  }
  if (entries === 'failed') {
    await client
      .fetchInfiniteQuery({
        queryKey: portalKeys.historyFor(PORTAL_ID, 'all'),
        queryFn: refused,
        initialPageParam: undefined,
      })
      .catch(() => undefined)
  }
  const seeded = [
    [versions, portalKeys.versions(PORTAL_ID), STORY_VERSIONS],
    [publication, portalKeys.publicationHistory(PORTAL_ID), storyPublicationHistory(2)],
    [detail, portalKeys.version(PORTAL_ID, 4), STORY_VERSION_DETAILS[4]],
  ] as const
  for (const [answer, queryKey, data] of seeded) {
    if (answer === 'ready') client.setQueryData(queryKey, data)
    if (answer === 'failed') {
      await client.fetchQuery({ queryKey, queryFn: refused }).catch(() => undefined)
    }
  }
  return client
}

type Options = Readonly<{ pageIsLive?: boolean; selection?: HistorySelection }>

async function render(answers: Answers = {}, options: Options = {}): Promise<string> {
  const client = await clientWith(answers)
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(PortalHistoryProvider, {
        portalId: PORTAL_ID,
        portalName: STORY_PORTAL_NAME,
        timeZone: STORY_TIME_ZONE,
        mayMakeLive: true,
        pageIsLive: options.pageIsLive ?? true,
        reads,
        makeLive,
        now: STORY_NOW,
        ...(options.selection ? { initial: { selection: options.selection } } : {}),
        children: createElement(PortalHistoryView),
      }),
    ),
  )
}

const LEDGER_LIST = 'aria-label="History, newest first"'
const HISTORY_FAILED = 'The history couldn’t be loaded.'
const VERSIONS_FAILED = 'Versions couldn’t be loaded.'
const PUBLICATION_FAILED = 'The publication history couldn’t be loaded.'

describe('the History tab’s parts', () => {
  it('say nothing is wrong while every read is still loading', async () => {
    const markup = await render({
      entries: 'loading',
      versions: 'loading',
      publication: 'loading',
    })

    expect(markup).not.toContain(LEDGER_LIST)
    expect(markup).not.toContain('couldn’t be loaded')
    expect(markup).toContain('Versions')
  })

  it('show the ledger and the rail once their reads answer', async () => {
    const markup = await render()

    expect(markup).toContain(LEDGER_LIST)
    expect(markup).toContain('Version 5')
    expect(markup).toContain('Draft')
  })

  it('keep a failed history in the ledger and the rail usable', async () => {
    const markup = await render({ entries: 'failed' })

    expect(markup).toContain(HISTORY_FAILED)
    expect(markup).not.toContain(LEDGER_LIST)
    expect(markup).not.toContain(VERSIONS_FAILED)
    expect(markup).toContain('Version 5')
  })

  it('keep failed versions in the rail and the ledger usable', async () => {
    const markup = await render({ versions: 'failed' })

    expect(markup).toContain(VERSIONS_FAILED)
    expect(markup).not.toContain(HISTORY_FAILED)
    expect(markup).toContain(LEDGER_LIST)
  })

  it('keep a failed publication history in the rail and the ledger usable', async () => {
    const markup = await render({ publication: 'failed' })

    expect(markup).toContain(PUBLICATION_FAILED)
    expect(markup).not.toContain(VERSIONS_FAILED)
    expect(markup).toContain(LEDGER_LIST)
  })

  it('wait in the rail for the draft’s changes without holding up the ledger', async () => {
    const markup = await render({ publication: 'loading' })

    expect(markup).toContain(LEDGER_LIST)
    expect(markup).not.toContain('Version 5, live now')
    expect(markup).not.toContain('couldn’t be loaded')
  })

  it('tell the ledger why no version can be made live while the page is off', async () => {
    const off = await render({}, { pageIsLive: false })
    const on = await render()

    expect(off).toContain('No version is live while the page is off.')
    expect(on).not.toContain('No version is live while the page is off.')
  })
})

describe('the confirmation under a publish line', () => {
  const restore: HistorySelection = { version: 4, mode: 'restore', host: 'row' }

  it('checks what would change while the version is read', async () => {
    const markup = await render({ detail: 'loading' }, { selection: restore })

    expect(markup).toContain('Checking what would change…')
  })

  it('checks what would change while the draft’s changes are read', async () => {
    const markup = await render({ publication: 'loading' }, { selection: restore })

    expect(markup).toContain('Checking what would change…')
  })

  it('says it could not be checked when the version cannot be read', async () => {
    const markup = await render({ detail: 'failed' }, { selection: restore })

    expect(markup).toContain('What would change couldn’t be checked.')
  })

  it('says it could not be checked when the draft’s changes cannot be read', async () => {
    const markup = await render({ publication: 'failed' }, { selection: restore })

    expect(markup).toContain('What would change couldn’t be checked.')
  })

  it('asks once both are read, and says how many changes the draft keeps', async () => {
    const markup = await render({}, { selection: restore })

    expect(markup).toContain('Make version 4 live again?')
    expect(markup).toContain('Your draft keeps its 2 changes')
  })
})
