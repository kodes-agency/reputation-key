// BQC-5.6: domain event payloads are content-free facts.
//
// ADR 0030 / BQR-4.2: events carry identifiers and facts, never protected
// content — durable consumers (activity audit detail, notification email
// bodies, outbox rows) copy payload fields verbatim, so free text on the bus
// leaks into long-lived stores. This test pins the exception inventory:
// every payload field whose NAME reads like free text must be registered
// below with its justification; any NEW free-text-ish field fails the suite.
//
// Deliberately simple heuristic, documented so it stays reviewable:
//   1. Parse each context's domain/events.ts for `export type X = Readonly<{…}>`
//      blocks (event payloads are flat — no nested object fields exist).
//   2. Ignore envelope fields: _tag, eventId, occurredAt, correlationId.
//   3. A field is "free-text-ish" when its name matches FREE_TEXTISH below.
//      Ids, enums, numbers, booleans, and dates never match and pass
//      unregistered. The register also documents known non-identifier facts
//      (names, the 1–5 rating value) so the inventory is complete.
//   4. Register entries must reference real payload fields — stale entries
//      fail too.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** field name → justification (BQC-1-owned gaps are findings, not fixes). */
const REGISTER: Readonly<Record<string, string>> = {
  // BQC-1 gap (F1): free-text rejection reason rides the in-process bus.
  // The durable outbox schema already strips it, but activity audit detail
  // (on-reply-rejected) and notification email bodies copy it.
  'ReviewReplyRejected.reason': 'BQC-1 gap: protected content on the bus',
  // By-design non-sensitive display names (no PII, no review content).
  'PortalGroupCreated.name': 'by-design non-sensitive display name',
  'PortalGroupUpdated.name': 'by-design non-sensitive display name',
  'TeamCreated.name': 'by-design non-sensitive display name',
  'TeamUpdated.name': 'by-design non-sensitive display name',
  // 1–5 star rating value — a numeric fact, not content.
  'GuestRatingSubmitted.value': '1-5 numeric fact',
  // Closed Portal Health vocabulary — enum codes, never operator/guest prose.
  'PortalHealthChanged.previousReason': 'closed PortalHealthReason enum fact',
  'PortalHealthChanged.reason': 'closed PortalHealthReason enum fact',
  // Closed Inbox handling-cycle vocabularies — lifecycle facts, never prose.
  'InboxHandlingCycleOpened.openReason': 'closed HandlingCycleOpenReason enum fact',
  'InboxHandlingCycleClosed.closeReason': 'closed HandlingCycleCloseReason enum fact',
  'InboxHandlingCycleReopened.reopenReason': 'closed ManualReopenReason enum fact',
  // Monotonic numeric working-copy version, not the localized brand content.
  'PortalPropertyBrandContentUpdated.contentVersion': 'positive numeric version fact',
}

const ENVELOPE_FIELDS = new Set(['_tag', 'eventId', 'occurredAt', 'correlationId'])
const FREE_TEXTISH = /text|comment|email|reason|body|content|description|message/i
const EVENT_TYPE_BLOCK = /export type (\w+) = Readonly<\{([\s\S]*?)\}>/g
const FIELD_LINE = /(\w+)\??:/g

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Parse `export type X = Readonly<{ … }>` blocks into `Type.field` keys. */
function collectPayloadFields(filePath: string): Set<string> {
  const source = stripComments(readFileSync(filePath, 'utf-8'))
  const fields = new Set<string>()
  for (const block of source.matchAll(EVENT_TYPE_BLOCK)) {
    const [, typeName, body] = block
    for (const field of body.matchAll(FIELD_LINE)) {
      const name = field[1]
      if (ENVELOPE_FIELDS.has(name)) continue
      fields.add(`${typeName}.${name}`)
    }
  }
  return fields
}

function collectAllEventFields(): Set<string> {
  const all = new Set<string>()
  for (const context of readdirSync('src/contexts')) {
    const eventsFile = join('src/contexts', context, 'domain/events.ts')
    if (!existsSync(eventsFile)) continue
    for (const field of collectPayloadFields(eventsFile)) all.add(field)
  }
  return all
}

describe('architecture: event payloads are content-free facts (BQC-5.6)', () => {
  const allFields = collectAllEventFields()

  it('every free-text-ish payload field is in the facts register', () => {
    const unregistered = [...allFields].filter((key) => {
      const fieldName = key.slice(key.indexOf('.') + 1)
      return FREE_TEXTISH.test(fieldName) && !(key in REGISTER)
    })
    expect(
      unregistered,
      'new free-text-ish event payload fields must be registered with justification:\n' +
        unregistered.join('\n'),
    ).toEqual([])
  })

  it('register entries reference real payload fields (no stale entries)', () => {
    const stale = Object.keys(REGISTER).filter((key) => !allFields.has(key))
    expect(stale, `stale register entries:\n${stale.join('\n')}`).toEqual([])
  })
})
