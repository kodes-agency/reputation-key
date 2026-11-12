import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiAdmissionDescriptorV1 } from '#/shared/ai-internal-transport-contract'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import {
  evaluateProviderDispatchGate,
  type ProviderBoundaryInvocation,
} from './connector-boundary'
import {
  aiAdmissionDescriptorDigest,
  consumeAiExecutionAdmission,
  isMintedAiExecutionAdmission,
  settlementPermitOf,
} from './execution-admission'
import { admitForTest } from './execution-admission.test-fixtures'

const NOW = 1_780_000_000_000
const OPERATION_ID = '10000000-0000-4000-8000-000000000001'
const PERMIT_ID = '10000000-0000-4000-8000-000000000002'

function invocation(): ProviderBoundaryInvocation {
  const sdkRequest = { model: 'fixed', input: 'exact bytes' }
  const canonicalProviderBytes = Buffer.from(canonicalizeRfc8785(sdkRequest), 'utf8')
  const preparedDigest = createHash('sha256')
    .update('ai-prepared-v1\0', 'utf8')
    .update(canonicalProviderBytes)
    .digest('hex')
  const descriptor = {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'review-analysis',
    operationId: OPERATION_ID,
    permitId: PERMIT_ID,
    attemptNumber: 1,
    sourceDigest: 'a'.repeat(64),
    preparedDigest,
    sourceByteCount: 10,
    preparedByteCount: canonicalProviderBytes.byteLength,
    providerPayloadByteCount: 10,
    promptCacheShard: 0,
    limits: {
      sourceBytes: 100,
      providerPayloadBytes: 100,
      preparedRequestBytes: 100,
      responseBytes: 100,
      outputTokens: 100,
      costMicros: 100,
    },
    callerDeadlineEpochMillis: NOW + 70_000,
  } as unknown as AiAdmissionDescriptorV1
  return { descriptor, sdkRequest, canonicalProviderBytes }
}

function gate(
  value: ProviderBoundaryInvocation,
  admission: unknown,
  currentTime = NOW + 1_000,
) {
  return evaluateProviderDispatchGate({
    invocation: value,
    admission: admission as never,
    currentTime,
  })
}

describe('a typed execution admission', () => {
  it('is minted for the descriptor it digests and spent exactly once', () => {
    const value = invocation()
    const admission = admitForTest(value.descriptor, { issuedAtEpochMillis: NOW })

    expect(isMintedAiExecutionAdmission(admission)).toBe(true)
    expect(Object.isFrozen(admission)).toBe(true)
    expect(Object.isFrozen(admission.limits)).toBe(true)
    expect(admission.descriptorDigest).toBe(aiAdmissionDescriptorDigest(value.descriptor))
    expect(settlementPermitOf(admission)).toEqual({
      operationId: OPERATION_ID,
      permitId: PERMIT_ID,
      attemptNumber: 1,
    })
    expect(consumeAiExecutionAdmission(admission)).toBe(true)
    expect(consumeAiExecutionAdmission(admission)).toBe(false)
  })

  it('treats a copy, a forgery and a non-object as never minted', () => {
    const admission = admitForTest(invocation().descriptor, { issuedAtEpochMillis: NOW })
    for (const forged of [{ ...admission }, structuredClone(admission), null, 'x']) {
      expect(isMintedAiExecutionAdmission(forged)).toBe(false)
      expect(consumeAiExecutionAdmission(forged)).toBe(false)
    }
    expect(consumeAiExecutionAdmission(admission)).toBe(true)
  })
})

describe('the dispatch gate', () => {
  it('lets a minted admission for this exact invocation dispatch once', () => {
    const value = invocation()
    const admission = admitForTest(value.descriptor, { issuedAtEpochMillis: NOW })

    expect(gate(value, admission)).toEqual({ accepted: true, reasons: [] })
    expect(gate(value, admission)).toEqual({
      accepted: false,
      reasons: ['admission_already_used'],
    })
  })

  it.each([
    [
      'another permit',
      (value: ProviderBoundaryInvocation) =>
        admitForTest(
          { ...value.descriptor, permitId: '10000000-0000-4000-8000-0000000000ff' },
          { issuedAtEpochMillis: NOW },
        ),
      ['permit_id_mismatch', 'descriptor_digest_mismatch'],
    ],
    [
      'another descriptor',
      (value: ProviderBoundaryInvocation) =>
        admitForTest(
          { ...value.descriptor, sourceDigest: 'b'.repeat(64) },
          { issuedAtEpochMillis: NOW },
        ),
      ['descriptor_digest_mismatch'],
    ],
    [
      'an object the authority did not mint',
      (value: ProviderBoundaryInvocation) => ({
        ...admitForTest(value.descriptor, { issuedAtEpochMillis: NOW }),
      }),
      ['admission_not_minted'],
    ],
  ] as const)('refuses %s without spending it', (_name, make, reasons) => {
    const value = invocation()
    const admission = make(value)
    expect(gate(value, admission)).toEqual({ accepted: false, reasons })
    expect(consumeAiExecutionAdmission(admission)).toBe(
      isMintedAiExecutionAdmission(admission),
    )
  })

  it('refuses an expired admission and one issued in the future, unspent', () => {
    const value = invocation()
    const admission = admitForTest(value.descriptor, { issuedAtEpochMillis: NOW })
    expect(gate(value, admission, NOW + 70_000)).toEqual({
      accepted: false,
      reasons: ['admission_expired'],
    })
    expect(gate(value, admission, NOW - 1)).toEqual({
      accepted: false,
      reasons: ['admission_issued_in_future'],
    })
    expect(gate(value, admission).accepted).toBe(true)
  })

  it('refuses bytes that are not the ones the descriptor names', () => {
    const value = invocation()
    const admission = admitForTest(value.descriptor, { issuedAtEpochMillis: NOW })
    const mutated = Buffer.from(value.canonicalProviderBytes)
    mutated[mutated.length - 2] = 'X'.charCodeAt(0)
    expect(gate({ ...value, canonicalProviderBytes: mutated }, admission)).toEqual({
      accepted: false,
      reasons: ['outbound_bytes_differ'],
    })
    expect(gate(value, admission).accepted).toBe(true)
  })
})

describe('who may mint an admission', () => {
  const MINTERS = new Set([
    'src/shared/ai-provider-control/execution-admission.ts',
    'src/contexts/ai/infrastructure/adapters/ai-execution-admission.adapter.ts',
  ])
  const PRODUCTION_ROOTS = ['src', 'server', 'scripts'].map((root) =>
    join(process.cwd(), root),
  )

  function productionSources(directory: string): string[] {
    if (!existsSync(directory)) return []
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.name === 'node_modules') return []
      if (entry.isDirectory()) return productionSources(path)
      return /\.[cm]?[jt]sx?$/.test(entry.name) &&
        !/\.test(-fixtures)?\.[cm]?[jt]sx?$/.test(entry.name)
        ? [path]
        : []
    })
  }

  it('is the AI admission adapter alone, outside tests', () => {
    const minters = productionSources(join(process.cwd(), 'src'))
      .filter((path) => readFileSync(path, 'utf8').includes('mintAiExecutionAdmission'))
      .map((path) => relative(process.cwd(), path))
    expect(new Set(minters)).toEqual(MINTERS)
  })

  it('is never reachable from production code through a test-fixtures module', () => {
    // A specifier in any quote style, with or without an extension, reached by
    // import, re-export, dynamic import or require.
    const fixtureSpecifier = /(['"`])[^'"`\n]*\.test-fixtures(?:\.[cm]?[jt]sx?)?\1/
    const importers = PRODUCTION_ROOTS.flatMap(productionSources)
      .filter((path) => fixtureSpecifier.test(readFileSync(path, 'utf8')))
      .map((path) => relative(process.cwd(), path))
    expect(importers).toEqual([])
  })

  it('knows the specifier shapes it polices', () => {
    const fixtureSpecifier = /(['"`])[^'"`\n]*\.test-fixtures(?:\.[cm]?[jt]sx?)?\1/
    for (const line of [
      "import { x } from './a.test-fixtures'",
      'import { x } from "./a.test-fixtures.ts"',
      "export * from '../a.test-fixtures.js'",
      "const m = await import('./a.test-fixtures')",
      "const m = require('./a.test-fixtures.cjs')",
    ])
      expect(fixtureSpecifier.test(line)).toBe(true)
    expect(fixtureSpecifier.test("import { x } from './a.test-helpers'")).toBe(false)
  })
})
