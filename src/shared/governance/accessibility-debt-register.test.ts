import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'

const entrySchema = z.object({
  id: z.string().regex(/^A11Y-[0-9]{3}$/u),
  impact: z.enum(['minor', 'moderate']),
  finding: z.string().min(1),
  owner: z.string().min(1),
  milestone: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
})

const registerSchema = z
  .object({
    version: z.literal('beta-accessibility-debt-v1'),
    assessedAt: z.iso.date(),
    owner: z.string().min(1),
    scope: z.string().min(1),
    target: z.string().min(1),
    entries: z.array(entrySchema),
    manualEvidenceRequired: z.array(z.string().min(1)).min(5),
  })
  .superRefine((value, context) => {
    const ids = value.entries.map(({ id }) => id)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'duplicate accessibility debt id' })
    }
  })

describe('closed-beta accessibility debt authority', () => {
  it('owns every accepted non-blocking finding and keeps task blockers out', () => {
    const register = registerSchema.parse(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            'docs/release-evidence/review/accessibility-debt-register-2026-08-28.json',
          ),
          'utf8',
        ),
      ),
    )

    expect(register.target).toContain('Zero task-blocking')
    expect(register.target).toContain('not claimed')
    expect(register.manualEvidenceRequired).toEqual(
      expect.arrayContaining(['Real iPhone and Android critical journeys']),
    )
  })

  it('rejects task-blocking debt and unowned findings independently', () => {
    expect(
      entrySchema.safeParse({
        id: 'A11Y-001',
        impact: 'task_blocking',
        finding: 'Cannot submit the rating with a keyboard',
        owner: '',
        milestone: '',
        evidence: [],
      }).success,
    ).toBe(false)
  })
})
