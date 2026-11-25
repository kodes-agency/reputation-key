import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { googleImportItems } from '#/shared/db/schema/google-import.schema'
import {
  useImportStoreItemsSuite,
  NOW,
  ORG_ID,
  USER_ID,
  REQUEST_ID,
  ITEM_ID,
  intent,
} from '#/contexts/integration/imports/google-import-store-items.test-fixtures'

describe('Google import item behaviour on the import store (real PostgreSQL)', () => {
  const suite = useImportStoreItemsSuite()
  const {
    resetStorage,
    resetIntent,
    readItem,
    claim,
    claimForTerminal,
    lifecycleTerminal,
    scrub,
  } = suite

  describe('the Google primary category an item carries to its Property', () => {
    const CLAIM_FENCE = '20000000-0000-4000-8000-000000000020'
    const category = async () => (await readItem())?.googlePrimaryCategory

    it('is stored with the item and handed to the effect that creates the Property', async () => {
      await resetStorage()
      await expect(
        suite.store.commitImport(intent(NOW, 'Boat rental service')),
      ).resolves.toBe('committed')

      expect(await category()).toBe('Boat rental service')
      await expect(claim(CLAIM_FENCE)).resolves.toMatchObject({
        kind: 'claimed',
        item: { googlePrimaryCategory: 'Boat rental service' },
      })
    })

    it('is absent for an item written without one, and reaches the effect as null', async () => {
      await resetStorage()
      await expect(suite.store.commitImport(intent(NOW))).resolves.toBe('committed')

      expect(await category()).toBeNull()
      await expect(claim(CLAIM_FENCE)).resolves.toMatchObject({
        kind: 'claimed',
        item: { googlePrimaryCategory: null },
      })
    })

    it('goes with the other provider state when the item ends, but not when it may be retried', async () => {
      await resetStorage()
      await expect(suite.store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe(
        'committed',
      )
      await expect(lifecycleTerminal('temporarily_unavailable')).resolves.toBe(
        'completed',
      )
      expect(await category()).toBe('Day spa')

      await resetStorage()
      await expect(suite.store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe(
        'committed',
      )
      await expect(lifecycleTerminal('authorization_changed')).resolves.toBe('completed')
      expect(await category()).toBeNull()
    })

    // The table refuses a category on a finished item, so the scrub can no
    // longer be shown taking one from a row that holds it; it must still
    // report the row it cleaned and leave none behind.
    it('is held by no finished item: the database refuses one and the scrub leaves none', async () => {
      await resetStorage()
      await expect(suite.store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe(
        'committed',
      )
      await lifecycleTerminal('authorization_changed')
      await expect(
        suite.db
          .update(googleImportItems)
          .set({ googlePrimaryCategory: 'Day spa' })
          .where(eq(googleImportItems.id, ITEM_ID)),
      ).rejects.toMatchObject({
        cause: { constraint: 'google_import_items_checkpoint_state_valid' },
      })

      await expect(scrub()).resolves.toBe(1)
      expect(await category()).toBeNull()
    })

    it('is cleared by the lifecycle scrub of an item that ends in the same sweep', async () => {
      await resetStorage()
      await expect(suite.store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe(
        'committed',
      )
      await lifecycleTerminal('user_cancelled')

      await expect(scrub()).resolves.toBe(1)

      expect(await category()).toBeNull()
    })

    it('is refused by the database when it is empty, padded or too long to be a category', async () => {
      await resetStorage()
      await expect(suite.store.commitImport(intent(NOW, 'Day spa'))).resolves.toBe(
        'committed',
      )

      for (const value of ['', ' Day spa', 'Day spa ']) {
        await expect(
          suite.db
            .update(googleImportItems)
            .set({ googlePrimaryCategory: value })
            .where(eq(googleImportItems.id, ITEM_ID)),
        ).rejects.toMatchObject({
          cause: { constraint: 'google_import_items_google_primary_category_valid' },
        })
      }
      // Past the column's own length the column refuses it before the check does.
      await expect(
        suite.db
          .update(googleImportItems)
          .set({ googlePrimaryCategory: 'x'.repeat(513) })
          .where(eq(googleImportItems.id, ITEM_ID)),
      ).rejects.toMatchObject({ cause: { code: '22001' } })
      expect(await category()).toBe('Day spa')
    })
  })

  describe('the outcome detail an ended item records', () => {
    it('names the rejected profile field on a terminal tenant_profile_invalid item', async () => {
      await resetIntent()
      const terminal = await claimForTerminal('20000000-0000-4000-8000-000000000015')

      await expect(
        suite.store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'tenant_profile_invalid',
        }),
      ).rejects.toThrow(/requires the rejected profile field/)
      await expect(
        suite.store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'internal_error',
          detail: { kind: 'invalid_profile_field', field: 'name' },
        }),
      ).rejects.toThrow(/cannot carry this detail/)
      await expect(
        suite.store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'tenant_profile_invalid',
          detail: { kind: 'invalid_profile_field', field: 'timezone' },
        }),
      ).resolves.toBe('completed')

      await expect(readItem()).resolves.toMatchObject({
        status: 'failed',
        outcomeCode: 'tenant_profile_invalid',
        invalidProfileField: 'timezone',
        destinationPropertyId: null,
        connectionId: null,
        providerAccountSuffix: null,
        providerLocationSuffix: null,
      })
      const progress = await suite.store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(progress).toMatchObject({ status: 'failed', canRetry: false })
      expect(progress?.items[0]).toMatchObject({
        status: 'failed',
        outcomeCode: 'tenant_profile_invalid',
        invalidProfileField: 'timezone',
        retryable: false,
        propertyId: null,
      })

      // The schema refuses a field on any other outcome, and any other field.
      await expect(
        suite.db
          .update(googleImportItems)
          .set({ outcomeCode: 'internal_error' })
          .where(eq(googleImportItems.id, ITEM_ID)),
      ).rejects.toMatchObject({
        cause: {
          code: '23514',
          constraint: 'google_import_items_invalid_profile_field_valid',
        },
      })
      await expect(
        suite.db
          .update(googleImportItems)
          .set({ invalidProfileField: 'slug' })
          .where(eq(googleImportItems.id, ITEM_ID)),
      ).rejects.toMatchObject({ cause: { code: '23514' } })
    })

    it('links an already_exists item to the Property that holds its location', async () => {
      await resetIntent()
      const existingPropertyId = '20000000-0000-4000-8000-000000000017'
      const terminal = await claimForTerminal('20000000-0000-4000-8000-000000000016')

      await expect(
        suite.store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'internal_error',
          detail: { kind: 'existing_property', propertyId: existingPropertyId },
        }),
      ).rejects.toThrow(/cannot carry this detail/)
      await expect(
        suite.store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'already_exists',
          detail: { kind: 'existing_property', propertyId: existingPropertyId },
        }),
      ).resolves.toBe('completed')

      await expect(readItem()).resolves.toMatchObject({
        status: 'already_exists',
        destinationPropertyId: existingPropertyId,
        invalidProfileField: null,
        connectionId: null,
        providerLocationSuffix: null,
      })
      const progress = await suite.store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(progress?.items[0]).toMatchObject({
        status: 'already_exists',
        propertyId: existingPropertyId,
        invalidProfileField: null,
      })

      // A scrub clears that reference like an import's.
      await expect(scrub()).resolves.toBe(1)
      const afterSweep = await suite.store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(afterSweep?.items[0]).toMatchObject({
        status: 'already_exists',
        propertyId: null,
      })
    })

    it('records an already_exists item without a Property when none was named', async () => {
      await resetIntent()
      const terminal = await claimForTerminal('20000000-0000-4000-8000-000000000018')

      await expect(
        suite.store.completeClaim({
          dispatchEpoch: 0,
          ...terminal,
          outcomeCode: 'already_exists',
        }),
      ).resolves.toBe('completed')

      const progress = await suite.store.getProgress(ORG_ID, USER_ID, REQUEST_ID)
      expect(progress?.items[0]).toMatchObject({
        status: 'already_exists',
        propertyId: null,
      })
    })
  })
})
