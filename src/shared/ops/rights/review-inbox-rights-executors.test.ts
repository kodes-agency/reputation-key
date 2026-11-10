import type { ReplyScopeEffects } from '#/shared/db/reply-scope-effects'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { RightsRequestPlan } from './rights-request-command'

const stores = vi.hoisted(() => ({
  closeReview: vi.fn(),
  readReviewRightsExport: vi.fn(),
  readReviewRightsReport: vi.fn(),
  closeInbox: vi.fn(),
  readInboxRightsExport: vi.fn(),
  readInboxRightsReport: vi.fn(),
}))
vi.mock('#/shared/db/lifecycle/review-rights-store', () => ({
  closeReview: stores.closeReview,
  readReviewRightsExport: stores.readReviewRightsExport,
  readReviewRightsReport: stores.readReviewRightsReport,
  REVIEW_RIGHTS_TABLES: { organization: ['reviews'], property: ['reviews'] },
}))
vi.mock('#/shared/db/lifecycle/inbox-rights-store', () => ({
  closeInbox: stores.closeInbox,
  readInboxRightsExport: stores.readInboxRightsExport,
  readInboxRightsReport: stores.readInboxRightsReport,
  INBOX_RIGHTS_TABLES: { organization: ['inbox_items'], property: ['inbox_items'] },
}))

const {
  INBOX_RIGHTS_EXPORT_PATH,
  REVIEW_RIGHTS_EXPORT_PATH,
  createInboxRightsExecutor,
  createReviewRightsExecutor,
} = await import('./review-inbox-rights-executors')

const db = {} as Database
const NOW = new Date('2026-11-08T12:00:00.000Z')
const plan: RightsRequestPlan = {
  scope: 'organization',
  mode: 'report',
  organizationId: 'org-asked',
  batchSize: 50,
}

const effects = {} as ReplyScopeEffects

describe('Review and Inbox rights executors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cover access, organization and property requests', () => {
    for (const make of [createReviewRightsExecutor, createInboxRightsExecutor]) {
      expect(make({ db }).scopes).toEqual(['access', 'organization', 'property'])
    }
  })

  it('export one canonical JSON file for the asked-for organization', async () => {
    stores.readReviewRightsExport.mockResolvedValue({ b: 1, a: 'text' })
    stores.readInboxRightsExport.mockResolvedValue({ notes: [] })

    const [review] = await createReviewRightsExecutor({ db }).exportFiles(plan)
    const [inbox] = await createInboxRightsExecutor({ db }).exportFiles(plan)

    expect(stores.readReviewRightsExport).toHaveBeenCalledWith(db, 'org-asked')
    expect(stores.readInboxRightsExport).toHaveBeenCalledWith(db, 'org-asked')
    expect(review?.path).toBe(REVIEW_RIGHTS_EXPORT_PATH)
    expect(Buffer.from(review?.bytes ?? []).toString()).toBe('{"a":"text","b":1}\n')
    expect(inbox?.path).toBe(INBOX_RIGHTS_EXPORT_PATH)
  })

  it('report with the supplied clock', async () => {
    stores.readReviewRightsReport.mockResolvedValue(['reviews=1'])

    const lines = await createReviewRightsExecutor({ db, now: () => NOW }).report(plan)

    expect(lines).toEqual(['reviews=1'])
    expect(stores.readReviewRightsReport).toHaveBeenCalledWith(db, 'org-asked', NOW)
  })

  it('apply reports counts, and passes a refusal through unchanged', async () => {
    stores.closeReview.mockResolvedValueOnce({ ok: true, deleted: 4, scrubbed: 2 })
    stores.closeInbox.mockResolvedValueOnce({
      ok: false,
      error: 'organization not found',
    })

    const review = await createReviewRightsExecutor({
      db,
      now: () => NOW,
      replyEffects: effects,
    }).apply(plan)
    const inbox = await createInboxRightsExecutor({ db, now: () => NOW }).apply(plan)

    expect(review).toEqual({ ok: true, lines: ['deleted=4 scrubbed=2'] })
    expect(inbox).toEqual({ ok: false, error: 'organization not found' })
    expect(stores.closeReview).toHaveBeenCalledWith(db, effects, 'org-asked', NOW)
  })
})
