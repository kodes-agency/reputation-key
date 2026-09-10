// Templates are matched by (property, sourceTitle) for repeatable workbook imports.
// If a manager renames a template in Settings, re-importing its former sourceTitle
// creates a new row; it never silently overwrites the renamed template.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { z } from 'zod/v4'
import { createReplyTemplateRepository } from '../../src/contexts/review/infrastructure/repositories/reply-template.repository'
import type { ReplyTemplateRepository } from '../../src/contexts/review/application/ports/reply-template.repository'
import {
  replyProfileFieldSchemas,
  replyTemplateAspectSchema,
  replyTemplateBodySchema,
  replyTemplateLanguageSchema,
  replyTemplateOpenLabelSchema,
  replyTemplateRatingBandsSchema,
  replyTemplateSlotSchema,
  replyTemplateTitleSchema,
} from '../../src/contexts/review/application/dto/reply-library.dto'
import {
  REPLY_TEMPLATE_SLOT_TOKENS,
  unfilledReplySlots,
} from '../../src/contexts/review/domain/rules'
import { getDb } from '../../src/shared/db'
import { closePool } from '../../src/shared/db/pool'
import { propertyId as toPropertyId, type PropertyId } from '../../src/shared/domain/ids'

const profileSchema = z
  .object({
    propertyDisplayName: z.string().min(1).max(120),
    vertical: z.string().min(1).max(80),
    language: replyTemplateLanguageSchema,
    ...replyProfileFieldSchemas,
    escalationContactNote: z.string().max(500).nullable(),
  })
  .strict()

const templateSchema = z
  .object({
    id: z.string().min(1).max(120),
    sourceTitle: replyTemplateTitleSchema,
    bands: replyTemplateRatingBandsSchema,
    hasText: z.boolean(),
    aspect: replyTemplateAspectSchema,
    openLabel: replyTemplateOpenLabelSchema,
    language: replyTemplateLanguageSchema,
    slots: z.array(replyTemplateSlotSchema).max(REPLY_TEMPLATE_SLOT_TOKENS.length),
    text: replyTemplateBodySchema,
  })
  .strict()
  .superRefine((template, ctx) => {
    const declared = [...new Set(template.slots)].sort()
    const actual = [...unfilledReplySlots(template.text)].sort()
    if (declared.join('\0') !== actual.join('\0')) {
      ctx.addIssue({
        code: 'custom',
        path: ['slots'],
        message: 'Declared slots must exactly match the template body',
      })
    }
  })

const librarySchema = z
  .object({
    replyProfile: profileSchema,
    templates: z.array(templateSchema).min(1),
  })
  .strict()
  .superRefine((library, ctx) => {
    const titles = library.templates.map((template) => template.sourceTitle)
    if (new Set(titles).size !== titles.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['templates'],
        message: 'Template titles must be unique within a library',
      })
    }
  })

const libraryFileSchema = z.record(z.string().min(1), librarySchema)
export const REPLY_TEMPLATE_IMPORT_HELP = `Usage: import-reply-templates --property <uuid> --file <path> --library <key> [--dry-run]

Templates are matched by sourceTitle within the property. If a template was renamed
in Settings, re-importing its former sourceTitle creates a new row and leaves the
renamed template unchanged.
`

export type ReplyTemplateImportLibrary = z.infer<typeof librarySchema>

export type ReplyTemplateImportSummary = Readonly<{
  library: string
  propertyId: string
  dryRun: boolean
  templateMatch: 'property-title'
  profile: 'validated' | 'inserted' | 'updated' | 'unchanged'
  templates: Readonly<{
    total: number
    validated: number
    inserted: number
    updated: number
    unchanged: number
  }>
}>

export function parseReplyTemplateLibraryFile(
  input: unknown,
  libraryKey: string,
): ReplyTemplateImportLibrary {
  const libraries = libraryFileSchema.parse(input)
  const library = libraries[libraryKey]
  if (!library) throw new Error(`Reply template library not found: ${libraryKey}`)
  return library
}

export async function importReplyTemplateLibrary(input: {
  repository: ReplyTemplateRepository
  propertyId: PropertyId
  libraryKey: string
  library: ReplyTemplateImportLibrary
  dryRun: boolean
  updatedBy?: string
}): Promise<ReplyTemplateImportSummary> {
  const organizationId = await input.repository.findPropertyOrganization(input.propertyId)
  if (organizationId === null) {
    throw new Error(`Property not found: ${input.propertyId}`)
  }
  const summary = {
    library: input.libraryKey,
    propertyId: String(input.propertyId),
    dryRun: input.dryRun,
    templateMatch: 'property-title' as const,
    profile: 'validated' as ReplyTemplateImportSummary['profile'],
    templates: {
      total: input.library.templates.length,
      validated: input.dryRun ? input.library.templates.length : 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
    },
  }
  if (input.dryRun) return summary

  const updatedBy = input.updatedBy ?? 'ops:import-reply-templates'
  const profile = await input.repository.upsertProfile({
    organizationId,
    propertyId: input.propertyId,
    greeting: input.library.replyProfile.greeting,
    signOffPositive: input.library.replyProfile.signOffPositive,
    signOffNegative: input.library.replyProfile.signOffNegative,
    emojiAllowed: input.library.replyProfile.emojiAllowed,
    escalationContact: input.library.replyProfile.escalationContact,
    updatedBy,
  })
  summary.profile = profile.disposition

  for (const template of input.library.templates) {
    const bands = [...template.bands].sort((a, b) => a - b)
    const result = await input.repository.upsertTemplate({
      organizationId,
      propertyId: input.propertyId,
      title: template.sourceTitle,
      ratingMin: bands[0]!,
      ratingMax: bands.at(-1)!,
      hasText: template.hasText,
      aspect: template.aspect,
      openLabel: template.openLabel,
      languageTag: template.language,
      body: template.text,
      enabled: true,
      updatedBy,
    })
    summary.templates[result.disposition] += 1
  }
  return summary
}

function readOption(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const value = index < 0 ? undefined : args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing required option ${name}`)
  return value
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    process.stdout.write(REPLY_TEMPLATE_IMPORT_HELP)
    return
  }
  const property = z.uuid().parse(readOption(args, '--property'))
  const file = readOption(args, '--file')
  const libraryKey = readOption(args, '--library')
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
  const library = parseReplyTemplateLibraryFile(raw, libraryKey)
  const summary = await importReplyTemplateLibrary({
    repository: createReplyTemplateRepository(getDb(), () => new Date()),
    propertyId: toPropertyId(property),
    libraryKey,
    library,
    dryRun: args.includes('--dry-run'),
  })
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}

const entrypoint = process.argv[1]
if (entrypoint && pathToFileURL(entrypoint).href === import.meta.url) {
  void main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[import-reply-templates] failed: ${message}\n`)
      process.exitCode = 1
    })
    .finally(closePool)
}
