// How a loader holds the page for its side reads, and what it leaves in the
// request's QueryClient when a read misses its grace (`prime-within-grace.ts`).
import { dehydrate, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { primeWithinGrace } from './prime-within-grace'

const GRACE_MS = 300
const FIGURES = ['figures'] as const
const HEADLINE = ['headline'] as const

/** An answer the test gives when it chooses to. */
function held<T>() {
  let release: (answer: T) => void = () => undefined
  const answer = new Promise<T>((resolve) => {
    release = resolve
  })
  return { answer, release }
}

/** A loader's two side reads: one that answers at once and one that is held. */
function startReads(queryClient: QueryClient, readHeadline: () => Promise<string>) {
  return Promise.all([
    queryClient.prefetchQuery({
      queryKey: FIGURES,
      queryFn: () => Promise.resolve('3.9'),
    }),
    queryClient.prefetchQuery({ queryKey: HEADLINE, queryFn: readHeadline }),
  ])
}

describe('primeWithinGrace', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('on the server', () => {
    it('drops a read still pending when the grace ends and keeps one that has answered', async () => {
      const queryClient = new QueryClient()
      const headline = held<string>()

      const waiting = primeWithinGrace(
        queryClient,
        startReads(queryClient, () => headline.answer),
        [FIGURES, HEADLINE],
        GRACE_MS,
      )
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      await waiting

      expect(queryClient.getQueryState(HEADLINE)).toBeUndefined()
      expect(queryClient.getQueryData(FIGURES)).toBe('3.9')
    })

    it('does not bring the dropped read back when its answer arrives', async () => {
      const queryClient = new QueryClient()
      const headline = held<string>()
      const waiting = primeWithinGrace(
        queryClient,
        startReads(queryClient, () => headline.answer),
        [FIGURES, HEADLINE],
        GRACE_MS,
      )
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      await waiting

      headline.release('Guests praise the breakfast')
      await vi.advanceTimersByTimeAsync(0)

      expect(queryClient.getQueryState(HEADLINE)).toBeUndefined()
      expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
    })

    it('leaves the SSR integration only what has answered to send to the browser', async () => {
      const queryClient = new QueryClient()
      const headline = held<string>()
      const waiting = primeWithinGrace(
        queryClient,
        startReads(queryClient, () => headline.answer),
        [FIGURES, HEADLINE],
        GRACE_MS,
      )
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      await waiting

      // The integration dehydrates every query the client holds (its default is
      // `() => true`), a pending one with its promise.
      const sent = dehydrate(queryClient, { shouldDehydrateQuery: () => true })

      expect(sent.queries.map((query) => query.queryKey)).toEqual([FIGURES])
    })

    it('leaves a read it was not told about alone: the page needs it', async () => {
      const queryClient = new QueryClient()
      const property = held<string>()
      void queryClient.prefetchQuery({
        queryKey: ['property'],
        queryFn: () => property.answer,
      })
      const headline = held<string>()

      const waiting = primeWithinGrace(
        queryClient,
        startReads(queryClient, () => headline.answer),
        [HEADLINE],
        GRACE_MS,
      )
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      await waiting

      expect(queryClient.getQueryState(['property'])?.status).toBe('pending')
      expect(queryClient.getQueryState(HEADLINE)).toBeUndefined()
    })

    it("names a family of reads by its prefix, and only this property's", async () => {
      const queryClient = new QueryClient()
      const first = held<string>()
      const second = held<string>()
      const reads = Promise.all([
        queryClient.prefetchQuery({
          queryKey: ['goals', 'rating-goal', 'p1', 'card'],
          queryFn: () => first.answer,
        }),
        queryClient.prefetchQuery({
          queryKey: ['goals', 'rating-goal', 'p2', 'card'],
          queryFn: () => second.answer,
        }),
      ])

      const waiting = primeWithinGrace(
        queryClient,
        reads,
        [['goals', 'rating-goal', 'p1']],
        GRACE_MS,
      )
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      await waiting

      expect(
        queryClient.getQueryState(['goals', 'rating-goal', 'p1', 'card']),
      ).toBeUndefined()
      expect(
        queryClient.getQueryState(['goals', 'rating-goal', 'p2', 'card'])?.status,
      ).toBe('pending')
    })

    it('keeps a read that has an answer and is only being refreshed', async () => {
      const queryClient = new QueryClient()
      queryClient.setQueryData(HEADLINE, 'Guests praise the breakfast')
      const refreshed = held<string>()
      const reads = queryClient.prefetchQuery({
        queryKey: HEADLINE,
        queryFn: () => refreshed.answer,
        staleTime: 0,
      })

      const waiting = primeWithinGrace(queryClient, reads, [HEADLINE], GRACE_MS)
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      await waiting

      expect(queryClient.getQueryData(HEADLINE)).toBe('Guests praise the breakfast')
    })
  })

  describe('in the browser', () => {
    beforeEach(() => {
      vi.stubGlobal('document', {})
    })

    it('drops nothing: the read goes on in the background and lands in the cache', async () => {
      const queryClient = new QueryClient()
      const headline = held<string>()
      const waiting = primeWithinGrace(
        queryClient,
        startReads(queryClient, () => headline.answer),
        [FIGURES, HEADLINE],
        GRACE_MS,
      )
      await vi.advanceTimersByTimeAsync(GRACE_MS)
      await waiting

      expect(queryClient.getQueryState(HEADLINE)?.status).toBe('pending')

      headline.release('Guests praise the breakfast')
      await vi.advanceTimersByTimeAsync(0)

      expect(queryClient.getQueryData(HEADLINE)).toBe('Guests praise the breakfast')
    })
  })

  describe.each([
    ['on the server', undefined],
    ['in the browser', {}],
  ])('%s', (_side, browserDocument) => {
    beforeEach(() => {
      if (browserDocument) vi.stubGlobal('document', browserDocument)
    })

    it('never waits longer than its grace for reads that do not answer', async () => {
      let waited = true
      const waiting = primeWithinGrace(
        new QueryClient(),
        new Promise<void>(() => undefined),
        [HEADLINE],
        GRACE_MS,
      ).then(() => {
        waited = false
      })

      await vi.advanceTimersByTimeAsync(GRACE_MS - 1)
      expect(waited).toBe(true)
      await vi.advanceTimersByTimeAsync(1)
      expect(waited).toBe(false)
      await waiting
    })

    it('returns as soon as the reads have answered, with no timer left running', async () => {
      const queryClient = new QueryClient()

      await primeWithinGrace(
        queryClient,
        queryClient.prefetchQuery({
          queryKey: FIGURES,
          queryFn: () => Promise.resolve('3.9'),
        }),
        [FIGURES],
        GRACE_MS,
      )

      expect(vi.getTimerCount()).toBe(0)
      expect(queryClient.getQueryData(FIGURES)).toBe('3.9')
    })
  })
})
