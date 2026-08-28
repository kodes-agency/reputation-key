import { createHash } from 'node:crypto'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'

/** Retained Better Auth compatibility columns; none is a beta product field. */
export const DORMANT_BILLING_FIELDS = Object.freeze([
  'billingCompanyName',
  'billingAddress',
  'billingCity',
  'billingPostalCode',
  'billingCountry',
] as const)

export type DormantBillingField = (typeof DORMANT_BILLING_FIELDS)[number]

export type DormantBillingPresenceRow = Readonly<{
  organizationId: string
  /** Presence only. Billing content must never enter the report model. */
  fields: Readonly<Record<DormantBillingField, boolean>>
}>

export type DormantBillingDataReport = Readonly<{
  version: 'dormant-billing-data-report-v1'
  evaluatedAt: string
  totalOrganizationCount: number
  organizationsWithDormantBillingData: number
  storedFieldValueCount: number
  fieldPresenceCounts: Readonly<Record<DormantBillingField, number>>
  dataDisposition: 'erase_before_beta'
  schemaDisposition: 'compatibility_only_until_reintroduction_contract'
  erasureRequired: boolean
  /** Mechanical data precondition only; Better Auth schema removal is separately approved. */
  schemaContractionCandidate: boolean
  /** Exact Organization/field-presence target set; no identifier is emitted. */
  targetFingerprint: string
  /** Binds the target fingerprint, aggregate counts, and observation time. */
  reportFingerprint: string
}>

type BuildDormantBillingDataReportInput = Readonly<{
  evaluatedAt: Date
  rows: ReadonlyArray<DormantBillingPresenceRow>
}>

const hash = (domain: string, value: string): string =>
  createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex')

const validateRow = (row: DormantBillingPresenceRow): void => {
  const concrete = row.fields as Readonly<Record<string, unknown>>
  if (
    !isSafeOpaqueIdentifier(row.organizationId) ||
    Object.keys(concrete).length !== DORMANT_BILLING_FIELDS.length ||
    DORMANT_BILLING_FIELDS.some((field) => typeof concrete[field] !== 'boolean')
  ) {
    throw new Error('dormant_billing_report_row_invalid')
  }
}

export const buildDormantBillingDataReport = (
  input: BuildDormantBillingDataReportInput,
): DormantBillingDataReport => {
  if (!Number.isSafeInteger(input.evaluatedAt.getTime())) {
    throw new Error('dormant_billing_report_time_invalid')
  }

  const seen = new Set<string>()
  for (const row of input.rows) {
    validateRow(row)
    if (seen.has(row.organizationId)) {
      throw new Error('dormant_billing_report_row_invalid')
    }
    seen.add(row.organizationId)
  }

  const targetRows = input.rows
    .filter((row) => DORMANT_BILLING_FIELDS.some((field) => row.fields[field]))
    .sort((left, right) => left.organizationId.localeCompare(right.organizationId, 'en'))
  const targetFingerprint = hash(
    'repkey-dormant-billing-target-v1',
    targetRows
      .map((row) =>
        [
          row.organizationId,
          ...DORMANT_BILLING_FIELDS.map((field) => (row.fields[field] ? '1' : '0')),
        ].join('\0'),
      )
      .join('\n'),
  )
  const fieldPresenceCounts = Object.fromEntries(
    DORMANT_BILLING_FIELDS.map((field) => [
      field,
      targetRows.reduce((count, row) => count + (row.fields[field] ? 1 : 0), 0),
    ]),
  ) as Record<DormantBillingField, number>
  const storedFieldValueCount = Object.values(fieldPresenceCounts).reduce(
    (total, count) => total + count,
    0,
  )
  if (!Number.isSafeInteger(storedFieldValueCount)) {
    throw new Error('dormant_billing_report_count_invalid')
  }

  const evidence = {
    version: 'dormant-billing-data-report-v1' as const,
    evaluatedAt: input.evaluatedAt.toISOString(),
    totalOrganizationCount: input.rows.length,
    organizationsWithDormantBillingData: targetRows.length,
    storedFieldValueCount,
    fieldPresenceCounts,
    dataDisposition: 'erase_before_beta' as const,
    schemaDisposition: 'compatibility_only_until_reintroduction_contract' as const,
    erasureRequired: targetRows.length > 0,
    schemaContractionCandidate: targetRows.length === 0,
    targetFingerprint,
  }
  const reportFingerprint = hash(
    'repkey-dormant-billing-report-v1',
    JSON.stringify(evidence),
  )
  return Object.freeze({ ...evidence, reportFingerprint })
}

export const canonicalDormantBillingDataReport = (
  report: DormantBillingDataReport,
): string => JSON.stringify(report, null, 2)
