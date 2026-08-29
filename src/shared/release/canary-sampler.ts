// REL-01 Promotion step 4 — the executable canary observer.
//
// Gate F's `promotion.canary_window` key has had a strict schema and no
// producer. This module is the producer, and it is built around one rule:
//
//   UNAVAILABLE DATA IS FAILURE, NOT ABSENCE.
//
// A read that throws, times out, returns a non-2xx, or returns a body the
// approved pointer cannot resolve to a finite number is recorded as a MISSING
// sample. A missing sample can never become an observed one, and any missing
// sample forces `outcome: 'failed'`. There is no retry: the evidence schema
// pins `attempts: 1, retries: 0` precisely so a flaky canary cannot be re-run
// to green.
//
// The sampler also refuses to emit at all when it observed no configuration
// head, because `continuity.configurationHeadSha256` would then have to be
// invented. Emitting a well-formed artifact from absent data is the exact
// failure mode this producer exists to prevent, so the whole run fails instead.
//
// Every digest the emitted evidence names is returned alongside it as a real
// file, because `gate-f-evidence.ts` rejects a dependency digest that is not
// retained as a sibling reference under the same gate.

import {
  canaryWindowDependencyDigests,
  canonicalCanaryWindowEvidence,
  parseCanaryWindowEvidence,
  type CanaryThresholdProfile,
  type CanaryWindowEvidence,
} from './canary-window-evidence'
import {
  canonicalReleaseEvidence,
  releaseEvidenceSha256,
  type ReleaseCandidateBinding,
} from './candidate-bound-evidence'

/** One signal's read instruction, ratified with the threshold profile. */
export type CanarySignalRead = Readonly<{
  name: string
  category: CanaryThresholdProfile['signals'][number]['category']
  source: CanaryThresholdProfile['signals'][number]['source']
  valuePointer: string
  sampleIntervalMs: number
}>

export type CanarySampleRequest = Readonly<{
  signal: CanarySignalRead
  sampleIndex: number
  scheduledAt: string
}>

export type CanarySampleReading =
  | Readonly<{
      ok: true
      value: number
      /** Exact source bytes; retained as the observation's source artifact. */
      rawSample: string
      /** Release identity observed with the sample, when the source exposes it. */
      identity?: Readonly<{ releaseSha?: string; releaseManifestSha256?: string }>
      /** Configuration head observed with the sample, when the source exposes it. */
      configurationHead?: string
    }>
  | Readonly<{ ok: false; reason: string }>

export type CanarySampleReader = (
  request: CanarySampleRequest,
) => Promise<CanarySampleReading>

export type CanaryDependencyFile = Readonly<{ sha256: string; content: string }>

export type CanaryWindowInput = Readonly<{
  candidate: ReleaseCandidateBinding
  profile: CanaryThresholdProfile
  readPlan: readonly CanarySignalRead[]
  runId: string
  startedAt: string
  read: CanarySampleReader
  /** Blocks until the wall clock reaches the scheduled instant. */
  waitUntil: (scheduledAt: string) => Promise<void>
  now: () => string
  /** Threshold-authority documents, keyed by their own digest. */
  authorities: readonly CanaryDependencyFile[]
}>

export type CanaryWindowResult =
  | Readonly<{
      ok: true
      evidence: CanaryWindowEvidence
      dependencies: readonly CanaryDependencyFile[]
    }>
  | Readonly<{ ok: false; errors: readonly string[] }>

type SampleRecord = Readonly<{
  sampleIndex: number
  scheduledAt: string
  observed: boolean
  value: number | null
  breached: boolean
  reason: string | null
}>

function satisfiesThreshold(
  comparator: 'eq' | 'lte' | 'gte',
  value: number,
  threshold: number,
): boolean {
  if (comparator === 'eq') return value === threshold
  if (comparator === 'lte') return value <= threshold
  return value >= threshold
}

/**
 * Expected samples cover the approved duration end-to-end: sample `k` lands at
 * `startedAt + k * interval`, clamped to the closing instant so the final
 * sample never falls outside the window the evidence schema validates.
 */
function scheduleFor(
  startedAt: number,
  durationMs: number,
  sampleIntervalMs: number,
): readonly string[] {
  const count = Math.ceil(durationMs / sampleIntervalMs)
  return Array.from({ length: count }, (_unused, index) =>
    new Date(
      startedAt + Math.min((index + 1) * sampleIntervalMs, durationMs),
    ).toISOString(),
  )
}

/**
 * Setup problems that make sampling meaningless before it starts: a read plan
 * that does not match the ratified signal order, or a threshold authority the
 * observer was never handed.
 */
function canaryObserverSetupErrors(input: CanaryWindowInput): readonly string[] {
  const setupErrors: string[] = []
  if (input.readPlan.length !== input.profile.signals.length) {
    setupErrors.push('read plan does not cover every approved signal')
  }
  for (const [index, signal] of input.profile.signals.entries()) {
    if (input.readPlan[index]?.name !== signal.name) {
      setupErrors.push(`read plan entry ${index} does not match approved signal order`)
    }
  }
  const authorities = new Map(
    input.authorities.map((file) => [file.sha256, file.content] as const),
  )
  for (const file of input.authorities) {
    if (releaseEvidenceSha256(file.content) !== file.sha256) {
      setupErrors.push(`authority ${file.sha256} does not hash to its own content`)
    }
  }
  if (!authorities.has(input.profile.decisionRecordSha256)) {
    setupErrors.push(
      `decision record ${input.profile.decisionRecordSha256} was not supplied to the observer`,
    )
  }
  for (const signal of input.profile.signals) {
    if (!authorities.has(signal.thresholdAuthoritySha256)) {
      setupErrors.push(
        `threshold authority ${signal.thresholdAuthoritySha256} for ${signal.name} was not supplied`,
      )
    }
  }
  return setupErrors
}

type TimelineSlot = Readonly<{
  at: number
  scheduledAt: string
  signalIndex: number
  sampleIndex: number
}>

/** Every signal's schedule interleaved into one wall-clock-ordered timeline. */
function canarySampleTimeline(
  schedules: readonly (readonly string[])[],
): readonly TimelineSlot[] {
  return schedules
    .flatMap((schedule, signalIndex) =>
      schedule.map((scheduledAt, sampleIndex) => ({
        at: Date.parse(scheduledAt),
        scheduledAt,
        signalIndex,
        sampleIndex,
      })),
    )
    .sort((left, right) => left.at - right.at || left.signalIndex - right.signalIndex)
}

/** A read that throws is a missing sample, never an absent one. */
async function readCanarySample(
  input: CanaryWindowInput,
  plan: CanarySignalRead,
  slot: TimelineSlot,
): Promise<CanarySampleReading> {
  try {
    return await input.read({
      signal: plan,
      sampleIndex: slot.sampleIndex,
      scheduledAt: slot.scheduledAt,
    })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function identityDrifted(
  identity: Readonly<{ releaseSha?: string; releaseManifestSha256?: string }> | undefined,
  candidate: ReleaseCandidateBinding,
): boolean {
  if (!identity) return false
  return (
    (identity.releaseSha !== undefined && identity.releaseSha !== candidate.releaseSha) ||
    (identity.releaseManifestSha256 !== undefined &&
      identity.releaseManifestSha256 !== candidate.releaseManifestSha256)
  )
}

type SampleOutcome = Readonly<{
  record: SampleRecord
  failures: readonly string[]
  readError: boolean
  identityMismatch: boolean
  configurationHeadMismatch: boolean
  /** The window's continuity head after this reading. */
  configurationHead: string | undefined
}>

/** Score one reading against its signal's threshold and the window's continuity. */
function evaluateCanaryReading(
  signal: CanaryThresholdProfile['signals'][number],
  slot: TimelineSlot,
  reading: CanarySampleReading,
  candidate: ReleaseCandidateBinding,
  configurationHead: string | undefined,
): SampleOutcome {
  const at = `${signal.name} @ ${slot.scheduledAt}`
  if (!reading.ok) {
    return {
      record: {
        sampleIndex: slot.sampleIndex,
        scheduledAt: slot.scheduledAt,
        observed: false,
        value: null,
        breached: false,
        reason: reading.reason,
      },
      failures: [`${at}: ${reading.reason}`],
      readError: true,
      identityMismatch: false,
      configurationHeadMismatch: false,
      configurationHead,
    }
  }

  const failures: string[] = []
  const breached = !satisfiesThreshold(signal.comparator, reading.value, signal.threshold)
  if (breached) {
    failures.push(
      `${at}: ${reading.value} ${signal.unit} breaches ${signal.comparator} ${signal.threshold}`,
    )
  }
  const identityMismatch = identityDrifted(reading.identity, candidate)
  if (identityMismatch) {
    failures.push(`${at}: RELEASE_SHA/RELEASE_MANIFEST_SHA256 drifted from the candidate`)
  }
  const head = configurationHead ?? reading.configurationHead
  const configurationHeadMismatch =
    reading.configurationHead !== undefined && reading.configurationHead !== head
  if (configurationHeadMismatch) {
    failures.push(`${at}: configuration head drifted mid-window`)
  }

  return {
    record: {
      sampleIndex: slot.sampleIndex,
      scheduledAt: slot.scheduledAt,
      observed: true,
      value: reading.value,
      breached,
      reason: null,
    },
    failures,
    readError: false,
    identityMismatch,
    configurationHeadMismatch,
    configurationHead: head,
  }
}

type WindowTally = Readonly<{
  records: readonly (readonly SampleRecord[])[]
  failures: readonly string[]
  releaseIdentityMismatches: number
  configurationHeadMismatches: number
  observerReadErrors: number
  configurationHead: string | undefined
}>

/** Walk the timeline, waiting for each slot and scoring what it read. */
async function sampleCanaryWindow(
  input: CanaryWindowInput,
  timeline: readonly TimelineSlot[],
): Promise<WindowTally> {
  const records: SampleRecord[][] = input.profile.signals.map(() => [])
  const failures: string[] = []
  let releaseIdentityMismatches = 0
  let configurationHeadMismatches = 0
  let observerReadErrors = 0
  let configurationHead: string | undefined

  for (const slot of timeline) {
    const signal = input.profile.signals[slot.signalIndex]
    const plan = input.readPlan[slot.signalIndex]
    if (!signal || !plan) continue
    await input.waitUntil(slot.scheduledAt)

    const reading = await readCanarySample(input, plan, slot)
    const outcome = evaluateCanaryReading(
      signal,
      slot,
      reading,
      input.candidate,
      configurationHead,
    )
    failures.push(...outcome.failures)
    if (outcome.readError) observerReadErrors += 1
    if (outcome.identityMismatch) releaseIdentityMismatches += 1
    if (outcome.configurationHeadMismatch) configurationHeadMismatches += 1
    configurationHead = outcome.configurationHead
    records[slot.signalIndex]?.push(outcome.record)
  }

  return {
    records,
    failures,
    releaseIdentityMismatches,
    configurationHeadMismatches,
    observerReadErrors,
    configurationHead,
  }
}

type CanaryObservationBuild = Readonly<{
  observations: CanaryWindowEvidence['observations']
  /** Source artifact and sample binding for each signal, in signal order. */
  dependencies: readonly CanaryDependencyFile[]
}>

/** Summarize each signal's samples and retain the files those summaries name. */
function buildCanaryObservations(
  input: CanaryWindowInput,
  schedules: readonly (readonly string[])[],
  records: readonly (readonly SampleRecord[])[],
): CanaryObservationBuild {
  const dependencies: CanaryDependencyFile[] = []
  const observations = input.profile.signals.map((signal, index) => {
    const schedule = schedules[index] ?? []
    const samples = records[index] ?? []
    const sourceArtifact = canonicalReleaseEvidence({
      signal: signal.name,
      runId: input.runId,
      samples,
    })
    const sourceArtifactSha256 = releaseEvidenceSha256(sourceArtifact)
    const sampleBinding = canonicalReleaseEvidence({
      candidate: input.candidate,
      runId: input.runId,
      signal,
      sourceArtifactSha256,
      expectedSamples: schedule.length,
      observedSamples: samples.filter(({ observed }) => observed).length,
      missingSamples: samples.filter(({ observed }) => !observed).length,
    })
    dependencies.push(
      { sha256: sourceArtifactSha256, content: sourceArtifact },
      { sha256: releaseEvidenceSha256(sampleBinding), content: sampleBinding },
    )
    return {
      name: signal.name,
      expectedSamples: schedule.length,
      observedSamples: samples.filter(({ observed }) => observed).length,
      missingSamples: samples.filter(({ observed }) => !observed).length,
      breachCount: samples.filter(({ breached }) => breached).length,
      firstSampleAt: schedule[0] ?? input.startedAt,
      lastSampleAt: schedule.at(-1) ?? input.startedAt,
      sourceArtifactSha256,
      sampleBindingSha256: releaseEvidenceSha256(sampleBinding),
    }
  })
  return { observations, dependencies }
}

export async function observeCanaryWindow(
  input: CanaryWindowInput,
): Promise<CanaryWindowResult> {
  const setupErrors = canaryObserverSetupErrors(input)
  if (setupErrors.length > 0) return { ok: false, errors: setupErrors }

  const startedAtMs = Date.parse(input.startedAt)
  const schedules = input.profile.signals.map((signal) =>
    scheduleFor(startedAtMs, input.profile.durationMs, signal.sampleIntervalMs),
  )
  const tally = await sampleCanaryWindow(input, canarySampleTimeline(schedules))

  const { configurationHead } = tally
  if (configurationHead === undefined) {
    return {
      ok: false,
      errors: [
        'no configuration head was observed during the window; refusing to emit canary evidence with an invented continuity digest',
      ],
    }
  }

  const built = buildCanaryObservations(input, schedules, tally.records)
  const configurationHeadSha256 = releaseEvidenceSha256(configurationHead)
  const dependencies: readonly CanaryDependencyFile[] = [
    ...input.authorities,
    ...built.dependencies,
    { sha256: configurationHeadSha256, content: configurationHead },
  ]

  const evidence: CanaryWindowEvidence = {
    version: 'repkey-canary-window-1',
    evidenceKind: 'canary-window',
    candidate: input.candidate,
    runId: input.runId,
    startedAt: input.startedAt,
    completedAt: new Date(startedAtMs + input.profile.durationMs).toISOString(),
    capturedAt: input.now(),
    profile: input.profile,
    observations: built.observations,
    continuity: {
      releaseIdentityMismatches: tally.releaseIdentityMismatches,
      configurationHeadMismatches: tally.configurationHeadMismatches,
      observerReadErrors: tally.observerReadErrors,
      configurationHeadSha256,
    },
    attempts: 1,
    retries: 0,
    outcome: tally.failures.length === 0 ? 'passed' : 'failed',
    failures: [...tally.failures],
  }

  // Emit only what the Gate F parser accepts. A summary this module builds but
  // the validator would reject is a defect here, not a finding at promotion.
  const canonical = canonicalCanaryWindowEvidence(evidence)
  const parsed = parseCanaryWindowEvidence(canonical)
  if (!parsed.ok) return { ok: false, errors: parsed.errors }

  const retained = new Set(dependencies.map(({ sha256 }) => sha256))
  const unretained = canaryWindowDependencyDigests(parsed.evidence).filter(
    (digest) => !retained.has(digest),
  )
  if (unretained.length > 0) {
    return {
      ok: false,
      errors: unretained.map((digest) => `dependency ${digest} has no retained file`),
    }
  }

  return { ok: true, evidence: parsed.evidence, dependencies }
}
