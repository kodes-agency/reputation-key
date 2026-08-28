import { describe, expect, it } from 'vitest'
import {
  DORMANT_BILLING_FIELDS,
  buildDormantBillingDataReport,
  canonicalDormantBillingDataReport,
  type DormantBillingPresenceRow,
} from './dormant-billing-data-lifecycle'

const emptyPresence = () =>
  Object.fromEntries(DORMANT_BILLING_FIELDS.map((field) => [field, false])) as Record<
    (typeof DORMANT_BILLING_FIELDS)[number],
    boolean
  >

const row = (
  organizationId: string,
  present: ReadonlyArray<(typeof DORMANT_BILLING_FIELDS)[number]>,
): DormantBillingPresenceRow => ({
  organizationId,
  fields: {
    ...emptyPresence(),
    ...Object.fromEntries(present.map((field) => [field, true])),
  },
})

describe('dormant Billing data lifecycle', () => {
  it('builds a content-free exact report for every retained compatibility field', () => {
    const report = buildDormantBillingDataReport({
      evaluatedAt: new Date('2026-08-28T01:02:03.000Z'),
      rows: [
        row('org-b', ['billingAddress', 'billingCountry']),
        row('org-a', ['billingCompanyName', 'billingCountry']),
        row('org-empty', []),
      ],
    })

    expect(report).toMatchObject({
      version: 'dormant-billing-data-report-v1',
      evaluatedAt: '2026-08-28T01:02:03.000Z',
      totalOrganizationCount: 3,
      organizationsWithDormantBillingData: 2,
      storedFieldValueCount: 4,
      fieldPresenceCounts: {
        billingCompanyName: 1,
        billingAddress: 1,
        billingCity: 0,
        billingPostalCode: 0,
        billingCountry: 2,
      },
      dataDisposition: 'erase_before_beta',
      schemaDisposition: 'compatibility_only_until_reintroduction_contract',
      erasureRequired: true,
      schemaContractionCandidate: false,
    })
    expect(report.targetFingerprint).toMatch(/^[0-9a-f]{64}$/u)
    expect(report.reportFingerprint).toMatch(/^[0-9a-f]{64}$/u)
    expect(canonicalDormantBillingDataReport(report)).not.toContain('org-a')
    expect(canonicalDormantBillingDataReport(report)).not.toContain('org-b')
  })

  it('uses an order-independent target fingerprint that excludes evaluation time', () => {
    const rows = [row('org-b', ['billingCountry']), row('org-a', ['billingCompanyName'])]
    const first = buildDormantBillingDataReport({
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      rows,
    })
    const second = buildDormantBillingDataReport({
      evaluatedAt: new Date('2026-08-29T00:00:00.000Z'),
      rows: [...rows].reverse(),
    })

    expect(first.targetFingerprint).toBe(second.targetFingerprint)
    expect(first.reportFingerprint).not.toBe(second.reportFingerprint)
  })

  it('reports an empty data set as mechanically ready while retaining the schema', () => {
    expect(
      buildDormantBillingDataReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        rows: [row('org-empty', [])],
      }),
    ).toMatchObject({
      organizationsWithDormantBillingData: 0,
      storedFieldValueCount: 0,
      erasureRequired: false,
      schemaContractionCandidate: true,
    })
  })

  it('refuses malformed snapshots instead of producing partial evidence', () => {
    const valid = row('org-a', [])
    expect(() =>
      buildDormantBillingDataReport({
        evaluatedAt: new Date('invalid'),
        rows: [valid],
      }),
    ).toThrow('dormant_billing_report_time_invalid')
    expect(() =>
      buildDormantBillingDataReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        rows: [valid, valid],
      }),
    ).toThrow('dormant_billing_report_row_invalid')
    expect(() =>
      buildDormantBillingDataReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        rows: [{ organizationId: 'unsafe\nidentifier', fields: emptyPresence() }],
      }),
    ).toThrow('dormant_billing_report_row_invalid')
  })
})
