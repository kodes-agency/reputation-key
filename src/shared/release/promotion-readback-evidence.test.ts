import { describe, expect, it } from 'vitest'
import { canonicalReleaseEvidence } from './candidate-bound-evidence'
import { completeBundleCandidate } from './gate-f-complete-evidence.test-fixtures'
import { remainingGateFTypedFixtures } from './gate-f-live-evidence.test-fixtures'
import {
  DORMANT_DATA_CELL_IDS,
  PROMOTION_READBACK_EVIDENCE_VERSION,
  PROMOTION_READBACK_GATES,
  PROMOTION_READBACK_GATE_F_IDS,
  PROMOTION_READBACK_SERVICES,
  parsePromotionReadbackEvidence,
  promotionReadbackFileName,
} from './promotion-readback-evidence'

const CANDIDATE = completeBundleCandidate()

function readback(gate: (typeof PROMOTION_READBACK_GATES)[number]): string {
  const fixtures = remainingGateFTypedFixtures(CANDIDATE)
  const fixture = fixtures[PROMOTION_READBACK_GATE_F_IDS[gate]]
  if (!fixture) throw new Error(`no read-back fixture for ${gate}`)
  return fixture.content
}

function mutate(content: string, change: (draft: Record<string, unknown>) => void) {
  const draft = JSON.parse(content) as Record<string, unknown>
  change(draft)
  return canonicalReleaseEvidence(draft)
}

describe('promotion read-back evidence', () => {
  it('discriminates the four promotion read-back gates and binds the candidate', () => {
    for (const gate of PROMOTION_READBACK_GATES) {
      const parsed = parsePromotionReadbackEvidence(readback(gate), gate)

      expect(parsed.ok).toBe(true)
      if (parsed.ok) {
        expect(parsed.evidence.version).toBe(PROMOTION_READBACK_EVIDENCE_VERSION)
        expect(parsed.evidence.gate).toBe(gate)
        expect(parsed.evidence.candidate).toEqual(CANDIDATE)
      }
    }
  })

  it('refuses a read-back artifact filed under another gate', () => {
    const parsed = parsePromotionReadbackEvidence(
      readback('migration_integrity'),
      'railway_no_drift',
    )

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('expected railway_no_drift read-back')
    }
  })

  it('gives each gate a distinct canonical artifact name', () => {
    const names = PROMOTION_READBACK_GATES.map(promotionReadbackFileName)

    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('promotion-readback-railway-no-drift.json')
  })
})

describe('release identity, health and control-head read-back', () => {
  it('requires one row per promoted Railway service', () => {
    const short = mutate(readback('release_identity_health_controls'), (draft) => {
      draft.services = (draft.services as unknown[]).slice(1)
    })

    expect(parsePromotionReadbackEvidence(short)).toMatchObject({ ok: false })
    expect(PROMOTION_READBACK_SERVICES.length).toBeGreaterThan(1)
  })

  it('requires every service to carry the candidate release identity', () => {
    const drifted = mutate(readback('release_identity_health_controls'), (draft) => {
      const services = draft.services as Record<string, unknown>[]
      const first = services[0]
      if (first) first.releaseSha = 'b'.repeat(40)
    })
    const parsed = parsePromotionReadbackEvidence(drifted)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain(
        'RELEASE_SHA does not match the candidate',
      )
    }
  })

  it('refuses a legacy SOURCE_REVISION or IMAGE_SOURCE_REVISION override', () => {
    // The override is refused STRUCTURALLY: the schema only admits the empty
    // string, so "we set it back afterwards" is not representable.
    for (const field of ['sourceRevisionOverride', 'imageSourceRevisionOverride']) {
      const overridden = mutate(readback('release_identity_health_controls'), (draft) => {
        const services = draft.services as Record<string, unknown>[]
        const first = services[0]
        if (first) first[field] = 'c'.repeat(40)
      })

      expect(parsePromotionReadbackEvidence(overridden)).toMatchObject({ ok: false })
    }
  })

  it('requires all four health probes to be true', () => {
    for (const probe of ['db', 'redis', 'migrations', 'policy']) {
      const degraded = mutate(readback('release_identity_health_controls'), (draft) => {
        const health = draft.health as Record<string, Record<string, unknown>>
        health.probes[probe] = false
      })

      expect(parsePromotionReadbackEvidence(degraded)).toMatchObject({ ok: false })
    }
  })

  it('requires every ai_execution_control_heads row to be enabled and accepting', () => {
    const paused = mutate(readback('release_identity_health_controls'), (draft) => {
      const heads = draft.aiControlHeads as Record<string, unknown>[]
      const head = heads[0]
      if (head) head.admissionState = 'refusing'
    })
    const parsed = parsePromotionReadbackEvidence(paused)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('want enabled/accepting')
    }
  })
})

describe('dormant Data Cell denial read-back', () => {
  it('requires an explicit refusal for every non-us catalogue id', () => {
    expect(DORMANT_DATA_CELL_IDS.length).toBeGreaterThan(0)
    const missing = mutate(readback('dormant_cell_denial'), (draft) => {
      draft.observations = (draft.observations as unknown[]).slice(1)
    })
    const parsed = parsePromotionReadbackEvidence(missing)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain(
        'missing dormant cell refusal observation',
      )
    }
  })

  it('fails when a dormant cell resolved', () => {
    const resolved = mutate(readback('dormant_cell_denial'), (draft) => {
      const observations = draft.observations as Record<string, unknown>[]
      const first = observations[0]
      if (first) first.resolved = true
    })

    expect(parsePromotionReadbackEvidence(resolved)).toMatchObject({ ok: false })
  })
})

describe('Railway no-drift read-back', () => {
  it('binds the repkey-railway-plan-5 evidence digest', () => {
    const parsed = parsePromotionReadbackEvidence(readback('railway_no_drift'))

    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.evidence.gate === 'railway_no_drift') {
      expect(parsed.evidence.planEvidence.version).toBe('repkey-railway-plan-5')
      expect(parsed.evidence.planEvidence.sha256).toMatch(/^[0-9a-f]{64}$/u)
    }
  })

  it('fails when the plan evidence reports pending-changes', () => {
    const pending = mutate(readback('railway_no_drift'), (draft) => {
      const plan = draft.planEvidence as Record<string, unknown>
      plan.outcome = 'pending-changes'
    })
    const parsed = parsePromotionReadbackEvidence(pending)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('pending-changes')
    }
  })
})

describe('migration integrity read-back', () => {
  it('binds the drizzle head tag and the schema-migrator deployment identity', () => {
    const parsed = parsePromotionReadbackEvidence(readback('migration_integrity'))

    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.evidence.gate === 'migration_integrity') {
      expect(parsed.evidence.drizzle.journalPath).toBe('drizzle/meta/_journal.json')
      expect(parsed.evidence.drizzle.headTag).toMatch(/^[0-9]{4}_/u)
      expect(parsed.evidence.schemaMigrator.deploymentId).toMatch(/^[0-9a-f-]{36}$/u)
      expect(parsed.evidence.schemaMigrator.imageDigest).toMatch(/^sha256:[0-9a-f]{64}$/u)
    }
  })

  it('fails when the deployed migrator head differs from the candidate journal head', () => {
    const skewed = mutate(readback('migration_integrity'), (draft) => {
      const migrator = draft.schemaMigrator as Record<string, unknown>
      migrator.appliedHeadTag = '0001_initial'
    })
    const parsed = parsePromotionReadbackEvidence(skewed)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain(
        'does not match the candidate journal head',
      )
    }
  })

  it('refuses a read-back that observed a destructive statement', () => {
    // Migrations are expand-only. A read-back that saw a drop is reporting a
    // policy violation, not passing a gate.
    const destructive = mutate(readback('migration_integrity'), (draft) => {
      draft.destructiveStatementCount = 1
    })

    expect(parsePromotionReadbackEvidence(destructive)).toMatchObject({ ok: false })
  })
})

describe('read-back outcome honesty', () => {
  it('cannot claim passed while carrying failures', () => {
    const dishonest = mutate(readback('railway_no_drift'), (draft) => {
      draft.failures = ['graph drifted']
    })

    expect(parsePromotionReadbackEvidence(dishonest)).toMatchObject({ ok: false })
  })

  it('cannot claim failed with no failure named', () => {
    const empty = mutate(readback('railway_no_drift'), (draft) => {
      draft.outcome = 'failed'
    })

    expect(parsePromotionReadbackEvidence(empty)).toMatchObject({ ok: false })
  })
})
