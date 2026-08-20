import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  deriveReviewProviderSubject,
  encodeReviewProviderSubjectScope,
  parseReviewProviderResource,
  reviewProviderSubjectsEqual,
  type ReviewProviderSubject,
  type ReviewProviderSubjectInput,
} from './review-provider-subject-contract'

type Fixture = Readonly<{
  catalogueVersion: string
  catalogueSha256: string
  fixtureId: string
  resourceName: string
  expectedSegments: Readonly<{
    accountId: string
    locationId: string
    reviewId: string
  }>
}>

type ResourceMutation =
  | Readonly<{ kind: 'uppercase_prefix' }>
  | Readonly<{ kind: 'append_review_segment'; value: string }>
  | Readonly<{ kind: 'replace_all_segments'; scalar: string; count: number }>
  | Readonly<{ kind: 'replace_review_segment'; scalar: string; count: number }>

type Vector = Readonly<{
  vectorId: string
  resourceFixtureId: string
  resourceFixtureCatalogueSha256?: string
  inputPatch: Readonly<{
    organizationId?: string
    propertyId?: string
    sourceEpoch?: number
    keyVersion?: string
    keyFillByte?: number
    keyByteLength?: number
  }>
  resourceMutation?: ResourceMutation
  simulateLocatorFromVectorId?: string
  expected:
    | Readonly<{ status: 'failure'; error: string }>
    | Readonly<{
        status: 'success'
        scopeHex?: string
        locatorHmacHex?: string
        verifierHmacHex?: string
        resourceByteLength?: number
        segmentByteLength?: number
        relationToBase:
          | 'exact'
          | 'exact_duplicate'
          | 'different_scope'
          | 'different_key'
          | 'same_hmac_different_key_version'
          | 'different_resource_bytes'
          | 'locator_collision_verifier_mismatch'
      }>
}>

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../test-fixtures/generated/review-provider-subject-v1.fixture.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Fixture
const vectors = JSON.parse(
  readFileSync(
    new URL('./review-provider-subject-v1.vectors.json', import.meta.url),
    'utf8',
  ),
) as ReadonlyArray<Vector>
const encoder = new TextEncoder()
const BASE_INPUT = Object.freeze({
  organizationId: '00000000-0000-4000-8000-000000000001',
  propertyId: '00000000-0000-4000-8000-000000000002',
  sourceEpoch: 7,
  keyVersion: 'k1',
  key: new Uint8Array(32).fill(0x5a),
})

function resourceForVector(vector: Vector): string {
  const mutation = vector.resourceMutation
  if (mutation === undefined) return fixture.resourceName
  if (mutation.kind === 'uppercase_prefix') {
    return `A${fixture.resourceName.slice(1)}`
  }
  const { accountId, locationId, reviewId } = fixture.expectedSegments
  if (mutation.kind === 'append_review_segment') {
    return [
      'accounts',
      accountId,
      'locations',
      locationId,
      'reviews',
      reviewId + mutation.value,
    ].join('/')
  }
  if (mutation.kind === 'replace_all_segments') {
    const segment = mutation.scalar.repeat(mutation.count)
    return ['accounts', segment, 'locations', segment, 'reviews', segment].join('/')
  }
  return [
    'accounts',
    accountId,
    'locations',
    locationId,
    'reviews',
    mutation.scalar.repeat(mutation.count),
  ].join('/')
}

function inputForVector(vector: Vector): ReviewProviderSubjectInput {
  const { keyFillByte, keyByteLength, ...inputPatch } = vector.inputPatch
  return {
    ...BASE_INPUT,
    ...inputPatch,
    resourceName: resourceForVector(vector),
    key:
      keyFillByte === undefined && keyByteLength === undefined
        ? BASE_INPUT.key
        : new Uint8Array(keyByteLength ?? 32).fill(keyFillByte ?? 0x5a),
  }
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex')
}

describe('review-provider-subject-v1', () => {
  it('consumes only the C0-generated provider-resource fixture seam', () => {
    expect(fixture.fixtureId).toBe('google-review-primary')
    expect(fixture.catalogueVersion).toBe('google-provider-identifiers-v1')
    expect(fixture.catalogueSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(parseReviewProviderResource(fixture.resourceName)).toEqual({
      name: fixture.resourceName,
      ...fixture.expectedSegments,
    })
  })

  it.each(vectors)('reproduces $vectorId', (vector) => {
    expect(vector.resourceFixtureId).toBe(fixture.fixtureId)
    if (vector.resourceFixtureCatalogueSha256 !== undefined) {
      expect(vector.resourceFixtureCatalogueSha256).toBe(fixture.catalogueSha256)
    }
    const input = inputForVector(vector)
    const invoke = () => deriveReviewProviderSubject(input)
    if (vector.expected.status === 'failure') {
      expect(invoke).toThrow(vector.expected.error)
      return
    }

    const subject = invoke()
    if (vector.expected.scopeHex !== undefined) {
      expect(hex(encodeReviewProviderSubjectScope(input))).toBe(vector.expected.scopeHex)
    }
    if (vector.expected.locatorHmacHex !== undefined) {
      expect(hex(subject.locatorHmac)).toBe(vector.expected.locatorHmacHex)
    }
    if (vector.expected.verifierHmacHex !== undefined) {
      expect(hex(subject.verifierHmac)).toBe(vector.expected.verifierHmacHex)
    }
    if (vector.expected.resourceByteLength !== undefined) {
      expect(encoder.encode(input.resourceName)).toHaveLength(
        vector.expected.resourceByteLength,
      )
    }
    if (vector.expected.segmentByteLength !== undefined) {
      const parsed = parseReviewProviderResource(input.resourceName)
      expect(encoder.encode(parsed.accountId)).toHaveLength(
        vector.expected.segmentByteLength,
      )
      expect(encoder.encode(parsed.locationId)).toHaveLength(
        vector.expected.segmentByteLength,
      )
      expect(encoder.encode(parsed.reviewId)).toHaveLength(
        vector.expected.segmentByteLength,
      )
    }

    const base = deriveReviewProviderSubject({
      ...BASE_INPUT,
      resourceName: fixture.resourceName,
    })
    switch (vector.expected.relationToBase) {
      case 'exact':
      case 'exact_duplicate':
        expect(reviewProviderSubjectsEqual(base, subject)).toBe(true)
        expect(subject.locatorHmac).not.toEqual(subject.verifierHmac)
        break
      case 'same_hmac_different_key_version':
        expect(subject.locatorHmac).toEqual(base.locatorHmac)
        expect(subject.verifierHmac).toEqual(base.verifierHmac)
        expect(reviewProviderSubjectsEqual(base, subject)).toBe(false)
        break
      case 'locator_collision_verifier_mismatch': {
        expect(vector.simulateLocatorFromVectorId).toBe('base-domain-separated')
        const collisionCandidate: ReviewProviderSubject = Object.freeze({
          ...subject,
          locatorHmac: base.locatorHmac,
        })
        expect(collisionCandidate.locatorHmac).toEqual(base.locatorHmac)
        expect(collisionCandidate.verifierHmac).not.toEqual(base.verifierHmac)
        expect(reviewProviderSubjectsEqual(base, collisionCandidate)).toBe(false)
        break
      }
      default:
        expect(reviewProviderSubjectsEqual(base, subject)).toBe(false)
    }
  })

  it('accepts native organization IDs and keeps their subject scopes distinct', () => {
    const first = deriveReviewProviderSubject({
      ...BASE_INPUT,
      organizationId: '0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC',
      resourceName: fixture.resourceName,
    })
    const second = deriveReviewProviderSubject({
      ...BASE_INPUT,
      organizationId: '0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuD',
      resourceName: fixture.resourceName,
    })

    expect(reviewProviderSubjectsEqual(first, second)).toBe(false)
    expect(() =>
      deriveReviewProviderSubject({
        ...BASE_INPUT,
        organizationId: 'unsafe organization id',
        resourceName: fixture.resourceName,
      }),
    ).toThrow('organizationId must be a safe identifier')
  })
})
