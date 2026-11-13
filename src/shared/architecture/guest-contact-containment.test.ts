import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkGlobalCapability,
  checkScopedCapability,
  isBlockedCapability,
} from '#/shared/auth/beta-capabilities'
import { contactRequestLifecycle } from '#/contexts/guest/contact-requests/contact-request-lifecycle.server'
import type { AuthContext } from '#/shared/domain/auth-context'
import { readUiSources } from '#/shared/testing/source-tree'

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

const SCOPE = {
  organizationId: 'org-1',
  propertyId: '10000000-0000-4000-8000-000000000002',
  portalId: '10000000-0000-4000-8000-000000000003',
}

/** A repository that fails the test if any command reaches storage. */
const untouchedRepository = new Proxy(
  {},
  {
    get: (_target, name) => () => {
      throw new Error(`repository.${String(name)} was reached`)
    },
  },
) as Parameters<typeof contactRequestLifecycle>[0]['repo']

const untouched = (name: string) => () => {
  throw new Error(`${name} was reached`)
}

const switchedOff = contactRequestLifecycle({
  repo: untouchedRepository,
  policy: { decide: untouched('policy.decide') as never },
  managerAuthority: { resolve: untouched('managerAuthority.resolve') as never },
  responseAuthority: { authorize: untouched('responseAuthority.authorize') as never },
  isEnabled: () => false,
  clock: () => new Date('2026-08-26T09:00:00.000Z'),
  idGen: () => 'id',
  revealAuditIdGen: () => 'audit',
})

// Withdrawal and expiry stay open while the switch is off: only the response
// authority answers, and the repository still must not be reached by anything else.
const withdrawalOpen = contactRequestLifecycle({
  repo: untouchedRepository,
  policy: { decide: untouched('policy.decide') as never },
  managerAuthority: { resolve: untouched('managerAuthority.resolve') as never },
  responseAuthority: { authorize: async () => '10000000-0000-4000-8000-000000000004' },
  isEnabled: () => false,
  clock: () => new Date('2026-08-26T09:00:00.000Z'),
  idGen: () => 'id',
  revealAuditIdGen: () => 'audit',
})

const SCREEN_AND_ENDPOINT_FILES = [
  'src/contexts/guest/page/ui/contact-request.tsx',
  'src/contexts/guest/server/contact-requests.ts',
  'src/contexts/guest/contact-requests/ui/contact-request.tsx',
].map((path) => join(ROOT, path))

const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/gu
const RESOLVED_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

function importedTargets(path: string): string[] {
  const source = readFileSync(path, 'utf8')
  return [...source.matchAll(IMPORT_SPECIFIER)].flatMap(([, specifier]) => {
    if (specifier === undefined) return []
    const base = specifier.startsWith('#/')
      ? join(ROOT, 'src', specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(dirname(path), specifier)
        : null
    return base === null ? [] : RESOLVED_SUFFIXES.map((suffix) => base + suffix)
  })
}

describe('Contact Request containment', () => {
  it('names the lifecycle and storage only in the Guest build, its server functions and the container', () => {
    const entryPaths = [
      ...sourceFiles(join(ROOT, 'src/routes')),
      ...sourceFiles(join(ROOT, 'src/components')),
      ...readUiSources({ includeTs: true, comments: 'kept' })
        .filter((file) => file.path.startsWith('src/contexts/'))
        .map((file) => join(ROOT, file.path)),
      ...sourceFiles(join(ROOT, 'src/worker')),
      ...sourceFiles(join(ROOT, 'src/shared/jobs')),
      join(ROOT, 'src/contexts/guest/application/public-api.ts'),
      join(ROOT, 'src/bootstrap.ts'),
    ]

    expect(
      markerViolations(entryPaths, [
        'contact-request-lifecycle',
        'createContactRequestRepository',
        'guestContactRequests',
        'getContainer().guestContactRequests',
      ]),
    ).toEqual([])
  })

  it('mounts the guest form, the submit endpoint and the manager panel nowhere', () => {
    const importers = sourceFiles(join(ROOT, 'src')).flatMap((path) => {
      const targets = importedTargets(path)
      return SCREEN_AND_ENDPOINT_FILES.filter((file) => targets.includes(file)).map(
        (file) => `${relative(ROOT, path)} imports ${relative(ROOT, file)}`,
      )
    })

    expect(importers).toEqual([])
  })

  it('keeps the safety block on the capability until the launch is approved', () => {
    expect(isBlockedCapability('portal.guest_contact')).toBe(true)
    expect(checkGlobalCapability('portal.guest_contact')).toMatchObject({
      allowed: false,
      reason: 'capability_blocked',
    })
    expect(
      checkScopedCapability({ organizationId: 'org-1' }, 'portal.guest_contact'),
    ).toMatchObject({ allowed: false, reason: 'capability_blocked' })
  })

  it('refuses every guest and manager command while the launch switch is off, without reaching storage', async () => {
    const ctx = { userId: 'manager-1', organizationId: 'org-1' } as AuthContext
    const refused = { code: 'contact_disabled' }
    await expect(
      switchedOff.submit({
        ...SCOPE,
        email: 'guest@example.com',
        consent: true,
        purpose: 'manager_follow_up',
        authority: { signedSession: 'cookie', csrfNonce: 'nonce' },
      }),
    ).rejects.toMatchObject(refused)
    await expect(
      switchedOff.getMasked(
        { ...SCOPE, responseId: '10000000-0000-4000-8000-000000000004' },
        ctx,
      ),
    ).rejects.toMatchObject(refused)
    await expect(
      switchedOff.reveal(
        {
          ...SCOPE,
          contactRequestId: '10000000-0000-4000-8000-000000000005',
          accessPurpose: 'respond_to_contact_request',
        },
        ctx,
      ),
    ).rejects.toMatchObject(refused)
  })

  it('keeps the withdrawal and expiry paths open when the launch switch is off', async () => {
    await expect(
      withdrawalOpen.withdraw({
        ...SCOPE,
        authority: { signedSession: 'cookie', csrfNonce: 'nonce' },
      }),
    ).rejects.toThrow('repository.withdraw was reached')
    await expect(withdrawalOpen.purgeExpired({ batchSize: 1 })).rejects.toThrow(
      'repository.purgeExpired was reached',
    )
  })

  it('keeps contact fields out of facts, notifications, analytics, inbox, AI, and search-owned code', () => {
    const consumers = [
      'src/contexts/feed',
      'src/contexts/ai',
      'src/contexts/inbox',
      'src/contexts/reporting',
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

  it('keeps logging, analytics and browser storage out of the endpoints and both screens', () => {
    const surfaces = [
      'src/contexts/guest/server/contact-requests.ts',
      'src/contexts/guest/page/ui/contact-request.tsx',
      'src/contexts/guest/contact-requests/ui/contact-request.tsx',
    ].map((path) => join(ROOT, path))

    expect(
      markerViolations(surfaces, [
        'console.',
        'getLogger',
        'logger',
        'captureException',
        'sendBeacon',
        'localStorage',
        'sessionStorage',
        'trackEvent',
      ]),
    ).toEqual([])
  })

  it('keeps owning-context manager authority out of Guest persistence', () => {
    const repository = join(
      ROOT,
      'src/contexts/guest/contact-requests/contact-request.repository.server.ts',
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
