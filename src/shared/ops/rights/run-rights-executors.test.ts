import { describe, expect, it, vi } from 'vitest'
import type { RightsExecutor } from './rights-executor'
import type { RightsRequestPlan } from './rights-request-command'
import { purgeRightsOrganization, writeRightsExport } from './run-rights-executors'

const base: RightsRequestPlan = {
  scope: 'organization',
  mode: 'apply',
  organizationId: 'org-a',
  batchSize: 50,
}

function executor(): RightsExecutor & {
  access: ReturnType<typeof vi.fn>
  purgeOrganization: ReturnType<typeof vi.fn>
} {
  return {
    context: 'reporting',
    access: vi.fn(async () => [
      {
        path: 'reporting/manifest.json',
        mediaType: 'application/json' as const,
        bytes: new Uint8Array([1]),
      },
    ]),
    purgeOrganization: vi.fn(async () => ({
      deleted: { goal_programs: 2 },
      evidenceRef: 'reporting:purge:v1:tenant_rows_deleted:2',
    })),
  }
}

describe('writeRightsExport', () => {
  it('writes nothing without an out directory', async () => {
    const write = vi.fn()
    const ex = executor()
    expect(await writeRightsExport([ex], base, write)).toEqual([])
    expect(ex.access).not.toHaveBeenCalled()
  })

  it('writes under the out directory and the requested Organization only', async () => {
    const write = vi.fn(async () => undefined)
    const ex = executor()
    await writeRightsExport([ex], { ...base, outDir: '/tmp/out' }, write)
    expect(ex.access).toHaveBeenCalledWith({ organizationId: 'org-a' })
    expect(write).toHaveBeenCalledWith(
      '/tmp/out/org-a/reporting/manifest.json',
      expect.any(Uint8Array),
    )
  })
})

describe('purgeRightsOrganization', () => {
  it('prints an erasure record per executor for an Organization closure', async () => {
    const ex = executor()
    const lines = await purgeRightsOrganization([ex], base, new Date('2026-11-08'))
    expect(ex.purgeOrganization).toHaveBeenCalledWith({
      organizationId: 'org-a',
      occurredAt: new Date('2026-11-08'),
    })
    expect(lines[0]).toContain('erasure record reporting org=org-a')
    expect(lines).toContain('  goal_programs 2')
  })

  it('does nothing for a narrower scope', async () => {
    const ex = executor()
    expect(
      await purgeRightsOrganization([ex], { ...base, scope: 'property' }, new Date()),
    ).toEqual([])
    expect(ex.purgeOrganization).not.toHaveBeenCalled()
  })
})
