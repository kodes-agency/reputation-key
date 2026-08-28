import { describe, expect, it } from 'vitest'
import {
  GATE_F_REQUIRED_APPROVAL_ROLES,
  GATE_F_REQUIRED_GATE_IDS,
  canonicalGateFEvidence,
  gateFDecisionSha256,
  gateFEvidenceSha256,
  parseGateFEvidence,
  validateGateFEvidenceBundle,
  type GateFEvidence,
} from './gate-f-evidence'
import {
  completeBundleCandidate,
  completeGateFBundle,
  completeGateFBundleReader,
  rehearsalCanaryArtifact,
  type CompleteGateFBundleOverrides,
} from './gate-f-complete-evidence.test-fixtures'
import { canonicalReleaseEvidence } from './candidate-bound-evidence'
import {
  legalRevisionSetContextFixture,
  legalRevisionSetFixture,
  legalRevisionSetFixtureContent,
} from './legal-revision-set-evidence.test-fixtures'
import { canonicalLegalRevisionSetEvidence } from './legal-revision-set-evidence'

const digest = (value: string): string => value.repeat(64).slice(0, 64)

/**
 * LEG-01: the legal revision set is validated against the legal document
 * registry, and every counsel row in the SHIPPED registry is a draft. The
 * happy-path fixture therefore has to run against a registry in which counsel
 * has signed; the last test in this file asserts the shipped default fails.
 */
const LEGAL_CONTEXT = legalRevisionSetContextFixture()

const fixtureCandidate = completeBundleCandidate

type GateFFixture = Readonly<{
  evidence: GateFEvidence
  content: string
  files: Map<string, Uint8Array>
  options: NonNullable<Parameters<typeof validateGateFEvidenceBundle>[2]>
  decisionSha256: string
}>

/**
 * REL-01-T11: the fixture is now the COMPLETE eighteen-gate bundle, produced
 * by the real producer functions and signed with ephemeral Ed25519 role keys.
 * The previous version filled fifteen gates with `"<id> passed"`, which is the
 * exact fail-open this wave closes.
 */
function gateFFixture(
  legalRevisionSetContent?: string,
  overrides: CompleteGateFBundleOverrides = {},
): GateFFixture {
  const bundle = completeGateFBundle({
    ...overrides,
    ...(legalRevisionSetContent === undefined ? {} : { legalRevisionSetContent }),
  })
  return {
    evidence: bundle.evidence,
    content: bundle.content,
    files: new Map(bundle.files),
    options: bundle.options,
    decisionSha256: bundle.decisionSha256,
  }
}

function readFixture(fixture: GateFFixture): (path: string) => Uint8Array {
  return completeGateFBundleReader(fixture.files)
}

function validateContent(content: string, fixture: GateFFixture) {
  return validateGateFEvidenceBundle(content, readFixture(fixture), fixture.options)
}

function validateFixture(fixture: GateFFixture) {
  return validateContent(fixture.content, fixture)
}

describe('Gate F release evidence', () => {
  it('accepts only a complete, canonical and byte-bound single-US evidence join', () => {
    const fixture = gateFFixture()

    expect(parseGateFEvidence(fixture.content)).toMatchObject({
      ok: true,
      digest: gateFEvidenceSha256(fixture.content),
    })
    expect(validateFixture(fixture)).toMatchObject({
      ok: true,
      digest: gateFEvidenceSha256(fixture.content),
    })
    expect(fixture.evidence.gates.map(({ id }) => id)).toEqual(GATE_F_REQUIRED_GATE_IDS)
    expect(fixture.evidence.approvals.map(({ role }) => role)).toEqual(
      GATE_F_REQUIRED_APPROVAL_ROLES,
    )
  })

  it('rejects a referenced artifact changed after the completion index was written', () => {
    const fixture = gateFFixture()
    const firstGatePath = fixture.evidence.gates[0].evidence[0]?.path
    expect(firstGatePath).toBeDefined()
    fixture.files.set(String(firstGatePath), Buffer.from('changed after approval\n'))

    const result = validateFixture(fixture)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toContain('evidence digest mismatch')
  })

  it('rejects a missing required gate even when every retained reference is valid', () => {
    const fixture = gateFFixture()
    const incomplete = {
      ...fixture.evidence,
      gates: fixture.evidence.gates.slice(1),
    } as GateFEvidence
    const result = parseGateFEvidence(canonicalGateFEvidence(incomplete))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        `missing required Gate F gate ${GATE_F_REQUIRED_GATE_IDS[0]}`,
      )
    }
  })

  it('rejects approvals that do not bind the final manifest and legal revision set', () => {
    const fixture = gateFFixture()
    const approvals = fixture.evidence.approvals.map((approval) =>
      approval.role === 'counsel'
        ? {
            ...approval,
            releaseManifestSha256: digest('e'),
            legalRevisionSetSha256: digest('f'),
          }
        : approval,
    ) as GateFEvidence['approvals']
    const invalid = { ...fixture.evidence, approvals }
    const result = parseGateFEvidence(canonicalGateFEvidence(invalid))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'approval must bind the release manifest digest',
      )
      expect(result.errors.join('\n')).toContain(
        'counsel and founder must bind the legal revision-set digest',
      )
    }
  })

  it('rejects completion recorded before approval evidence was captured', () => {
    const fixture = gateFFixture()
    const invalid = {
      ...fixture.evidence,
      completedAt: '2026-08-28T11:00:30.000Z',
    }
    const result = parseGateFEvidence(canonicalGateFEvidence(invalid))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'completion predates evidence or approval',
      )
    }
  })

  it('rejects an approval captured before the final decision evidence', () => {
    const fixture = gateFFixture()
    const approvals = fixture.evidence.approvals.map((approval) =>
      approval.role === 'operations'
        ? { ...approval, approvedAt: '2026-08-28T09:59:59.000Z' }
        : approval,
    ) as GateFEvidence['approvals']
    const result = parseGateFEvidence(
      canonicalGateFEvidence({ ...fixture.evidence, approvals }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'approval predates final release evidence',
      )
    }
  })

  it('rejects a promotion manifest from a different release candidate', () => {
    const fixture = gateFFixture()
    const invalid = {
      ...fixture.evidence,
      release: { ...fixture.evidence.release, releaseSha: 'b'.repeat(40) },
    }
    const result = validateContent(canonicalGateFEvidence(invalid), fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain(
        'release.manifest: release SHA does not match Gate F index',
      )
    }
  })

  it('rejects a generic placeholder for a typed live promotion gate', () => {
    const fixture = gateFFixture()
    const gate = fixture.evidence.gates.find(({ id }) => id === 'promotion.canary_window')
    const reference = gate?.evidence[0]
    expect(reference).toBeDefined()
    const payload = Buffer.from('{"passed":true}\n')
    fixture.files.set(String(reference?.path), payload)
    const gates = fixture.evidence.gates.map((entry) =>
      entry.id === 'promotion.canary_window'
        ? {
            ...entry,
            evidence: [
              {
                ...entry.evidence[0],
                sha256: gateFEvidenceSha256(payload),
              },
            ],
          }
        : entry,
    ) as GateFEvidence['gates']
    const result = validateContent(
      canonicalGateFEvidence({ ...fixture.evidence, gates }),
      fixture,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'gates.promotion.canary_window.evidence.0',
      )
    }
  })

  it('rejects typed promotion evidence bound to another candidate', () => {
    const fixture = gateFFixture()
    const gate = fixture.evidence.gates.find(
      ({ id }) => id === 'promotion.deployed_critical_journeys',
    )
    const reference = gate?.evidence[0]
    const original = fixture.files.get(String(reference?.path))
    expect(original).toBeDefined()
    const decoded = JSON.parse(Buffer.from(original ?? []).toString('utf8')) as {
      candidate: { releaseSha: string }
    }
    decoded.candidate.releaseSha = 'b'.repeat(40)
    const changed = Buffer.from(canonicalReleaseEvidence(decoded))
    fixture.files.set(String(reference?.path), changed)
    const gates = fixture.evidence.gates.map((entry) =>
      entry.id === 'promotion.deployed_critical_journeys'
        ? {
            ...entry,
            evidence: [
              {
                ...entry.evidence[0],
                sha256: gateFEvidenceSha256(changed),
              },
            ],
          }
        : entry,
    ) as GateFEvidence['gates']
    const result = validateContent(
      canonicalGateFEvidence({ ...fixture.evidence, gates }),
      fixture,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'candidate.releaseSha: does not match the Gate F release target',
      )
    }
  })

  it('rejects an unretained dependency named by typed promotion evidence', () => {
    const fixture = gateFFixture()
    const gates = fixture.evidence.gates.map((entry) =>
      entry.id === 'promotion.restore_rollback'
        ? { ...entry, evidence: entry.evidence.slice(0, -1) }
        : entry,
    ) as GateFEvidence['gates']
    const result = validateContent(
      canonicalGateFEvidence({ ...fixture.evidence, gates }),
      fixture,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('is not retained by this gate')
    }
  })
})

describe('Gate F legal revision set', () => {
  // LEG-01 closes the fail-open: until now `release.legalRevisionSet` accepted
  // any bytes at all, so "no external beta before counsel approval" could be
  // satisfied by a file containing two dates.
  const errorsOf = (result: ReturnType<typeof validateFixture>): string => {
    expect(result.ok).toBe(false)
    return result.ok ? '' : result.errors.join('\n')
  }

  it('rejects a revision set that lists a draft document', () => {
    const candidate = fixtureCandidate()
    const base = legalRevisionSetFixture(candidate, LEGAL_CONTEXT)
    const drafted = canonicalLegalRevisionSetEvidence({
      ...base,
      documents: base.documents.map((document) =>
        document.id === 'privacy-notice'
          ? { ...document, status: 'draft' as const }
          : document,
      ),
    })

    expect(errorsOf(validateFixture(gateFFixture(drafted)))).toContain(
      'release.legalRevisionSet: document privacy-notice is a draft and cannot appear in a release legal revision set',
    )
  })

  it('rejects a revision set captured for a different release candidate', () => {
    const other = fixtureCandidate({ releaseSha: 'b'.repeat(40) })
    const foreign = legalRevisionSetFixtureContent(other, LEGAL_CONTEXT)

    expect(errorsOf(validateFixture(gateFFixture(foreign)))).toContain(
      'release.legalRevisionSet: candidate.releaseSha: does not match the Gate F release target',
    )
  })

  it('rejects revision-set bytes that are not canonical JSON', () => {
    const candidate = fixtureCandidate()
    const canonical = legalRevisionSetFixtureContent(candidate, LEGAL_CONTEXT)
    const reindented = `${JSON.stringify(JSON.parse(canonical), null, 2)}\n`

    expect(errorsOf(validateFixture(gateFFixture(reindented)))).toContain(
      'release.legalRevisionSet: Legal revision set must use canonical JSON encoding',
    )
  })

  it('still requires counsel and founder to bind the revision-set digest', () => {
    // Both layers hold: the typed artifact AND the approval binding. Neither
    // one alone would stop an approval signed over a different document set.
    const fixture = gateFFixture()
    const approvals = fixture.evidence.approvals.map((approval) =>
      approval.role === 'founder'
        ? { ...approval, legalRevisionSetSha256: digest('f') }
        : approval,
    ) as GateFEvidence['approvals']
    const result = parseGateFEvidence(
      canonicalGateFEvidence({ ...fixture.evidence, approvals }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'counsel and founder must bind the legal revision-set digest',
      )
    }
  })

  it('leaves references outside the typed labels untouched', () => {
    // The typed branch is scoped: the signature bundle is opaque bytes with no
    // producer, and it still validates. Note the bundle must be REBUILT rather
    // than mutated — every approval signs the Gate F decision digest, so any
    // edit to a decision field invalidates all six signatures by design.
    const fixture = gateFFixture()
    const signatureBundlePath = fixture.evidence.release.signatureBundle.path
    const bytes = fixture.files.get(signatureBundlePath)

    expect(bytes).toBeDefined()
    expect(Buffer.from(bytes ?? []).toString('utf8')).not.toContain('"candidate"')
    expect(validateFixture(fixture).ok).toBe(true)
  })

  it('fails against the shipped registry, where counsel has approved nothing', () => {
    // The default context is the real `docs/legal/legal-document-registry.json`.
    // This is the executable form of the launch blocker: today no Gate F
    // bundle can validate, whatever bytes are placed at this reference.
    const fixture = gateFFixture()
    const result = validateGateFEvidenceBundle(fixture.content, readFixture(fixture))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('release.legalRevisionSet:')
    }
  })
})

describe('Gate F typed producers cover every required key (REL-01-T6)', () => {
  // Before this, three of eighteen keys had a producer. The other fifteen
  // accepted any bytes whose digest matched the index, which made "a
  // successful deploy without this complete evidence join cannot substitute
  // for Gate F" unenforceable for 83% of the join.
  const PLACEHOLDER = '{"status":"passed"}\n'

  it.each(GATE_F_REQUIRED_GATE_IDS)('rejects an opaque placeholder for %s', (gateId) => {
    const fixture = gateFFixture(undefined, {
      gateArtifacts: { [gateId]: PLACEHOLDER },
    })
    const result = validateFixture(fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(`gates.${gateId}.evidence.0`)
    }
  })

  it('accepts the complete bundle every one of those controls is measured against', () => {
    expect(validateFixture(gateFFixture())).toMatchObject({ ok: true })
  })

  it('refuses canary evidence produced against the rehearsal project', () => {
    // Rehearsal and production deliberately cannot share a Railway project.
    // Relabelling rehearsal evidence as production evidence is the single
    // cheapest way to fake a promotion, so it must fail structurally.
    const base = gateFFixture()
    const fixture = gateFFixture(undefined, {
      gateArtifacts: {
        'promotion.canary_window': rehearsalCanaryArtifact(base.files),
      },
    })
    const result = validateFixture(fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('gates.promotion.canary_window')
    }
  })
})

describe('Gate F approval envelope (REL-01-T7)', () => {
  it('fails closed when no signature verifier is supplied', () => {
    const fixture = gateFFixture()
    const result = validateGateFEvidenceBundle(
      fixture.content,
      readFixture(fixture),
      // Deliberately keeps the legal context so the ONLY missing input is the
      // verifier: no verifier must mean closed, not skipped.
      { legalRevisionSet: LEGAL_CONTEXT, legalDocuments: fixture.options.legalDocuments },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'no approval signature verifier was supplied',
      )
    }
  })

  it.each(GATE_F_REQUIRED_APPROVAL_ROLES)('rejects an unsigned %s approval', (role) => {
    const fixture = gateFFixture(undefined, { unsignedRoles: [role] })
    const result = validateFixture(fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        `approvals.${role}.evidence: signature_invalid`,
      )
    }
  })

  it.each(GATE_F_REQUIRED_APPROVAL_ROLES)(
    'rejects a %s approval signed by a key enrolled for nobody',
    (role) => {
      const fixture = gateFFixture(undefined, { strangerSignedRoles: [role] })
      const result = validateFixture(fixture)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.join('\n')).toContain(
          `approvals.${role}.evidence: unknown_key`,
        )
      }
    },
  )

  it('rejects a counsel signature that covers a different Gate F decision', () => {
    // The legal digest and the manifest digest both match; only the decision
    // the signature actually covers is different. Without the decision digest
    // in the signed payload this substitution would be invisible.
    const fixture = gateFFixture(undefined, {
      counselDecisionSha256: digest('9'),
    })
    const result = validateFixture(fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'approvals.counsel.evidence: signature_invalid',
      )
    }
  })

  it('binds the decision digest to the index bytes without the approvals', () => {
    const fixture = gateFFixture()

    expect(gateFDecisionSha256(fixture.evidence)).toBe(fixture.decisionSha256)
    expect(
      gateFDecisionSha256({
        ...fixture.evidence,
        approvals: fixture.evidence.approvals.slice(0, 1) as GateFEvidence['approvals'],
      }),
    ).toBe(fixture.decisionSha256)
  })
})

describe('Gate F legal approval checklist (REL-01-T8)', () => {
  it('rejects a bundle whose legal approval expired before completion', () => {
    const fixture = gateFFixture(undefined, {
      legalChecklistExpiresAt: '2026-08-28T11:59:00.000Z',
    })
    const result = validateFixture(fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('release.legalApprovalChecklist')
    }
  })

  it('rejects an undecided LEG-01 fact', () => {
    const base = completeGateFBundle()
    const checklistBytes = base.files.get('legal/approval-checklist.json')
    expect(checklistBytes).toBeDefined()
    const parsed = JSON.parse(
      Buffer.from(checklistBytes ?? []).toString('utf8'),
    ) as Record<string, unknown> & { facts: { key: string; decided: boolean }[] }
    const undecided = canonicalReleaseEvidence({
      ...parsed,
      facts: parsed.facts.map((fact, index) =>
        index === 0 ? { ...fact, decided: false } : fact,
      ),
    })
    const fixture = gateFFixture(undefined, { legalChecklistContent: undecided })
    const result = validateFixture(fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('is undecided')
    }
  })

  it('fails closed when the on-disk legal documents cannot be re-hashed', () => {
    const fixture = gateFFixture()
    const result = validateGateFEvidenceBundle(fixture.content, readFixture(fixture), {
      verifyApproval: fixture.options.verifyApproval,
      legalRevisionSet: fixture.options.legalRevisionSet,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'on-disk legal document digests cannot be verified without a document reader',
      )
    }
  })

  it('rejects a checklist that decides a different legal revision set', () => {
    const base = completeGateFBundle()
    const checklistBytes = base.files.get('legal/approval-checklist.json')
    const parsed = JSON.parse(
      Buffer.from(checklistBytes ?? []).toString('utf8'),
    ) as Record<string, unknown>
    const foreign = canonicalReleaseEvidence({
      ...parsed,
      legalRevisionSetSha256: digest('7'),
    })
    const fixture = gateFFixture(undefined, { legalChecklistContent: foreign })
    const result = validateFixture(fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'checklist does not decide the legal revision set this bundle binds',
      )
    }
  })

  it('cannot be satisfied by an engineering identity signing counsel', () => {
    // Role separation is structural: counsel's row is signed by counsel's
    // enrolled key. An engineering identity in the approverIdentity string
    // does not change who signed, and a bundle that renames the approver
    // without re-signing fails.
    const fixture = gateFFixture(undefined, {
      approverIdentities: { counsel: 'Kodes Agency' },
      strangerSignedRoles: ['counsel'],
    })
    const result = validateFixture(fixture)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain(
        'approvals.counsel.evidence: unknown_key',
      )
    }
  })
})
