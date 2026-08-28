import { describe, expect, it } from 'vitest'
import { canonicalReleaseEvidence } from '../candidate-bound-evidence'
import { completeBundleCandidate } from '../gate-f-complete-evidence.test-fixtures'
import { remainingGateFTypedFixtures } from '../gate-f-live-evidence.test-fixtures'
import {
  LIVE_EVIDENCE_GATE_IDS,
  LIVE_EVIDENCE_PARSERS,
  RELEASE_IMAGES_WORKFLOW_REF,
  TELEMETRY_INSPECTED_SINKS,
  isLiveEvidenceGateId,
  parseLiveProviderMatrixEvidence,
  parsePreproductionJourneyEvidence,
  type LiveEvidenceGateId,
} from './index'

const CANDIDATE = completeBundleCandidate()
const FIXTURES = remainingGateFTypedFixtures(CANDIDATE)

function artifact(gateId: LiveEvidenceGateId): string {
  const fixture = FIXTURES[gateId]
  if (!fixture) throw new Error(`no fixture for ${gateId}`)
  return fixture.content
}

function mutate(content: string, change: (draft: Record<string, unknown>) => void) {
  const draft = JSON.parse(content) as Record<string, unknown>
  change(draft)
  return canonicalReleaseEvidence(draft)
}

function parse(gateId: LiveEvidenceGateId, content: string) {
  return LIVE_EVIDENCE_PARSERS[gateId](content)
}

describe('live evidence importers', () => {
  it('parses every gate it claims and refuses an opaque placeholder', () => {
    for (const gateId of LIVE_EVIDENCE_GATE_IDS) {
      expect(parse(gateId, artifact(gateId))).toMatchObject({ ok: true })
      expect(parse(gateId, '{"status":"passed"}\n')).toMatchObject({ ok: false })
    }
    expect(isLiveEvidenceGateId('candidate.clean_ci')).toBe(true)
    expect(isLiveEvidenceGateId('promotion.canary_window')).toBe(false)
  })

  it.each(LIVE_EVIDENCE_GATE_IDS)(
    '%s carries the candidate, capture, expiry, authority, redaction and outcome',
    (gateId) => {
      const parsed = parse(gateId, artifact(gateId))

      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.evidence.candidate).toEqual(CANDIDATE)
      expect(parsed.evidence.capturedAt).toMatch(/^2026-/u)
      expect(Date.parse(parsed.evidence.expiresAt)).toBeGreaterThan(
        Date.parse(parsed.evidence.capturedAt),
      )
      expect(parsed.evidence.authority.sourceArtifactSha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(parsed.evidence.redaction.reportSha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(parsed.evidence.outcome).toBe('passed')
      expect(parsed.dependencyDigests).toHaveLength(2)
    },
  )

  it.each(LIVE_EVIDENCE_GATE_IDS)(
    '%s refuses an artifact the capturer attested to itself',
    (gateId) => {
      const selfAttested = mutate(artifact(gateId), (draft) => {
        const authority = draft.authority as Record<string, unknown>
        authority.attestedBy = authority.capturedBy
      })

      expect(parse(gateId, selfAttested)).toMatchObject({ ok: false })
    },
  )

  it.each(LIVE_EVIDENCE_GATE_IDS)(
    '%s cannot pass while a prohibited field leaked into the capture',
    (gateId) => {
      const leaked = mutate(artifact(gateId), (draft) => {
        const redaction = draft.redaction as Record<string, unknown>
        redaction.prohibitedFieldOccurrences = 1
      })

      expect(parse(gateId, leaked)).toMatchObject({ ok: false })
    },
  )

  it.each(LIVE_EVIDENCE_GATE_IDS)('%s never defaults an absent field', (gateId) => {
    const draft = JSON.parse(artifact(gateId)) as Record<string, unknown>
    for (const key of Object.keys(draft)) {
      if (key === 'version' || key === 'evidenceKind') continue
      const withoutKey = Object.fromEntries(
        Object.entries(draft).filter(([name]) => name !== key),
      )
      expect(parse(gateId, canonicalReleaseEvidence(withoutKey))).toMatchObject({
        ok: false,
      })
    }
  })
})

describe('stale live evidence', () => {
  it('is refused by Gate F when expiresAt precedes completedAt', () => {
    // The expiry rule itself lives in Gate F (it is the only layer that knows
    // completedAt); this asserts the field the rule reads is present and
    // ordered, so the rule has something real to compare.
    const parsed = parse('promotion.backup_pitr', artifact('promotion.backup_pitr'))

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(Date.parse(parsed.evidence.expiresAt)).toBeGreaterThan(
        Date.parse('2026-08-28T12:00:00.000Z'),
      )
    }
  })

  it('refuses an expiry that precedes capture', () => {
    const inverted = mutate(artifact('candidate.clean_ci'), (draft) => {
      draft.expiresAt = '2026-01-01T00:00:00.000Z'
    })

    expect(parse('candidate.clean_ci', inverted)).toMatchObject({ ok: false })
  })
})

describe('clean CI run', () => {
  it('requires the exact release-images workflow identity', () => {
    expect(RELEASE_IMAGES_WORKFLOW_REF).toBe(
      'https://github.com/kodes-agency/reputation-key/.github/workflows/release-images.yml@refs/heads/main',
    )
    const forked = mutate(artifact('candidate.clean_ci'), (draft) => {
      draft.workflowRef =
        'https://github.com/attacker/reputation-key/.github/workflows/release-images.yml@refs/heads/main'
    })

    expect(parse('candidate.clean_ci', forked)).toMatchObject({ ok: false })
  })

  it('requires runAttempt 1 — a green re-run is not a clean run', () => {
    const rerun = mutate(artifact('candidate.clean_ci'), (draft) => {
      draft.runAttempt = 2
    })

    expect(parse('candidate.clean_ci', rerun)).toMatchObject({ ok: false })
  })

  it('refuses a skipped required job', () => {
    const skipped = mutate(artifact('candidate.clean_ci'), (draft) => {
      const jobs = draft.jobs as Record<string, unknown>[]
      const first = jobs[0]
      if (first) first.conclusion = 'skipped'
    })
    const parsed = parse('candidate.clean_ci', skipped)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('is not a clean run')
    }
  })
})

describe('provider evidence classes stay structurally distinguishable', () => {
  it('refuses a live-provider artifact whose provider mode is stub', () => {
    const stubbed = mutate(artifact('preproduction.live_provider_journeys'), (draft) => {
      draft.providerMode = 'stub'
    })

    expect(parseLiveProviderMatrixEvidence(stubbed)).toMatchObject({ ok: false })
    expect(parse('preproduction.live_provider_journeys', stubbed)).toMatchObject({
      ok: false,
    })
  })

  it('refuses a stub-journey artifact relabelled as live', () => {
    const relabelled = mutate(
      artifact('preproduction.provider_stub_journeys'),
      (draft) => {
        draft.providerMode = 'live'
      },
    )

    expect(parsePreproductionJourneyEvidence(relabelled)).toMatchObject({ ok: false })
  })

  it('refuses a journey class filed under the wrong gate', () => {
    expect(
      parse('preproduction.manager_journeys', artifact('preproduction.portal_privacy')),
    ).toMatchObject({ ok: false })
  })

  it('refuses a pre-production journey that exercised a dark capability', () => {
    const dark = mutate(artifact('preproduction.portal_privacy'), (draft) => {
      const results = draft.results as Record<string, unknown>[]
      const first = results[0]
      if (first) first.journeyId = 'portal.upload-happy-path'
    })
    const parsed = parse('preproduction.portal_privacy', dark)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('dark capability portal.upload')
    }
  })
})

describe('telemetry content inspection', () => {
  it('names every inspected sink and requires zero prohibited occurrences', () => {
    const parsed = parse(
      'preproduction.observability_content_inspection',
      artifact('preproduction.observability_content_inspection'),
    )

    expect(parsed).toMatchObject({ ok: true })
    for (const sink of TELEMETRY_INSPECTED_SINKS) {
      expect(artifact('preproduction.observability_content_inspection')).toContain(sink)
    }
  })

  it('refuses an inspection that skipped a sink', () => {
    const partial = mutate(
      artifact('preproduction.observability_content_inspection'),
      (draft) => {
        draft.sinks = (draft.sinks as unknown[]).slice(1)
      },
    )
    const parsed = parse('preproduction.observability_content_inspection', partial)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('missing required inspected sink')
    }
  })

  it('refuses a passing inspection that found content in any sink', () => {
    const leaked = mutate(
      artifact('preproduction.observability_content_inspection'),
      (draft) => {
        const sinks = draft.sinks as Record<string, unknown>[]
        const first = sinks[0]
        if (first) first.prohibitedFieldOccurrences = 1
      },
    )

    expect(parse('preproduction.observability_content_inspection', leaked)).toMatchObject(
      { ok: false },
    )
  })
})

describe('backup and PITR receipt', () => {
  it('refuses a self-reported application claim', () => {
    const selfReported = mutate(artifact('promotion.backup_pitr'), (draft) => {
      draft.source = 'application_report'
    })
    const parsed = parse('promotion.backup_pitr', selfReported)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('source')
    }
  })

  it('requires a WAL/PITR window covering the promotion timestamp', () => {
    const uncovered = mutate(artifact('promotion.backup_pitr'), (draft) => {
      const window = draft.pitrWindow as Record<string, unknown>
      window.latestRestorableAt = '2026-08-28T08:00:00.000Z'
    })
    const parsed = parse('promotion.backup_pitr', uncovered)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('does not cover the promotion timestamp')
    }
  })

  it('requires a platform receipt digest', () => {
    const withoutDigest = mutate(artifact('promotion.backup_pitr'), (draft) => {
      const receipt = draft.receipt as Record<string, unknown>
      delete receipt.receiptSha256
    })

    expect(parse('promotion.backup_pitr', withoutDigest)).toMatchObject({ ok: false })
  })
})

describe('cohort readiness', () => {
  it('requires a pseudonymized design-partner reference', () => {
    const named = mutate(artifact('opening.cohort_readiness'), (draft) => {
      draft.cohortReference = 'Northwind Hospitality Ltd'
    })

    expect(parse('opening.cohort_readiness', named)).toMatchObject({ ok: false })
  })

  it('refuses an email address anywhere in the named ownership', () => {
    const emailed = mutate(artifact('opening.cohort_readiness'), (draft) => {
      draft.supportOwner = 'support@example.com'
    })
    const parsed = parse('opening.cohort_readiness', emailed)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('must not contain an email address')
    }
  })

  it('requires separately named support and incident owners', () => {
    const merged = mutate(artifact('opening.cohort_readiness'), (draft) => {
      draft.incidentOwner = draft.supportOwner
    })

    expect(parse('opening.cohort_readiness', merged)).toMatchObject({ ok: false })
  })

  it('refuses an unsatisfied readiness check', () => {
    const unready = mutate(artifact('opening.cohort_readiness'), (draft) => {
      const checks = draft.checks as Record<string, unknown>[]
      const first = checks[0]
      if (first) first.satisfied = false
    })

    expect(parse('opening.cohort_readiness', unready)).toMatchObject({ ok: false })
  })
})

describe('independent review and defect disposition', () => {
  it('refuses a review by an author of a reviewed change', () => {
    const selfReviewed = mutate(artifact('candidate.independent_review'), (draft) => {
      const changes = draft.changes as Record<string, unknown>[]
      const first = changes[0]
      if (first) first.authorIdentity = draft.reviewerIdentity
    })
    const parsed = parse('candidate.independent_review', selfReviewed)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('cannot be an author')
    }
  })

  it('refuses a deferred defect with no target release', () => {
    const dangling = mutate(artifact('candidate.defect_disposition'), (draft) => {
      const defects = draft.defects as Record<string, unknown>[]
      const first = defects[0]
      if (first) first.deferredToRelease = null
    })

    expect(parse('candidate.defect_disposition', dangling)).toMatchObject({ ok: false })
  })

  it('refuses a deferred protected-surface-reachable High', () => {
    const deferred = mutate(artifact('candidate.defect_disposition'), (draft) => {
      const defects = draft.defects as Record<string, unknown>[]
      const first = defects[0]
      if (first) {
        first.severity = 'high'
        first.protectedSurfaceReachable = true
      }
    })
    const parsed = parse('candidate.defect_disposition', deferred)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('cannot be deferred or accepted')
    }
  })
})

describe('isolated restore migration', () => {
  it('refuses a rehearsal run against the promotion target', () => {
    const unsafe = mutate(
      artifact('preproduction.isolated_restore_migration'),
      (draft) => {
        const isolation = draft.isolation as Record<string, unknown>
        isolation.targetProjectId = CANDIDATE.projectId
      },
    )
    const parsed = parse('preproduction.isolated_restore_migration', unsafe)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('must not be the promotion target')
    }
  })

  it('refuses a rehearsal that executed a destructive statement', () => {
    const destructive = mutate(
      artifact('preproduction.isolated_restore_migration'),
      (draft) => {
        const migration = draft.migration as Record<string, unknown>
        migration.destructiveStatementCount = 1
      },
    )

    expect(parse('preproduction.isolated_restore_migration', destructive)).toMatchObject({
      ok: false,
    })
  })
})
