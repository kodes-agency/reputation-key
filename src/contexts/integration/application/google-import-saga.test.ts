import { describe, expect, it } from 'vitest'
import {
  GOOGLE_IMPORT_BATCH_SIZE,
  planGoogleImportSagaBatches,
  reduceGoogleImportSaga,
} from './google-import-saga'

describe('Google import parent saga', () => {
  it('plans every selected location into stable 100-item child batches', () => {
    const items = Array.from({ length: 205 }, (_, index) => `location-${index + 1}`)

    const batches = planGoogleImportSagaBatches(items)

    expect(GOOGLE_IMPORT_BATCH_SIZE).toBe(100)
    expect(batches.map((batch) => batch.items.length)).toEqual([100, 100, 5])
    expect(batches.map((batch) => batch.ordinal)).toEqual([0, 1, 2])
    expect(batches.flatMap((batch) => batch.items)).toEqual(items)
  })

  it('derives honest aggregate progress from every child batch', () => {
    expect(
      reduceGoogleImportSaga([
        {
          status: 'completed',
          totalCount: 100,
          processedCount: 100,
          counts: {
            pending: 0,
            processing: 0,
            imported: 90,
            relinked: 10,
            already_exists: 0,
            failed: 0,
            cancelled: 0,
          },
        },
        {
          status: 'processing',
          totalCount: 100,
          processedCount: 40,
          counts: {
            pending: 50,
            processing: 10,
            imported: 35,
            relinked: 0,
            already_exists: 3,
            failed: 2,
            cancelled: 0,
          },
        },
        {
          status: 'queued',
          totalCount: 5,
          processedCount: 0,
          counts: {
            pending: 5,
            processing: 0,
            imported: 0,
            relinked: 0,
            already_exists: 0,
            failed: 0,
            cancelled: 0,
          },
        },
      ]),
    ).toEqual({
      status: 'processing',
      totalCount: 205,
      processedCount: 140,
      counts: {
        pending: 55,
        processing: 10,
        imported: 125,
        relinked: 10,
        already_exists: 3,
        failed: 2,
        cancelled: 0,
      },
    })
  })

  it('does not report complete while any child batch is still active', () => {
    expect(
      reduceGoogleImportSaga([
        {
          status: 'completed',
          totalCount: 1,
          processedCount: 1,
          counts: {
            pending: 0,
            processing: 0,
            imported: 1,
            relinked: 0,
            already_exists: 0,
            failed: 0,
            cancelled: 0,
          },
        },
        {
          status: 'queued',
          totalCount: 1,
          processedCount: 0,
          counts: {
            pending: 1,
            processing: 0,
            imported: 0,
            relinked: 0,
            already_exists: 0,
            failed: 0,
            cancelled: 0,
          },
        },
      ]).status,
    ).toBe('processing')
  })
})
