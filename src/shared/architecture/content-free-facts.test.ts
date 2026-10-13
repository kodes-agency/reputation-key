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
//   1. Parse each context's `domain/events.ts` and `domain/*-events.ts` files
//      for `export type X = Readonly<{…}>` blocks (payloads are flat).
//   2. Ignore envelope fields: _tag, eventId, occurredAt, correlationId.
//   3. A field is "free-text-ish" when its name matches FREE_TEXTISH below:
//      a prose word (text, comment, reason, …) or a name word (name, slug,
//      title, label, note, …). A field named neither way passes unregistered,
//      whatever it holds.
//   4. Register entries must reference real payload fields — stale entries
//      fail too.
//
// What this does not do. It reads field NAMES, so the register is the list of
// exceptions to that heuristic, not an inventory of every non-identifier
// fact: plain strings such as `publicationDigest`, `sourceAggregateVersion`,
// `tokenIdentifier` and `reference` are never asked about, and one entry
// (`GuestRatingSubmitted.value`) is there by choice, not because the pattern
// found it. And it reads the TypeScript payload types, not the Zod schemas in
// `src/shared/events/schema-registrations.ts` that decide which fields an
// outbox row keeps.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** field name → justification (BQC-1-owned gaps are findings, not fixes). */
const REGISTER: Readonly<Record<string, string>> = {
  // BQC-1 gap (F1): free-text rejection reason rides the in-process bus.
  // The durable outbox schema already strips it, but activity audit detail
  // (on-reply-rejected) and notification email bodies copy it.
  'ReviewReplyRejected.reason': 'BQC-1 gap: protected content on the bus',
  // What the durable fact keeps instead: that a reason exists, never its words.
  'ReviewReplyRejected.hasReason': 'boolean presence fact, never the reason text',
  // By-design non-sensitive display names (no PII, no review content).
  'PortalGroupCreated.name': 'by-design non-sensitive display name',
  'PortalGroupUpdated.name': 'by-design non-sensitive display name',
  // Business names a manager entered and the URL slugs made from them: no
  // guest, reviewer or review content. ADR 0030 names them neither among the
  // facts a payload may carry nor among the content it must not, and the log
  // policy redacts both (`sensitive-field-policy.ts`), so these entries record
  // that the durable facts carry them; they do not record a decision.
  'IdentityOrganizationCreated.organizationName': 'Organization display name',
  'IdentityOrganizationCreated.slug': 'Organization URL slug, made from its name',
  'PropertyCreated.name': 'Property display name',
  'PropertyCreated.slug': 'Property URL slug, made from its name',
  'PropertyUpdated.name': 'Property display name',
  'PropertyUpdated.slug': 'Property URL slug, made from its name',
  // 1–5 star rating value — a numeric fact, not content.
  'GuestRatingSubmitted.value': '1-5 numeric fact',
  // Closed Portal Health vocabulary — enum codes, never operator/guest prose.
  'PortalHealthChanged.previousReason': 'closed PortalHealthReason enum fact',
  'PortalHealthChanged.reason': 'closed PortalHealthReason enum fact',
  'ReviewPropertyHistoryImportFinished.failureReason':
    'closed ReviewHistoryImportFailureReason enum fact',
  // Closed Inbox handling-cycle vocabularies — lifecycle facts, never prose.
  'InboxHandlingCycleOpened.openReason': 'closed HandlingCycleOpenReason enum fact',
  'InboxHandlingCycleClosed.closeReason': 'closed HandlingCycleCloseReason enum fact',
  'InboxHandlingCycleReopened.reopenReason': 'closed ManualReopenReason enum fact',
  'InboxAssignmentsReleased.releaseReason':
    'closed InboxAssignmentReleaseReason enum fact',
  // Monotonic numeric working-copy version, not the localized brand content.
  'PortalPropertyBrandContentUpdated.contentVersion': 'positive numeric version fact',
}

const ENVELOPE_FIELDS = new Set(['_tag', 'eventId', 'occurredAt', 'correlationId'])
// Prose words, then name words. `note` stops short of `noteId`: an id is a fact.
const FREE_TEXTISH =
  /text|comment|email|reason|body|content|description|message|name|slug|title|label|summary|phone|note(?!Id)/i
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
    const domainDirectory = join('src/contexts', context, 'domain')
    if (!existsSync(domainDirectory)) continue
    const eventFiles = readdirSync(domainDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(?:events|.+-events)\.ts$/u.test(entry.name))
      .map((entry) => join(domainDirectory, entry.name))
    for (const eventFile of eventFiles) {
      for (const field of collectPayloadFields(eventFile)) all.add(field)
    }
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

  // R1A-09: the pattern saw prose words only, so a display name was never asked
  // for a register entry and the header's "names" were not an inventory.
  it('reads a field named like a name or a note as free-text-ish, and an id as not', () => {
    const named = [
      'name',
      'organizationName',
      'reviewerDisplayName',
      'slug',
      'title',
      'label',
      'summary',
      'phone',
      'internalNote',
    ]
    expect(named.filter((field) => !FREE_TEXTISH.test(field))).toEqual([])
    expect(
      ['noteId', 'noteIds', 'propertyId'].filter((id) => FREE_TEXTISH.test(id)),
    ).toEqual([])
  })

  it('register entries reference real payload fields (no stale entries)', () => {
    const stale = Object.keys(REGISTER).filter((key) => !allFields.has(key))
    expect(stale, `stale register entries:\n${stale.join('\n')}`).toEqual([])
  })
})
