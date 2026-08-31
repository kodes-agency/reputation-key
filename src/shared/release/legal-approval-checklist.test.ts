import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalReleaseEvidence } from './candidate-bound-evidence'
import { completeGateFBundle } from './gate-f-complete-evidence.test-fixtures'
import {
  LEGAL_CHECKLIST_DOCUMENTS,
  LEG_01_FACT_SOURCE_CATEGORIES,
  LEG_01_REQUIRED_FACT_KEYS,
  parseLegalApprovalChecklist,
  type LegalApprovalChecklistContext,
} from './legal-approval-checklist'
import { approvedLegalDocumentsFixture } from './legal-revision-set-evidence.test-fixtures'

const ROOT = resolve(import.meta.dirname, '../../..')

const DOCUMENTS = approvedLegalDocumentsFixture()
const CONTEXT: LegalApprovalChecklistContext = {
  readDocument: (path) => {
    const bytes = DOCUMENTS.files.get(path)
    if (bytes === undefined) throw new Error(`no fixture document at ${path}`)
    return bytes
  },
}

function checklistContent(): string {
  const bundle = completeGateFBundle()
  const bytes = bundle.files.get('legal/approval-checklist.json')
  if (!bytes) throw new Error('bundle has no legal approval checklist')
  return Buffer.from(bytes).toString('utf8')
}

function mutate(change: (draft: Record<string, unknown>) => void): string {
  const draft = JSON.parse(checklistContent()) as Record<string, unknown>
  change(draft)
  return canonicalReleaseEvidence(draft)
}

describe('legal approval checklist', () => {
  it('accepts the complete, current, digest-matched approval', () => {
    expect(parseLegalApprovalChecklist(checklistContent(), CONTEXT)).toMatchObject({
      ok: true,
    })
  })

  it('requires documentId, versionId, sha256, effectiveAt, reviewAt and expiresAt per document', () => {
    const parsed = parseLegalApprovalChecklist(checklistContent(), CONTEXT)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.evidence.documents.map(({ path }) => path).sort()).toEqual(
      LEGAL_CHECKLIST_DOCUMENTS.map(({ path }) => path).sort(),
    )
    for (const document of parsed.evidence.documents) {
      expect(document.documentId).toBeTruthy()
      expect(document.versionId).toBeTruthy()
      expect(document.sha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(Date.parse(document.effectiveAt)).toBeLessThan(
        Date.parse(document.expiresAt),
      )
      expect(Date.parse(document.reviewAt)).toBeGreaterThan(0)
    }
  })

  it('rejects a checklist that drops one of the three counsel-owned documents', () => {
    for (const { documentId } of LEGAL_CHECKLIST_DOCUMENTS) {
      const without = mutate((draft) => {
        draft.documents = (draft.documents as { documentId: string }[]).filter(
          (document) => document.documentId !== documentId,
        )
      })
      const parsed = parseLegalApprovalChecklist(without, CONTEXT)

      expect(parsed).toMatchObject({ ok: false })
      if (!parsed.ok) {
        expect(parsed.errors.join('\n')).toContain(documentId)
      }
    }
  })

  it.each(LEG_01_REQUIRED_FACT_KEYS)('requires LEG-01 fact %s to be present', (key) => {
    const without = mutate((draft) => {
      draft.facts = (draft.facts as { key: string }[]).filter((fact) => fact.key !== key)
    })
    const parsed = parseLegalApprovalChecklist(without, CONTEXT)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain(`missing required LEG-01 fact ${key}`)
    }
  })

  it.each(LEG_01_REQUIRED_FACT_KEYS)('requires LEG-01 fact %s to be decided', (key) => {
    const undecided = mutate((draft) => {
      draft.facts = (draft.facts as Record<string, unknown>[]).map((fact) =>
        fact.key === key ? { ...fact, decided: false } : fact,
      )
    })
    const parsed = parseLegalApprovalChecklist(undecided, CONTEXT)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain(`LEG-01 fact ${key} is undecided`)
    }
  })

  it('sources every required fact from a real counsel decision checklist category', () => {
    // The fact keys are not invented here: each one maps to a category in
    // docs/legal/counsel-decision-checklist.json, so a decided fact is
    // traceable to the open questions counsel was actually asked.
    const checklist = JSON.parse(
      readFileSync(resolve(ROOT, 'docs/legal/counsel-decision-checklist.json'), 'utf8'),
    ) as { items: { category: string }[] }
    const categories = new Set(checklist.items.map(({ category }) => category))

    for (const key of LEG_01_REQUIRED_FACT_KEYS) {
      expect(categories.has(LEG_01_FACT_SOURCE_CATEGORIES[key])).toBe(true)
    }
  })

  it('rejects a document whose on-disk digest changed after approval', () => {
    const edited = mutate((draft) => {
      draft.documents = (draft.documents as Record<string, unknown>[]).map(
        (document, index) =>
          index === 0 ? { ...document, sha256: 'f'.repeat(64) } : document,
      )
    })
    const parsed = parseLegalApprovalChecklist(edited, CONTEXT)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('the text changed after approval')
    }
  })

  it('rejects a document that still carries a not-for-publication draft marker', () => {
    const encoder = new TextEncoder()
    const draftBytes = encoder.encode(
      '# Privacy notice\n\nNot for publication — candidate draft.\n',
    )
    const draftContext: LegalApprovalChecklistContext = {
      readDocument: (path) =>
        path === 'docs/legal/privacy-notice.md' ? draftBytes : CONTEXT.readDocument(path),
    }
    const parsed = parseLegalApprovalChecklist(checklistContent(), draftContext)

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toMatch(/draft marker|changed after approval/u)
    }
  })

  it('requires counselIdentity and approvedAt', () => {
    for (const field of ['counselIdentity', 'approvedAt']) {
      const without = mutate((draft) => {
        delete draft[field]
      })

      expect(parseLegalApprovalChecklist(without, CONTEXT)).toMatchObject({ ok: false })
    }
  })

  it('rejects approvedAt outside [effectiveAt, expiresAt]', () => {
    const early = mutate((draft) => {
      draft.approvedAt = '2026-01-01T00:00:00.000Z'
    })
    const late = mutate((draft) => {
      draft.approvedAt = '2030-01-01T00:00:00.000Z'
      draft.capturedAt = '2030-01-02T00:00:00.000Z'
    })
    for (const content of [early, late]) {
      const parsed = parseLegalApprovalChecklist(content, CONTEXT)

      expect(parsed).toMatchObject({ ok: false })
      if (!parsed.ok) {
        expect(parsed.errors.join('\n')).toContain('outside the [effectiveAt, expiresAt]')
      }
    }
  })

  it('fails closed without a document reader', () => {
    const parsed = parseLegalApprovalChecklist(checklistContent())

    expect(parsed).toMatchObject({ ok: false })
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain(
        'cannot be verified without a document reader',
      )
    }
  })

  it('requires canonical JSON encoding', () => {
    const reindented = `${JSON.stringify(JSON.parse(checklistContent()), null, 2)}\n`

    expect(parseLegalApprovalChecklist(reindented, CONTEXT)).toMatchObject({ ok: false })
  })
})
