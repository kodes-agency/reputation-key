import { describe, expect, it } from 'vitest'
import {
  CLAIM_FENCE,
  CONNECTION_ID,
  GOOGLE_PRIMARY_CATEGORY,
  GOOGLE_REVIEW_URI,
  ITEM_ID,
  NOW,
  ORG_ID,
  PROPERTY_ID,
  PROVIDER_LOCATION_ID,
  USER_ID,
  actor,
  authorization,
  claimed,
  importedReceipt,
  run,
  setup,
} from './google-import-processor.test-fixtures'

describe('GoogleImportProcessor', () => {
  it('executes a freshly authorized create only while its exact claim fence is locked', async () => {
    const committedReceipt = importedReceipt()
    const harness = setup({ receipts: [null, null, committedReceipt] })

    await run(harness)

    expect(harness.runClaimedEffect).toHaveBeenCalledWith(
      {
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        dispatchEpoch: 0,
        attemptOrdinal: 1,
        claimFence: CLAIM_FENCE,
        now: NOW,
      },
      expect.any(Function),
    )
    expect(harness.resolveActor).toHaveBeenCalledWith(ORG_ID, USER_ID)
    expect(harness.authorize).toHaveBeenCalledWith({
      actor,
      connectionId: CONNECTION_ID,
      phase: 'publish',
      expected: authorization,
      properties: [],
      requireAccessToken: false,
    })
    expect(harness.createBoundProperty).toHaveBeenCalledOnce()
    expect(harness.createBoundProperty).toHaveBeenCalledWith(
      expect.objectContaining({
        property: expect.objectContaining({
          googleReviewDestination: {
            state: 'verified',
            uri: GOOGLE_REVIEW_URI,
            retrievedAt: NOW,
            sourceEpoch: 0,
            profileVersion: 1,
          },
          // Read at discovery, stored with the Property it creates.
          googlePrimaryCategory: GOOGLE_PRIMARY_CATEGORY,
          googlePrimaryCategoryUpdatedAt: NOW,
        }),
      }),
    )
    expect(harness.reconcileFromReceipt).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      now: NOW,
    })
    expect(harness.completeClaim).not.toHaveBeenCalled()
    expect(harness.runClaimedEffect.mock.invocationCallOrder[0]).toBeLessThan(
      harness.createBoundProperty.mock.invocationCallOrder[0]!,
    )
  })

  it('reconciles an existing Property receipt before claiming or authorizing', async () => {
    const harness = setup({
      receipt: importedReceipt(),
    })

    await run(harness)

    expect(harness.reconcileFromReceipt).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      now: NOW,
    })
    expect(harness.claimItem).not.toHaveBeenCalled()
    expect(harness.resolveActor).not.toHaveBeenCalled()
    expect(harness.authorize).not.toHaveBeenCalled()
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
  })

  it('does nothing when the durable claim rejects stale work', async () => {
    const harness = setup({
      claim: { kind: 'ignored', reason: 'stale_attempt' },
    })

    await run(harness)

    expect(harness.resolveActor).not.toHaveBeenCalled()
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
    expect(harness.completeClaim).not.toHaveBeenCalled()
  })

  // The stalled-recovery bug: returning normally here marked the BullMQ
  // attempt completed. When the arrival WAS the single permitted stalled
  // recovery, nothing re-dispatched the item and the row stayed 'processing'
  // until its effect deadline. Throwing keeps the attempt budget alive so a
  // later attempt claims the item once the lease has expired.
  it('throws on an active claim lease so BullMQ retries instead of completing', async () => {
    const harness = setup({
      claim: { kind: 'ignored', reason: 'claim_active' },
    })

    await expect(run(harness)).rejects.toThrow(/claim lease is still active/)

    // No effect, and above all no terminal write: the other attempt owns it.
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
    expect(harness.completeClaim).not.toHaveBeenCalled()
    expect(harness.terminalizeItem).not.toHaveBeenCalled()
    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
  })

  it.each([
    ['pg-pool acquisition timeout', new Error('timeout exceeded when trying to connect')],
    [
      'too many connections',
      Object.assign(new Error('sorry, too many clients already'), { code: '53300' }),
    ],
    [
      'lock_timeout expiry',
      Object.assign(new Error('canceling statement due to lock timeout'), {
        code: '55P03',
      }),
    ],
    [
      'idle-in-transaction termination',
      Object.assign(new Error('terminating connection due to idle-in-transaction'), {
        code: '25P03',
      }),
    ],
  ])(
    'classifies %s as transient rather than internal_error',
    async (_label, createError) => {
      const harness = setup({ createError })

      // Transient handling = release the claim and rethrow for a fresh attempt.
      await expect(run(harness)).rejects.toBe(createError)

      expect(harness.releaseClaimForRetry).toHaveBeenCalledTimes(1)
      // Never a terminal outcome, and specifically never internal_error.
      expect(harness.completeClaim).not.toHaveBeenCalled()
    },
  )

  // The two authorization denials are DIFFERENT facts and must not share an
  // outcome code. `authorization_denied` is the capability gate refusing —
  // "this feature is unavailable" — while `authorization_changed` is the
  // narrow claim that something the item froze at enqueue no longer matches.
  // They were collapsed into `authorization_changed`, so a cancelled item's
  // persisted `outcome_code` could not say which had happened, and an
  // investigation spent its time in the wrong half of the authorizer.
  it.each([
    ['the capability gate denies', 'authorization_denied', 'policy_disabled'],
    ['frozen authorization drifted', 'authorization_changed', 'authorization_changed'],
  ] as const)(
    'cancels with a distinct outcome when %s',
    async (_label, code, outcomeCode) => {
      const harness = setup({ authorization: { ok: false, code } })

      await run(harness)

      expect(harness.createBoundProperty).not.toHaveBeenCalled()
      expect(harness.completeClaim).toHaveBeenCalledWith(
        expect.objectContaining({ outcomeCode, retainRetryState: false }),
      )
    },
  )

  // `temporarily_unavailable` is the one outcome that keeps the item's retry
  // state: the items table refuses it scrubbed, and a retry is what it promises.
  it.each([
    ['missing membership', { actor: null }, 'authorization_changed', false],
    [
      'authorization infrastructure outage',
      { resolveActorError: new Error('authorization unavailable') },
      'temporarily_unavailable',
      true,
    ],
  ] as const)(
    'fails closed on %s before Property mutation',
    async (_label, override, outcomeCode, retainRetryState) => {
      const harness = setup(override)

      await run(harness)

      expect(harness.authorize).not.toHaveBeenCalled()
      expect(harness.createBoundProperty).not.toHaveBeenCalled()
      expect(harness.completeClaim).toHaveBeenCalledWith(
        expect.objectContaining({ outcomeCode, retainRetryState }),
      )
    },
  )

  it('reconciles a receipt that appears after claim but before the fenced effect', async () => {
    const receipt = importedReceipt()
    const harness = setup({ receipts: [null, receipt] })

    await run(harness)

    expect(harness.runClaimedEffect).toHaveBeenCalledOnce()
    expect(harness.reconcileFromReceipt).toHaveBeenCalledOnce()
    expect(harness.resolveActor).not.toHaveBeenCalled()
    expect(harness.authorize).not.toHaveBeenCalled()
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
  })

  it('terminalizes an expired receipt-free item without claiming it', async () => {
    const harness = setup({
      claim: {
        kind: 'ignored',
        reason: 'effect_expired',
        effectDeadlineAt: NOW,
        authority: { kind: 'pending', dispatchEpoch: 0 },
      },
    })

    await run(harness)

    expect(harness.terminalizeItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      authority: { kind: 'pending', dispatchEpoch: 0 },
      outcomeCode: 'temporarily_unavailable',
      retainRetryState: true,
      now: NOW,
    })
    expect(harness.resolveActor).not.toHaveBeenCalled()
    expect(harness.createBoundProperty).not.toHaveBeenCalled()
  })

  it('checks a newly visible Property receipt before ending an exhausted pending revision', async () => {
    const h = setup({
      claim: {
        kind: 'ignored',
        reason: 'attempts_exhausted',
        effectDeadlineAt: new Date(NOW.getTime() + 60_000),
        authority: { kind: 'pending', dispatchEpoch: 7 },
      },
      receipts: [null, importedReceipt()],
    })
    await run(h, { dispatchEpoch: 7 })
    expect(h.reconcileFromReceipt).toHaveBeenCalledOnce()
    expect(h.terminalizeItem).not.toHaveBeenCalled()
    expect(h.createBoundProperty).not.toHaveBeenCalled()
  })

  it.each([{ deadlineOffset: 60_000 }, { deadlineOffset: -1 }, { deadlineOffset: 0 }])(
    'keeps exhaustion retryable at deadline offset $deadlineOffset',
    async ({ deadlineOffset }) => {
      const h = setup({
        claim: {
          kind: 'ignored',
          reason: 'attempts_exhausted',
          effectDeadlineAt: new Date(NOW.getTime() + deadlineOffset),
          authority: { kind: 'pending', dispatchEpoch: 7 },
        },
      })
      await run(h, { dispatchEpoch: 7 })
      expect(h.terminalizeItem).toHaveBeenCalledExactlyOnceWith({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        authority: { kind: 'pending', dispatchEpoch: 7 },
        outcomeCode: 'temporarily_unavailable',
        retainRetryState: true,
        now: NOW,
      })
      expect(h.createBoundProperty).not.toHaveBeenCalled()
    },
  )

  it('defers exhausted completion when the Property receipt read fails', async () => {
    const h = setup({
      claim: {
        kind: 'ignored',
        reason: 'attempts_exhausted',
        effectDeadlineAt: new Date(NOW.getTime() + 60_000),
        authority: { kind: 'pending', dispatchEpoch: 7 },
      },
    })
    h.readReceipt
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('receipt unavailable'))
    await expect(run(h, { dispatchEpoch: 7 })).rejects.toThrow('receipt unavailable')
    expect(h.terminalizeItem).not.toHaveBeenCalled()
    expect(h.completeClaim).not.toHaveBeenCalled()
    expect(h.createBoundProperty).not.toHaveBeenCalled()
  })

  it('releases a transient failed attempt and throws for BullMQ retry', async () => {
    const harness = setup({ createError: new Error('database unavailable') })

    await expect(run(harness)).rejects.toThrow('database unavailable')

    expect(harness.releaseClaimForRetry).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      retryRevision: 0,
      dispatchEpoch: 0,
      claimFence: CLAIM_FENCE,
      now: NOW,
    })
    expect(harness.completeClaim).not.toHaveBeenCalled()
  })

  it('terminalizes before BullMQ backoff could cross the effect deadline', async () => {
    const harness = setup({
      claim: claimed({
        effectDeadlineAt: new Date(NOW.getTime() + 29_999),
      }),
      createError: new Error('database unavailable'),
    })

    await run(harness)

    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(harness.completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'temporarily_unavailable',
        retainRetryState: true,
      }),
    )
  })

  it('keeps a transient failure retryable when it lands after the effect deadline', async () => {
    let now = NOW
    const harness = setup({
      claim: claimed({ effectDeadlineAt: new Date(NOW.getTime() + 60_000) }),
      clock: () => now,
    })
    harness.createBoundProperty.mockImplementation(async () => {
      now = new Date(NOW.getTime() + 61_000)
      throw new Error('database unavailable')
    })

    await run(harness)

    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(harness.completeClaim).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        outcomeCode: 'temporarily_unavailable',
        retainRetryState: true,
        now,
      }),
    )
  })

  it('records a bounded transient failure after the final attempt', async () => {
    const harness = setup({
      claim: claimed({ attemptOrdinal: 5 }),
      createError: new Error('database unavailable'),
    })

    await run(harness, { attemptOrdinal: 5 })

    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(harness.completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'temporarily_unavailable',
        retainRetryState: true,
      }),
    )
  })

  it.each([
    ['name', 'invalid_name'],
    ['timezone', 'invalid_timezone'],
    ['country', 'invalid_country'],
  ] as const)(
    'ends a rejected %s as tenant_profile_invalid naming the field',
    async (field, code) => {
      const harness = setup({
        createError: Object.assign(new Error('rejected profile'), {
          code,
          _tag: 'PropertyError',
        }),
      })

      await run(harness)

      // Terminal on the first attempt: the same profile cannot succeed later.
      expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
      expect(harness.completeClaim).toHaveBeenCalledExactlyOnceWith({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
        retryRevision: 0,
        dispatchEpoch: 0,
        claimFence: CLAIM_FENCE,
        outcomeCode: 'tenant_profile_invalid',
        retainRetryState: false,
        now: NOW,
        detail: { kind: 'invalid_profile_field', field },
      })
    },
  )

  it.each(['create', 'relink'] as const)(
    'reports reconnect_required when disconnect wins before %s publication',
    async (action) => {
      const unavailable = Object.assign(new Error('connection unavailable'), {
        code: 'connection_unavailable',
      })
      const harness = setup({
        claim: claimed({
          action,
          existingPropertyId: action === 'relink' ? PROPERTY_ID : null,
          expectedSourceEpoch: action === 'relink' ? 0 : null,
          expectedProfileVersion: action === 'relink' ? 1 : null,
        }),
        createError: unavailable,
        relinkError: unavailable,
      })

      await run(harness)

      expect(harness.completeClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          outcomeCode: 'reconnect_required',
        }),
      )
      expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    },
  )

  it('names the field when the Property builder itself rejects the confirmed profile', async () => {
    const harness = setup({ claim: claimed({ timezone: 'Mars/Olympus' }) })

    await run(harness)

    expect(harness.createBoundProperty).not.toHaveBeenCalled()
    expect(harness.completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeCode: 'tenant_profile_invalid',
        detail: { kind: 'invalid_profile_field', field: 'timezone' },
      }),
    )
    const logged = JSON.stringify(harness.logger.warn.mock.calls)
    expect(logged).toContain('tenant_profile_invalid')
    expect(logged).not.toContain('Mars/Olympus')
  })

  describe('when the location is already bound to a Property', () => {
    const EXISTING_PROPERTY_ID = '00000000-0000-4000-8000-000000000009'
    const alreadyBound = Object.assign(new Error('Property Google binding rejected'), {
      code: 'location_already_bound',
      name: 'PropertyGoogleBindingError',
    })

    it('links the item to the Property in its own Organization that holds it', async () => {
      const harness = setup({
        createError: alreadyBound,
        locationHolders: [{ organizationId: ORG_ID, propertyId: EXISTING_PROPERTY_ID }],
      })

      await run(harness)

      expect(harness.readByLocationIds).toHaveBeenCalledWith(ORG_ID, [
        PROVIDER_LOCATION_ID,
      ])
      expect(harness.completeClaim).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          outcomeCode: 'already_exists',
          retainRetryState: false,
          detail: { kind: 'existing_property', propertyId: EXISTING_PROPERTY_ID },
        }),
      )
    })

    it('never records a holder from another Organization', async () => {
      const harness = setup({
        createError: alreadyBound,
        locationHolders: [{ organizationId: 'org-2', propertyId: EXISTING_PROPERTY_ID }],
      })

      await run(harness)

      const [terminal] = harness.completeClaim.mock.calls[0]!
      expect(terminal).toMatchObject({ outcomeCode: 'already_exists' })
      expect(terminal).not.toHaveProperty('detail')
      expect(JSON.stringify(harness.completeClaim.mock.calls)).not.toContain(
        EXISTING_PROPERTY_ID,
      )
    })

    it('keeps already_exists without a link when no holder is found', async () => {
      const harness = setup({ createError: alreadyBound, locationHolders: [] })

      await run(harness)

      const [terminal] = harness.completeClaim.mock.calls[0]!
      expect(terminal).toMatchObject({ outcomeCode: 'already_exists' })
      expect(terminal).not.toHaveProperty('detail')
    })

    it('keeps already_exists when the lookup fails, and logs it without content', async () => {
      const harness = setup({
        createError: alreadyBound,
        locationLookupError: Object.assign(new Error('pool exhausted'), {
          code: '53300',
        }),
      })

      await run(harness)

      expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
      const [terminal] = harness.completeClaim.mock.calls[0]!
      expect(terminal).toMatchObject({ outcomeCode: 'already_exists' })
      expect(terminal).not.toHaveProperty('detail')
      expect(harness.logger.warn).toHaveBeenCalledWith(
        { itemId: ITEM_ID, errorName: 'Error', errorCode: '53300' },
        'Google import could not resolve the Property that already holds the location',
      )
      const logged = JSON.stringify(harness.logger.warn.mock.calls)
      expect(logged).not.toContain(PROVIDER_LOCATION_ID)
      expect(logged).not.toContain(ORG_ID)
    })

    it('looks up the holder only for already_exists', async () => {
      const harness = setup({
        createError: Object.assign(new Error('conflict'), {
          code: 'active_binding_conflict',
        }),
      })

      await run(harness)

      expect(harness.readByLocationIds).not.toHaveBeenCalled()
    })
  })

  it('logs the originating error before folding it into a content-free outcome', async () => {
    const harness = setup({
      createError: Object.assign(new Error('slug already taken'), {
        code: 'invalid_slug',
        name: 'PropertyDomainError',
      }),
    })

    await run(harness)

    expect(harness.completeClaim).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeCode: 'internal_error' }),
    )
    expect(harness.logger.warn).toHaveBeenCalledWith(
      {
        itemId: ITEM_ID,
        action: 'create',
        attemptOrdinal: 1,
        retryRevision: 0,
        errorName: 'PropertyDomainError',
        errorCode: 'invalid_slug',
        outcome: 'internal_error',
      },
      'Google import item effect failed',
    )
    // The whole point of the record is diagnosis; it must not smuggle content.
    const logged = JSON.stringify(harness.logger.warn.mock.calls)
    expect(logged).not.toContain('slug already taken')
    expect(logged).not.toContain('Acme Hotel')
    expect(logged).not.toContain(PROVIDER_LOCATION_ID)
    // BANNED_LOG_KEYS: the tenant identifier must never reach a log line.
    expect(logged).not.toContain(ORG_ID)
    expect(logged).not.toContain('organizationId')
  })

  it('relinks with the expected Property generation snapshot', async () => {
    const harness = setup({
      claim: claimed({
        action: 'relink',
        existingPropertyId: PROPERTY_ID,
        destinationPropertyId: PROPERTY_ID,
        expectedSourceEpoch: 7,
        expectedProfileVersion: 9,
      }),
      receipts: [
        null,
        null,
        importedReceipt({
          outcome: 'relinked',
          destinationSourceEpoch: 8,
          destinationProfileVersion: 10,
        }),
      ],
    })

    await run(harness)

    expect(harness.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: [
          {
            propertyId: PROPERTY_ID,
            sourceEpoch: 7,
            profileVersion: 9,
            action: 'property.update',
          },
        ],
      }),
    )
    expect(harness.relink).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        expectedSourceEpoch: 7,
        expectedProfileVersion: 9,
        profile: expect.objectContaining({
          googleReviewUri: GOOGLE_REVIEW_URI,
          googlePrimaryCategory: GOOGLE_PRIMARY_CATEGORY,
        }),
      }),
    )
    expect(harness.reconcileFromReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        itemId: ITEM_ID,
      }),
    )
    expect(harness.completeClaim).not.toHaveBeenCalled()
  })

  it('leaves receipt-backed follow-ups to independent durable consumers', async () => {
    const harness = setup({ receipts: [null, null, importedReceipt()] })
    await run(harness)
    expect(harness.reconcileFromReceipt).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: ITEM_ID,
      now: NOW,
    })
    expect(harness.enqueueReviewSync).not.toHaveBeenCalled()
    expect(harness.defaultPublicDisplayName).not.toHaveBeenCalled()
    expect(harness.subscribeToNotifications).not.toHaveBeenCalled()
  })
})
