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
  it('has no route, component, server, worker, or composition activation path', () => {
    const entryPaths = [
      ...sourceFiles(join(ROOT, 'src/routes')),
      ...sourceFiles(join(ROOT, 'src/components')),
      ...sourceFiles(join(ROOT, 'src/contexts/guest/server')),
      join(ROOT, 'src/composition.ts'),
      join(ROOT, 'src/bootstrap.ts'),
      join(ROOT, 'src/worker/index.ts'),
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
  })

  it('keeps contact fields out of facts, notifications, analytics, inbox, AI, and search-owned code', () => {
    const consumers = [
      'src/contexts/activity',
      'src/contexts/ai',
      'src/contexts/inbox',
      'src/contexts/metric',
      'src/contexts/notification',
      'src/shared/events',
      'src/shared/outbox',
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
})
