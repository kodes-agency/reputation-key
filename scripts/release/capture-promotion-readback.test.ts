import { describe, expect, it } from 'vitest'
import { completeBundleCandidate } from '../../src/shared/release/gate-f-complete-evidence.test-fixtures'
import { remainingGateFTypedFixtures } from '../../src/shared/release/gate-f-live-evidence.test-fixtures'
import {
  PROMOTION_READBACK_GATES,
  PROMOTION_READBACK_GATE_F_IDS,
  parsePromotionReadbackEvidence,
  promotionReadbackFileName,
  type PromotionReadbackGate,
} from '../../src/shared/release/promotion-readback-evidence'
import {
  promotionReadbackArtifacts,
  runCapturePromotionReadbackCli,
  writePromotionReadbackArtifacts,
  type CaptureReadbackDependencies,
  type PromotionReadbackObservations,
} from './capture-promotion-readback'

const CANDIDATE = completeBundleCandidate()

/**
 * The observations are recovered from the SAME typed fixtures Gate F is tested
 * against, so the builder is exercised against real producer output rather
 * than a hand-written literal that could drift from the schema.
 */
function observations(): PromotionReadbackObservations {
  const fixtures = remainingGateFTypedFixtures(CANDIDATE)
  const body = (gate: PromotionReadbackGate): Record<string, unknown> => {
    const fixture = fixtures[PROMOTION_READBACK_GATE_F_IDS[gate]]
    if (!fixture) throw new Error(`no fixture for ${gate}`)
    const parsed = JSON.parse(fixture.content) as Record<string, unknown>
    for (const key of [
      'version',
      'evidenceKind',
      'gate',
      'candidate',
      'capturedAt',
      'observedBy',
      'readbackMode',
      'outcome',
      'failures',
    ]) {
      delete parsed[key]
    }
    return { ...parsed, failures: [] }
  }
  return {
    candidate: CANDIDATE,
    capturedAt: '2026-08-28T09:10:00.000Z',
    observedBy: 'release:beta',
    readbackMode: 'verify_only',
    railwayNoDrift: body(
      'railway_no_drift',
    ) as PromotionReadbackObservations['railwayNoDrift'],
    releaseIdentityHealthControls: body(
      'release_identity_health_controls',
    ) as PromotionReadbackObservations['releaseIdentityHealthControls'],
    migrationIntegrity: body(
      'migration_integrity',
    ) as PromotionReadbackObservations['migrationIntegrity'],
    dormantCellDenial: body(
      'dormant_cell_denial',
    ) as PromotionReadbackObservations['dormantCellDenial'],
  }
}

type Harness = Readonly<{
  deps: CaptureReadbackDependencies
  written: Map<string, string>
  errors: string[]
  logs: string[]
}>

function harness(files: Readonly<Record<string, string>>): Harness {
  const written = new Map<string, string>()
  const errors: string[] = []
  const logs: string[] = []
  return {
    written,
    errors,
    logs,
    deps: {
      readFile: (path) => {
        const content = files[path]
        if (content === undefined) throw new Error(`no file at ${path}`)
        return content
      },
      writeFileExclusive: (path, content) => {
        if (written.has(path)) throw new Error(`EEXIST ${path}`)
        written.set(path, content)
      },
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
    },
  }
}

describe('promotion read-back artifact builder', () => {
  it('emits exactly one valid artifact per read-back gate', () => {
    const artifacts = promotionReadbackArtifacts(observations())

    expect(artifacts.map(({ gate }) => gate)).toEqual([...PROMOTION_READBACK_GATES])
    for (const artifact of artifacts) {
      expect(artifact.errors).toEqual([])
      expect(artifact.outcome).toBe('passed')
      expect(artifact.fileName).toBe(promotionReadbackFileName(artifact.gate))
      expect(
        parsePromotionReadbackEvidence(artifact.content, artifact.gate),
      ).toMatchObject({ ok: true })
    }
  })

  it('still emits an artifact for a gate whose check FAILED', () => {
    // Writing nothing on failure would let an operator re-run until the
    // environment looked right and file only the passing capture.
    const base = observations()
    const artifacts = promotionReadbackArtifacts({
      ...base,
      releaseIdentityHealthControls: {
        ...base.releaseIdentityHealthControls,
        health: {
          ...base.releaseIdentityHealthControls.health,
          status: 'degraded',
          probes: {
            ...base.releaseIdentityHealthControls.health.probes,
            redis: false,
          },
        },
        failures: ['health redis=false'],
      },
    })

    expect(artifacts).toHaveLength(PROMOTION_READBACK_GATES.length)
    const identity = artifacts.find(
      ({ gate }) => gate === 'release_identity_health_controls',
    )
    expect(identity?.outcome).toBe('failed')
    expect(identity?.errors).toEqual([])
    const parsed = parsePromotionReadbackEvidence(String(identity?.content))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.evidence.outcome).toBe('failed')
      expect(parsed.evidence.failures).toEqual(['health redis=false'])
    }
  })

  it('reports an artifact the schema refuses instead of writing it silently', () => {
    const base = observations()
    const artifacts = promotionReadbackArtifacts({
      ...base,
      dormantCellDenial: {
        observations: base.dormantCellDenial.observations.slice(0, 1),
        failures: [],
      },
    })
    const dormant = artifacts.find(({ gate }) => gate === 'dormant_cell_denial')

    expect(dormant?.content).toBeTruthy()
    expect(dormant?.errors.length ?? 0).toBeGreaterThan(0)
  })

  it('writes each artifact exactly once, under its canonical name', () => {
    const artifacts = promotionReadbackArtifacts(observations())
    const written = new Map<string, string>()
    const paths = writePromotionReadbackArtifacts(
      'out/readback',
      artifacts,
      (path, content) => {
        if (written.has(path)) throw new Error(`wrote ${path} twice`)
        written.set(path, content)
      },
    )

    expect(paths).toHaveLength(4)
    expect(new Set(paths).size).toBe(4)
    expect(paths[0]).toBe('out/readback/promotion-readback-railway-no-drift.json')
  })
})

describe('release:capture-readback', () => {
  it('writes all four artifacts and exits 0 for a clean read-back', () => {
    const { deps, written, logs } = harness({
      'observations.json': JSON.stringify(observations()),
    })

    expect(
      runCapturePromotionReadbackCli(
        ['--input=observations.json', '--output-dir=out'],
        deps,
      ),
    ).toBe(0)
    expect(written.size).toBe(4)
    expect(logs).toHaveLength(4)
  })

  it('writes all four artifacts and exits 1 when a check failed', () => {
    const base = observations()
    const { deps, written, errors } = harness({
      'observations.json': JSON.stringify({
        ...base,
        railwayNoDrift: {
          ...base.railwayNoDrift,
          failures: ['Railway plan evidence reports pending-changes'],
        },
      }),
    })

    expect(
      runCapturePromotionReadbackCli(
        ['--input=observations.json', '--output-dir=out'],
        deps,
      ),
    ).toBe(1)
    expect(written.size).toBe(4)
    expect(errors.join('\n')).toContain('railway_no_drift: read-back FAILED')
  })

  it('refuses an incomplete invocation and an unreadable input', () => {
    const { deps, errors } = harness({})

    expect(runCapturePromotionReadbackCli(['--input=observations.json'], deps)).toBe(2)
    expect(
      runCapturePromotionReadbackCli(['--input=missing.json', '--output-dir=out'], deps),
    ).toBe(1)
    expect(errors.join('\n')).toContain('could not read missing.json')
  })
})
