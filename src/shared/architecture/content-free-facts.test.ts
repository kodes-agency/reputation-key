// BQC-5.6: domain event payloads are content-free facts.
//
// ADR 0030 / BQR-4.2: events carry identifiers and facts, never protected
// content — durable consumers (activity audit detail, notification email
// bodies, outbox rows) copy payload fields verbatim, so free text on the bus
// leaks into long-lived stores. This test pins the exception inventory:
// every payload field whose NAME reads like free text must be registered
// below with its justification; any NEW free-text-ish field fails the suite.
//
// Field-name heuristic, documented so it stays reviewable:
//   1. Parse each context's `domain/events.ts` and `domain/*-events.ts` files
//      with TypeScript and resolve exported object payload types, including
//      imported generic envelopes and intersections (payloads are flat).
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
import { readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ts from 'typescript'

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
  // facts a payload may carry nor among the content it must not. The log
  // policy (`sensitive-field-policy.ts`) redacts `slug`, and a business name
  // only where the field is spelled `businessName`: `name` and
  // `organizationName`, the spellings here, are not on its list. So these
  // entries record that the durable facts carry them; they do not record a
  // decision.
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
  // The Monday email's governed facts (v3 contract decision 11): a closed
  // weekly-or-monthly enum, and a count of the window's reviews that have text.
  'AiGuestVoiceSummaryReady.summaryKind': 'closed weekly or monthly enum fact',
  'GuestVoiceSummaryFactLine.textReviewCount':
    'count of reviews with text in the window, never the text',
  // Monotonic numeric working-copy version, not the localized brand content.
  'PortalPropertyBrandContentUpdated.contentVersion': 'positive numeric version fact',
}

const ENVELOPE_FIELDS = new Set(['_tag', 'eventId', 'occurredAt', 'correlationId'])
// Prose words, then name words. `note` stops short of `noteId`: an id is a fact.
const FREE_TEXTISH =
  /text|comment|email|reason|body|content|description|message|name|slug|title|label|summary|phone|note(?!Id)/i
function createEventProgram(eventFiles: string[]): ts.Program {
  const config = ts.getParsedCommandLineOfConfigFile(
    'tsconfig.json',
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    },
  )
  if (!config || config.errors.length > 0) {
    throw new Error('Cannot load TypeScript configuration for event payload discovery')
  }
  return ts.createProgram(eventFiles, config.options)
}

/** Resolve concrete exported payload types into `Type.field` keys. */
function collectPayloadFields(
  filePath: string,
  program = createEventProgram([filePath]),
): Set<string> {
  const source = program.getSourceFile(filePath)
  if (!source) throw new Error(`Event source not found: ${filePath}`)
  const checker = program.getTypeChecker()
  const fields = new Set<string>()
  for (const declaration of source.statements) {
    if (
      !ts.isTypeAliasDeclaration(declaration) ||
      declaration.typeParameters?.length ||
      !declaration.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    )
      continue
    const type = checker.getTypeAtLocation(declaration)
    if (type.flags & ts.TypeFlags.Any) {
      throw new Error(`Cannot resolve event payload type: ${declaration.name.text}`)
    }
    // Event unions and scalar vocabularies are not individual payloads.
    if (!(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) continue
    for (const field of checker.getPropertiesOfType(type)) {
      const name = field.getName()
      if (ENVELOPE_FIELDS.has(name)) continue
      fields.add(`${declaration.name.text}.${name}`)
    }
  }
  return fields
}

function collectAllEventFields(): Set<string> {
  const eventFiles: string[] = []
  for (const context of readdirSync('src/contexts')) {
    const domainDirectory = join('src/contexts', context, 'domain')
    if (!existsSync(domainDirectory)) continue
    const contextEventFiles = readdirSync(domainDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(?:events|.+-events)\.ts$/u.test(entry.name))
      .map((entry) => join(domainDirectory, entry.name))
    eventFiles.push(...contextEventFiles)
  }
  const program = createEventProgram(eventFiles)
  const all = new Set<string>()
  for (const eventFile of eventFiles) {
    for (const field of collectPayloadFields(eventFile, program)) all.add(field)
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

  it('discovers payload fields through imported generic envelopes and intersections', () => {
    const directory = mkdtempSync(join(tmpdir(), 'event-payload-fields-'))
    try {
      writeFileSync(
        join(directory, 'event-base.ts'),
        `export type Fact<Tag extends string, Payload> = Readonly<Payload & {
          _tag: Tag
          eventId: string
          occurredAt: Date
          correlationId: string | null
          organizationId: string
          body?: string
        }>
        export type LifecycleFact<Tag extends string, Payload> = Fact<
          Tag, Payload & { sourceAggregateVersion: string }
        >`,
      )
      const file = join(directory, 'events.ts')
      writeFileSync(
        file,
        `import type { Fact, LifecycleFact } from './event-base'
        export type LiteralFact = Readonly<{ _tag: 'literal'; name: string }>
        export type GenericFact = Fact<'generic', { reason: string; 'label'?: string }>
        type WorkflowFields = Readonly<{ contentVersion: number }>
        export type WorkflowFact = LifecycleFact<
          'workflow', WorkflowFields & { noteId: string }
        >
        export type Event = LiteralFact | GenericFact | WorkflowFact`,
      )

      const fields = collectPayloadFields(file)
      expect([...fields].sort()).toEqual(
        [
          'LiteralFact.name',
          'GenericFact.organizationId',
          'GenericFact.body',
          'GenericFact.reason',
          'GenericFact.label',
          'WorkflowFact.organizationId',
          'WorkflowFact.body',
          'WorkflowFact.sourceAggregateVersion',
          'WorkflowFact.contentVersion',
          'WorkflowFact.noteId',
        ].sort(),
      )
      expect(
        [...fields]
          .filter((key) => FREE_TEXTISH.test(key.slice(key.indexOf('.') + 1)))
          .sort(),
      ).toEqual(
        [
          'LiteralFact.name',
          'GenericFact.body',
          'GenericFact.reason',
          'GenericFact.label',
          'WorkflowFact.body',
          'WorkflowFact.contentVersion',
        ].sort(),
      )
      expect(fields.has('WorkflowFact.removedField')).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
