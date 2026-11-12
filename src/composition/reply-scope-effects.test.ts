import { afterEach, describe, expect, it, vi } from 'vitest'

const NO_EFFECTS_MESSAGE = 'Reply scope effects are not provided'

// Each test loads the writer from the module registry it wires from, so the
// handed-over object is compared with the one that registry holds.
const loadWriter = async () =>
  (await import('./reply-scope-effects')).reputationReplyScopeEffects

describe('Reply scope effects at each entry point', () => {
  afterEach(() => {
    vi.doUnmock('#/contexts/review/build')
    vi.doUnmock('#/contexts/property/build')
    vi.doUnmock('#/contexts/ai/build')
    vi.doUnmock('#/contexts/identity/build')
    vi.resetModules()
  })

  it('hands the Reputation writer to Review when the container wires it', async () => {
    const buildReviewContext = vi.fn(() => ({}))
    vi.doMock('#/contexts/review/build', () => ({ buildReviewContext }))
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

describe('Shared purge and restore fencing without effects', () => {
  const tx = { execute: vi.fn() }

  afterEach(() => {
    tx.execute.mockReset()
  })

  it.each([
    ['property', 'purgeAiDraftsForProperty', { organizationId: 'o', propertyId: 'p' }],
    [
      'authorization',
      'purgeAiDraftsForAuthorization',
      { organizationId: 'o', propertyId: 'p' },
    ],
    ['profile', 'purgeAiDraftsForProfile', { organizationId: 'o', propertyId: 'p' }],
    ['review', 'purgeAiDraftsForReview', { organizationId: 'o', reviewId: 'r' }],
    ['expiry', 'purgeExpiredAiDraftsForReview', { organizationId: 'o', reviewId: 'r' }],
  ] as const)('refuses the %s purge and writes nothing', async (_name, fn, scope) => {
    const purge = await import('#/shared/db/ai/ai-draft-purge')
    await expect(
      (purge[fn] as (...args: unknown[]) => Promise<void>)(tx, scope, undefined),
    ).rejects.toThrow(NO_EFFECTS_MESSAGE)
    expect(tx.execute).not.toHaveBeenCalled()
  })

  it('refuses the organization and control purges and writes nothing', async () => {
    const purge = await import('#/shared/db/ai/ai-draft-purge')
    await expect(
      purge.purgeAiDraftsForOrganization(tx as never, 'o', undefined),
    ).rejects.toThrow(NO_EFFECTS_MESSAGE)
    await expect(
      purge.purgeAiDraftsForControl(tx as never, 'global', null, undefined),
    ).rejects.toThrow(NO_EFFECTS_MESSAGE)
    expect(tx.execute).not.toHaveBeenCalled()
  })

  it('refuses the restore fence before it opens a transaction', async () => {
    const { applyRecoveryFence } =
      await import('#/shared/db/recovery/postgres-recovery-fence')
    const db = { transaction: vi.fn() }
    await expect(
      applyRecoveryFence(
        db as never,
        {
          runId: '00000000-0000-4000-8000-000000000001',
          generation: 1,
        } as never,
        async () => ({ items: 0, parents: 0 }),
        undefined,
      ),
    ).rejects.toThrow(NO_EFFECTS_MESSAGE)
    expect(db.transaction).not.toHaveBeenCalled()
  })
})

describe('Reply scope effects at each operator script', () => {
  // A script that builds its own stores outside the container has to hand the
  // Reputation writer to every store or recovery call that can end Replies.
  it.each([
    [
      'scripts/ops/ai-execution-control.ts',
      /createAiControlAdapter\(\s*db,\s*reputationReplyScopeEffects/,
    ],
    [
      'scripts/ops/restore-verify.ts',
      /applyRecoveryFence\([^)]*reputationReplyScopeEffects/s,
    ],
    ['scripts/ops/enqueue-purge.ts', /replyEffects:\s*reputationReplyScopeEffects/],
  ])('%s passes the writer where it builds the call', async (path, handsOver) => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(path, 'utf8')).toMatch(handsOver)
  })
})
