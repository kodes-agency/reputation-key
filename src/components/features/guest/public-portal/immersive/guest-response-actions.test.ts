import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import {
  buildGuestResponseHandlers,
  type GuestResponseActions,
} from './guest-response-actions'
import type {
  ImmersiveResponseFailure,
  ImmersiveResponseNotice,
} from './immersive-response-types'
import { setBrowserExceptionCapture } from '#/shared/observability/browser-exception-capture'
import { NONCE, RATED, TOKEN } from './__fixtures__/immersive-public-portal-fixtures'

const SESSION = { token: TOKEN, csrfNonce: NONCE }
const NEXT_NONCE = '22222222-2222-4222-8222-222222222222'
const GOOGLE = 'https://search.google.com/local/writereview?placeid=abc'

/** Every action succeeds with a recognisable response unless a test replaces it. */
function harness(
  overrides: Partial<GuestResponseActions> = {},
  options: Readonly<{ googleReviewAvailable?: boolean }> = {},
) {
  const next: GuestResponseView = { ...RATED, rating: 5 }
  const actions: GuestResponseActions = {
    submitResponse: vi.fn(async () => next),
    correctResponse: vi.fn(async () => ({ ...next, correctedAt: 'later' })),
    startNewResponse: vi.fn(async () => ({ csrfNonce: NEXT_NONCE })),
    submitPrivateFeedback: vi.fn(async () => ({ ...next, hasPrivateFeedback: true })),
    selectGoogleReview: vi.fn(async () => ({ url: GOOGLE })),
    withdrawResponse: vi.fn(async () => ({
      ...next,
      status: 'deleted' as const,
      rating: null,
    })),
    withdrawPrivateFeedback: vi.fn(async () => next),
    ...overrides,
  }
  const seen = {
    responses: [] as Array<GuestResponseView | null>,
    nonces: [] as string[],
    failures: [] as Array<ImmersiveResponseFailure | null>,
    notices: [] as Array<ImmersiveResponseNotice | null>,
    navigations: [] as string[],
  }
  const handlers = buildGuestResponseHandlers({
    actions,
    token: TOKEN,
    csrfNonce: NONCE,
    googleReviewAvailable: options.googleReviewAvailable ?? true,
    setResponse: (response) => seen.responses.push(response),
    setCsrfNonce: (nonce) => seen.nonces.push(nonce),
    setFailure: (failure) => seen.failures.push(failure),
    setNotice: (notice) => seen.notices.push(notice),
    navigate: (url) => seen.navigations.push(url),
  })
  return { actions, handlers, seen }
}

describe('a call that fails', () => {
  afterEach(() => setBrowserExceptionCapture(undefined))

  it('is reported, not swallowed, while the guest still sees the card failure', async () => {
    const captured: unknown[] = []
    setBrowserExceptionCapture((error) => captured.push(error))
    const failure = new Error('the server said no')
    const { handlers, seen } = harness({
      submitResponse: vi.fn(async () => Promise.reject(failure)),
    })

    await handlers.onSubmitRating({ rating: 5, honeypot: '' })

    expect(captured).toEqual([failure])
    expect(lastOf(seen.failures)).toBe('rating')
  })

  it('leaves a refusal the server meant (a 4xx) out of the report', async () => {
    const captured: unknown[] = []
    setBrowserExceptionCapture((error) => captured.push(error))
    const refusal = Object.assign(new Error('too many tries'), { status: 429 })
    const { handlers, seen } = harness({
      submitResponse: vi.fn(async () => Promise.reject(refusal)),
    })

    await handlers.onSubmitRating({ rating: 5, honeypot: '' })

    expect(captured).toEqual([])
    expect(lastOf(seen.failures)).toBe('rating')
  })
})

const rejecting = () => vi.fn(async () => Promise.reject(new Error('the server said no')))
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const lastOf = <T>(items: readonly T[]) => items[items.length - 1]

describe('rating', () => {
  it('sends the star with the session, consent and the honeypot, and shows what came back', async () => {
    const { actions, handlers, seen } = harness()

    await handlers.onSubmitRating({ rating: 5, honeypot: '' })

    expect(actions.submitResponse).toHaveBeenCalledWith({
      data: { ...SESSION, rating: 5, responseConsent: true, honeypot: '' },
    })
    expect(lastOf(seen.responses)).toMatchObject({ rating: 5 })
    expect(lastOf(seen.failures)).toBeNull()
  })

  it('names the rating card when the save does not go through, and keeps the page as it was', async () => {
    const { handlers, seen } = harness({ submitResponse: rejecting() })

    await handlers.onSubmitRating({ rating: 5, honeypot: '' })

    expect(lastOf(seen.failures)).toBe('rating')
    expect(seen.responses).toEqual([])
  })

  it('changes a rating through the correction call and says it was updated', async () => {
    const { actions, handlers, seen } = harness()

    await handlers.onChangeRating({ rating: 4, honeypot: '' })

    expect(actions.correctResponse).toHaveBeenCalledOnce()
    expect(actions.submitResponse).not.toHaveBeenCalled()
    expect(lastOf(seen.notices)).toBe('rating-updated')
  })

  it('does not say a failed correction was updated', async () => {
    const { handlers, seen } = harness({ correctResponse: rejecting() })

    await handlers.onChangeRating({ rating: 4, honeypot: '' })

    expect(lastOf(seen.failures)).toBe('rating')
    expect(seen.notices).not.toContain('rating-updated')
  })
})

describe('the private note', () => {
  it('sends the words with consent and reports that it was accepted', async () => {
    const { actions, handlers } = harness()

    const accepted = await handlers.onSubmitNote({ text: 'The heater', honeypot: '' })

    expect(accepted).toBe(true)
    expect(actions.submitPrivateFeedback).toHaveBeenCalledWith({
      data: { ...SESSION, text: 'The heater', textConsent: true, honeypot: '' },
    })
  })

  it('reports a note that was not accepted, so the card keeps what the guest wrote', async () => {
    const { handlers, seen } = harness({ submitPrivateFeedback: rejecting() })

    await expect(handlers.onSubmitNote({ text: 'x', honeypot: '' })).resolves.toBe(false)

    expect(lastOf(seen.failures)).toBe('note')
  })
})

describe('Google', () => {
  it('goes to the address the server returned', async () => {
    const { handlers, seen } = harness()

    handlers.onGoogleReview()
    await settle()

    expect(seen.navigations).toEqual([GOOGLE])
  })

  it('does nothing when Google cannot be offered', async () => {
    const { actions, handlers, seen } = harness({}, { googleReviewAvailable: false })

    handlers.onGoogleReview()
    await settle()

    expect(actions.selectGoogleReview).not.toHaveBeenCalled()
    expect(seen.navigations).toEqual([])
  })

  it.each(['http://search.google.com/x', 'javascript:alert(1)', '/relative', ''])(
    'never navigates to %s: no arbitrary redirects',
    async (url) => {
      const { handlers, seen } = harness({
        selectGoogleReview: vi.fn(async () => ({ url })),
      })

      handlers.onGoogleReview()
      await settle()

      expect(seen.navigations).toEqual([])
      expect(lastOf(seen.failures)).toBe('google')
    },
  )

  it('names the Google card when the call fails', async () => {
    const { handlers, seen } = harness({ selectGoogleReview: rejecting() })

    handlers.onGoogleReview()
    await settle()

    expect(lastOf(seen.failures)).toBe('google')
    expect(seen.navigations).toEqual([])
  })
})

describe('"Your response"', () => {
  it('removes the note and says so', async () => {
    const { actions, handlers, seen } = harness()

    handlers.onRemoveNote()
    await settle()

    expect(actions.withdrawPrivateFeedback).toHaveBeenCalledWith({ data: SESSION })
    expect(lastOf(seen.notices)).toBe('note-removed')
  })

  it('removes the whole response and shows the removed state the server returned', async () => {
    const { actions, handlers, seen } = harness()

    handlers.onRemoveResponse()
    await settle()

    expect(actions.withdrawResponse).toHaveBeenCalledWith({ data: SESSION })
    expect(lastOf(seen.responses)).toMatchObject({ status: 'deleted', rating: null })
  })

  it.each([
    ['onRemoveNote', 'withdrawPrivateFeedback', 'remove-note'],
    ['onRemoveResponse', 'withdrawResponse', 'remove-all'],
    ['onStartOver', 'startNewResponse', 'start-over'],
  ] as const)('%s names its own card when it fails', async (handler, action, failure) => {
    const { handlers, seen } = harness({ [action]: rejecting() })

    handlers[handler]()
    await settle()

    expect(lastOf(seen.failures)).toBe(failure)
    expect(seen.responses).toEqual([])
  })

  it('starts over on the rotated session, with no response and a ready notice', async () => {
    const { actions, handlers, seen } = harness()

    handlers.onStartOver()
    await settle()

    expect(actions.startNewResponse).toHaveBeenCalledWith({ data: SESSION })
    expect(seen.nonces).toEqual([NEXT_NONCE])
    expect(seen.responses).toEqual([null])
    expect(lastOf(seen.notices)).toBe('started-over')
  })
})

describe('one message at a time', () => {
  it('clears the last failure and notice before every call', async () => {
    const { handlers, seen } = harness()

    await handlers.onSubmitRating({ rating: 3, honeypot: '' })

    expect(seen.failures[0]).toBeNull()
    expect(seen.notices[0]).toBeNull()
  })
})
