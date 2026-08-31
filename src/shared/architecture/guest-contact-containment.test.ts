import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isBlockedCapability } from '#/shared/auth/beta-capabilities'

const ROOT = process.cwd()

function sourceFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    if (entry.isDirectory()) return sourceFiles(child)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (entry.name.includes('.test.') || entry.name.includes('.stories.')) return []
    return [child]
  })
}

function markerViolations(paths: readonly string[], markers: readonly string[]) {
  return paths.flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    return markers
      .filter((marker) => source.includes(marker))
      .map((marker) => `${relative(ROOT, path)}: ${marker}`)
  })
}

describe('Contact Request beta containment', () => {
  it('has no route, component, server, public API, or composition activation path', () => {
    const entryPaths = [
      ...sourceFiles(join(ROOT, 'src/routes')),
      ...sourceFiles(join(ROOT, 'src/components')),
      ...sourceFiles(join(ROOT, 'src/contexts/guest/server')),
      ...sourceFiles(join(ROOT, 'src/worker')),
      ...sourceFiles(join(ROOT, 'src/shared/jobs')),
      join(ROOT, 'src/contexts/guest/application/public-api.ts'),
      join(ROOT, 'src/contexts/guest/build.ts'),
      join(ROOT, 'src/composition.ts'),
      join(ROOT, 'src/bootstrap.ts'),
    ]

    expect(
      markerViolations(entryPaths, [
        'contact-request-lifecycle',
        'ContactRequestLifecycle',
        'createContactRequestRepository',
        'guestContactRequests',
        "'portal.guest_contact'",
      ]),
    ).toEqual([])
    expect(isBlockedCapability('portal.guest_contact')).toBe(true)

    const build = readFileSync(join(ROOT, 'src/contexts/guest/build.ts'), 'utf8')
    const retention = readFileSync(
      join(ROOT, 'src/shared/jobs/retention-sweep.job.ts'),
      'utf8',
    )
    expect(build).toContain('createContactRequestRetentionRepository')
    expect(build).not.toContain('contactRequestLifecycle')
    expect(retention).toContain('guestContactRequestRetentionSweep')
    expect(retention).not.toContain("'portal.guest_contact'")
  })

  it('keeps contact fields out of facts, notifications, analytics, inbox, AI, and search-owned code', () => {
    const consumers = [
      'src/contexts/activity',
      'src/contexts/ai',
      'src/contexts/dashboard',
      'src/contexts/inbox',
      'src/contexts/metric',
      'src/contexts/notification',
      'src/contexts/review',
      'src/shared/email',
      'src/shared/events',
      'src/shared/observability',
      'src/shared/outbox',
      // `src/shared/projections` is deliberately absent from this list: the
      // projection authority was retired, and scanning a directory that no
      // longer exists threw ENOENT on a fresh checkout while passing on a
      // developer machine that still had the empty folder. Its containment is
      // covered by retired-runtime-authorities.test.ts, which fails if either
      // projection file comes back at all.
      'src/shared/queries',
    ].flatMap((path) => sourceFiles(join(ROOT, path)))

    expect(
      markerViolations(consumers, [
        'guestContactRequests',
        'contactRequestId',
        'encryptedContact',
        'contactDetails',
      ]),
    ).toEqual([])
  })

  it('keeps owning-context manager authority out of Guest persistence', () => {
    const repository = join(
      ROOT,
      'src/contexts/guest/infrastructure/repositories/contact-request.repository.ts',
    )

    expect(
      markerViolations(
        [repository],
        [
          '#/shared/db/schema/auth',
          '#/shared/db/schema/policy.schema',
          'portalResponsibleManagers',
          'member.role',
          "'owner'",
          "'admin'",
        ],
      ),
    ).toEqual([])
  })
})
