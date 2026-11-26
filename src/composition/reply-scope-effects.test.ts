import { afterEach, describe, expect, it, vi } from 'vitest'

// Each test loads the writer from the module registry it wires from, so the
// handed-over object is compared with the one that registry holds.
const loadWriter = async () =>
  (await import('./reply-scope-effects')).reputationReplyScopeEffects

describe('Reply scope effects at each entry point', () => {
  afterEach(() => {
    vi.doUnmock('#/contexts/reputation/build-review')
    vi.doUnmock('#/contexts/property/build')
    vi.doUnmock('#/contexts/ai/build')
    vi.doUnmock('#/contexts/identity/build')
    vi.resetModules()
  })

  it('hands the Reputation writer to Review when the container wires it', async () => {
    const buildReviewContext = vi.fn(() => ({}))
    vi.doMock('#/contexts/reputation/build-review', () => ({ buildReviewContext }))
    const { wireReview } = await import('./review-wiring')
    wireReview(
      { db: {}, outboxRepo: {}, clock: () => new Date(), pool: {}, infra: {} } as never,
      { publicApi: { people: {} }, authority: {} } as never,
      { publicApi: {} } as never,
      { publicApi: { portal: {} } } as never,
      { reviewSync: {} } as never,
      { provenancePublicKeys: {} } as never,
    )
    expect(buildReviewContext).toHaveBeenCalledWith(
      expect.objectContaining({ replyEffects: await loadWriter() }),
    )
  })

  it('hands the Reputation writer to Property when the container wires it', async () => {
    const buildPropertyContext = vi.fn(() => ({}))
    vi.doMock('#/contexts/property/build', () => ({ buildPropertyContext }))
    const { wireProperty } = await import('./property-wiring')
    wireProperty(
      { db: {}, outboxRepo: {}, clock: () => new Date() } as never,
      {
        publicApi: { people: {}, managerFacts: {} },
      } as never,
    )
    expect(buildPropertyContext).toHaveBeenCalledWith(
      expect.objectContaining({ replyEffects: await loadWriter() }),
    )
  })

  it('hands the Reputation writer to AI when the container wires it', async () => {
    const buildAiContext = vi.fn(() => ({}))
    vi.doMock('#/contexts/ai/build', () => ({ buildAiContext }))
    const { wireAi } = await import('./ai-wiring')
    try {
      wireAi(
        {
          db: {},
          outboxRepo: {},
          redis: {},
          clock: () => new Date(),
          infra: {},
        } as never,
        { publicApi: {}, authority: {} } as never,
        { publicApi: {} } as never,
        { publicApi: {} } as never,
        { publicApi: {} } as never,
        {} as never,
      )
    } catch {
      // Wiring after the context build needs more than this test supplies.
    }
    expect(buildAiContext).toHaveBeenCalledWith(
      expect.objectContaining({ replyEffects: await loadWriter() }),
    )
  })

  it('hands the Reputation writer to Identity when the container wires it', async () => {
    const buildIdentityContext = vi.fn(() => ({}))
    vi.doMock('#/contexts/identity/build', () => ({ buildIdentityContext }))
    const { wireIdentity } = await import('./identity-wiring')
    try {
      wireIdentity(
        {
          options: undefined,
          db: {},
          clock: () => new Date(),
          logger: {},
          env: { BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: 'http://x' },
          infra: { rateLimiter: {} },
        } as never,
        { authSession: {}, identityPort: {} } as never,
        { port: {} } as never,
        (() => ({})) as never,
        (() => ({})) as never,
      )
    } catch {
      // Wiring after the context build needs more than this test supplies.
    }
    expect(buildIdentityContext).toHaveBeenCalledWith(
      expect.objectContaining({ replyEffects: await loadWriter() }),
    )
  })

  it('hands the Reputation writer to the deploy step that issues the AI posture', async () => {
    const createAiControlAdapter = vi.fn(() => ({}))
    vi.doMock('#/contexts/ai/infrastructure/adapters/ai-control.adapter', () => ({
      createAiControlAdapter,
    }))
    const { createDeclaredCapabilityPostureStores } =
      await import('./declared-capability-posture')
    createDeclaredCapabilityPostureStores({} as never)
    expect(createAiControlAdapter).toHaveBeenCalledWith({}, await loadWriter())
    vi.doUnmock('#/contexts/ai/infrastructure/adapters/ai-control.adapter')
  })
})
