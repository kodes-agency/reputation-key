import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod/v4'
import { organizationId, propertyId } from '../../src/shared/domain/ids'
import {
  OPERATOR_ACTION,
  runOperatorCommand,
  type OperatorIO,
  type OperatorRuntime,
} from '../../src/shared/ops/operator-command'
import type {
  PropertyReplyProfile,
  PropertyReplyTemplate,
  ReplyTemplateRepository,
} from '../../src/contexts/review/application/ports/reply-template.repository'
import {
  replyProfileValuesSchema,
  replyTemplateValuesSchema,
  type ReplyProfileValues,
  type ReplyTemplateValues,
} from '../../src/contexts/review/application/dto/reply-library.dto'
import {
  createImportReplyTemplatesAction,
  importReplyTemplateLibrary,
  parseReplyTemplateLibraryFile,
  REPLY_TEMPLATE_IMPORT_COMMAND_SPEC,
  REPLY_TEMPLATE_IMPORT_HELP,
  type ReplyTemplateImportLibrary,
} from './import-reply-templates'

const PROPERTY = propertyId('71000000-0000-4000-8000-000000000001')
const ORGANIZATION = organizationId('71000000-0000-4000-8000-000000000002')
const NOW = new Date('2026-09-08T12:00:00.000Z')

type ImportInput = { example: ReplyTemplateImportLibrary }
type SettingsInput = {
  profile: ReplyProfileValues
  template: ReplyTemplateValues
}

function validInput(): ImportInput {
  return {
    example: {
      replyProfile: {
        propertyDisplayName: 'Example Hotel',
        vertical: 'hotel',
        language: 'en-Latn',
        greeting: 'Dear {guest_name},',
        signOffPositive: 'Warm regards',
        signOffNegative: 'Sincerely',
        emojiAllowed: false,
        escalationContact: 'care@example.test',
        escalationContactNote: null,
      },
      templates: [
        {
          id: 'general-positive',
          sourceTitle: 'General positive',
          bands: [4, 5],
          hasText: true,
          aspect: null,
          openLabel: null,
          language: 'en-Latn',
          slots: ['{guest_name}'],
          text: 'Thank you, {guest_name}.',
        },
      ],
    },
  }
}
function validSettingsInput(): SettingsInput {
  return {
    profile: {
      greeting: 'Dear {guest_name},',
      signOffPositive: 'Warm regards',
      signOffNegative: 'Sincerely',
      emojiAllowed: false,
      escalationContact: 'care@example.test',
    },
    template: {
      title: 'General positive',
      ratingMin: 4,
      ratingMax: 5,
      hasText: true,
      aspect: null as null | 'service',
      openLabel: null as string | null,
      languageTag: 'en-Latn',
      body: 'Thank you, {guest_name}.',
      enabled: true,
    },
  }
}

type SharedValidationFixture = readonly [
  label: string,
  target: 'profile' | 'template',
  mutateSettings: (input: SettingsInput) => void,
  mutateImport: (input: ImportInput) => void,
]

const SHARED_INVALID_INPUTS: readonly SharedValidationFixture[] = [
  [
    'an over-length greeting',
    'profile',
    (input) => {
      input.profile.greeting = 'x'.repeat(121)
    },
    (input) => {
      input.example.replyProfile.greeting = 'x'.repeat(121)
    },
  ],
  [
    'an unknown profile slot',
    'profile',
    (input) => {
      input.profile.greeting = 'Welcome, {property_name}.'
    },
    (input) => {
      input.example.replyProfile.greeting = 'Welcome, {property_name}.'
    },
  ],
  [
    'an unknown template slot',
    'template',
    (input) => {
      input.template.body = 'Welcome to {property_name}.'
    },
    (input) => {
      input.example.templates[0]!.text = 'Welcome to {property_name}.'
      input.example.templates[0]!.slots = []
    },
  ],
  [
    'an unknown aspect',
    'template',
    (input) => {
      input.template.aspect = 'spa' as never
    },
    (input) => {
      input.example.templates[0]!.aspect = 'spa' as never
    },
  ],
  [
    'a non-canonical language',
    'template',
    (input) => {
      input.template.languageTag = 'english'
    },
    (input) => {
      input.example.templates[0]!.language = 'english'
    },
  ],
  [
    'an over-length body',
    'template',
    (input) => {
      input.template.body = 'x'.repeat(4097)
    },
    (input) => {
      input.example.templates[0]!.text = 'x'.repeat(4097)
      input.example.templates[0]!.slots = []
    },
  ],
]

function rejectedZodMessages(run: () => unknown): readonly string[] {
  try {
    run()
  } catch (error) {
    if (error instanceof ZodError) {
      return error.issues.map((issue) => issue.message)
    }
    throw error
  }
  throw new Error('Expected Zod validation to reject the fixture')
}

function fakeRepository(disposition: 'inserted' | 'updated' | 'unchanged') {
  const profile: PropertyReplyProfile = {
    id: 'profile',
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    greeting: 'Dear {guest_name},',
    signOffPositive: 'Warm regards',
    signOffNegative: 'Sincerely',
    emojiAllowed: false,
    escalationContact: 'care@example.test',
    version: 1,
    updatedBy: 'ops',
    createdAt: NOW,
    updatedAt: NOW,
  }
  const template: PropertyReplyTemplate = {
    id: 'template',
    organizationId: ORGANIZATION,
    propertyId: PROPERTY,
    title: 'General positive',
    ratingMin: 4,
    ratingMax: 5,
    hasText: true,
    aspect: null,
    openLabel: null,
    languageTag: 'en-Latn',
    body: 'Thank you, {guest_name}.',
    enabled: true,
    version: 1,
    updatedBy: 'ops',
    createdAt: NOW,
    updatedAt: NOW,
  }
  return {
    findPropertyOrganization: vi.fn(async () => ORGANIZATION),
    findProfile: vi.fn(),
    findApplicableTemplates: vi.fn(),
    findEnabledTemplateById: vi.fn(),
    readDefaultReplyLanguage: vi.fn(),
    upsertProfile: vi.fn(async () => ({ disposition, value: profile })),
    upsertTemplate: vi.fn(async () => ({ disposition, value: template })),
  } as unknown as ReplyTemplateRepository
}
function statefulRepository() {
  const base = fakeRepository('unchanged')
  const templates: PropertyReplyTemplate[] = []
  let nextId = 1
  const repository = {
    ...base,
    upsertTemplate: vi.fn(
      async (input: Parameters<ReplyTemplateRepository['upsertTemplate']>[0]) => {
        const existing = templates.find((template) => template.title === input.title)
        if (existing) return { disposition: 'unchanged' as const, value: existing }

        const value: PropertyReplyTemplate = {
          ...input,
          id: `template-${nextId++}`,
          version: 1,
          createdAt: NOW,
          updatedAt: NOW,
        }
        templates.push(value)
        return { disposition: 'inserted' as const, value }
      },
    ),
    updateTemplate: vi.fn(
      async (input: Parameters<ReplyTemplateRepository['updateTemplate']>[0]) => {
        const index = templates.findIndex((template) => template.id === input.templateId)
        if (index < 0) return null
        const { templateId: _templateId, ...write } = input
        const value: PropertyReplyTemplate = {
          ...templates[index]!,
          ...write,
          version: templates[index]!.version + 1,
          updatedAt: NOW,
        }
        templates[index] = value
        return { disposition: 'updated' as const, value }
      },
    ),
  } as unknown as ReplyTemplateRepository
  return { repository, templates }
}

describe('parseReplyTemplateLibraryFile', () => {
  it('accepts the governed slots, aspect, language, and rating range', () => {
    const library = parseReplyTemplateLibraryFile(validInput(), 'example')

    expect(library.templates[0]).toMatchObject({
      sourceTitle: 'General positive',
      bands: [4, 5],
      language: 'en-Latn',
    })
  })

  it.each(SHARED_INVALID_INPUTS)(
    'rejects %s through both the importer and settings DTO',
    (_label, target, mutateSettings, mutateImport) => {
      const settings = validSettingsInput()
      const imported = validInput()
      mutateSettings(settings)
      mutateImport(imported)

      const settingsResult =
        target === 'profile'
          ? replyProfileValuesSchema.safeParse(settings.profile)
          : replyTemplateValuesSchema.safeParse(settings.template)
      if (settingsResult.success) {
        throw new Error('Expected the settings DTO to reject the fixture')
      }
      expect(
        rejectedZodMessages(() => parseReplyTemplateLibraryFile(imported, 'example')),
      ).toContain(settingsResult.error.issues[0]!.message)
    },
  )

  it('documents title-keyed re-import semantics', () => {
    expect(REPLY_TEMPLATE_IMPORT_HELP).toContain(
      're-importing its former sourceTitle creates a new row',
    )
  })
})

describe('importReplyTemplateLibrary', () => {
  it('validates without writing in dry-run mode', async () => {
    const repository = fakeRepository('inserted')
    const library = parseReplyTemplateLibraryFile(validInput(), 'example')

    const summary = await importReplyTemplateLibrary({
      repository,
      propertyId: PROPERTY,
      libraryKey: 'example',
      library,
      dryRun: true,
    })

    expect(summary).toEqual({
      library: 'example',
      propertyId: PROPERTY,
      dryRun: true,
      profile: 'validated',
      templateMatch: 'property-title',
      templates: {
        total: 1,
        validated: 1,
        inserted: 0,
        updated: 0,
        unchanged: 0,
      },
    })
    expect(repository.upsertProfile).not.toHaveBeenCalled()
    expect(repository.upsertTemplate).not.toHaveBeenCalled()
  })

  it.each(['inserted', 'updated', 'unchanged'] as const)(
    'reports idempotent repository disposition %s',
    async (disposition) => {
      const repository = fakeRepository(disposition)
      const library = parseReplyTemplateLibraryFile(validInput(), 'example')

      const summary = await importReplyTemplateLibrary({
        repository,
        propertyId: PROPERTY,
        libraryKey: 'example',
        library,
        dryRun: false,
      })

      expect(summary.profile).toBe(disposition)
      expect(summary.templates[disposition]).toBe(1)
      expect(repository.upsertTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          ratingMin: 4,
          ratingMax: 5,
          organizationId: ORGANIZATION,
          propertyId: PROPERTY,
        }),
      )
    },
  )

  it('leaves a Settings rename intact when its former source title is re-imported', async () => {
    const { repository, templates } = statefulRepository()
    const library = parseReplyTemplateLibraryFile(validInput(), 'example')
    const importInput = {
      repository,
      propertyId: PROPERTY,
      libraryKey: 'example',
      library,
      dryRun: false,
    } as const

    await importReplyTemplateLibrary(importInput)
    const imported = templates[0]!
    await repository.updateTemplate({
      ...imported,
      templateId: imported.id,
      title: 'Manager renamed',
      updatedBy: 'manager',
    })
    const summary = await importReplyTemplateLibrary(importInput)

    expect(summary.templates.inserted).toBe(1)
    expect(templates.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: imported.id, title: 'Manager renamed' },
      { id: 'template-2', title: 'General positive' },
    ])
  })
})

describe('import-reply-templates through the operator harness', () => {
  const OPERATOR = 'operator@example.test'
  const FILE = '/tmp/reply-template-library.json'
  const argv = [
    FILE,
    'example',
    '--operator',
    OPERATOR,
    '--org',
    ORGANIZATION,
    '--property',
    PROPERTY,
  ] as const

  function runtime(registered: boolean) {
    const decide = vi.fn<OperatorRuntime['decide']>(async (request) => {
      const allowed =
        registered &&
        request.principal.kind === 'operator' &&
        request.principal.id === OPERATOR
      return {
        allowed,
        reason: allowed ? 'allowed' : 'operator_not_registered',
        action: OPERATOR_ACTION,
        policyVersion: 'test',
      }
    })
    return {
      runtime: { newCorrelationId: () => 'reply-template-import-test', decide },
      decide,
    }
  }

  function memoryIO(): OperatorIO & { outLines: string[]; errLines: string[] } {
    const outLines: string[] = []
    const errLines: string[] = []
    return {
      outLines,
      errLines,
      out: (line) => void outLines.push(line),
      err: (line) => void errLines.push(line),
    }
  }

  async function run(registered: boolean, extraArgs: readonly string[] = []) {
    const repository = fakeRepository('inserted')
    const io = memoryIO()
    const policy = runtime(registered)
    const result = await runOperatorCommand(
      REPLY_TEMPLATE_IMPORT_COMMAND_SPEC,
      createImportReplyTemplatesAction({
        createRepository: () => repository,
        readFile: async () => JSON.stringify(validInput()),
      }),
      policy.runtime,
      [...argv, ...extraArgs],
      io,
    )
    return { decide: policy.decide, io, repository, result }
  }

  it('refuses an unregistered operator before any reply-template write', async () => {
    const { repository, result } = await run(false, [
      '--reason',
      'Import the approved template library',
      '--apply',
    ])

    expect(result).toMatchObject({
      exitCode: 1,
      decision: { allowed: false, reason: 'operator_not_registered' },
    })
    expect(repository.findPropertyOrganization).not.toHaveBeenCalled()
    expect(repository.upsertProfile).not.toHaveBeenCalled()
    expect(repository.upsertTemplate).not.toHaveBeenCalled()
  })

  it('defaults to a no-op and writes only when the harness apply flag is set', async () => {
    const dryRun = await run(true)

    expect(dryRun.result.exitCode).toBe(0)
    expect(dryRun.repository.upsertProfile).not.toHaveBeenCalled()
    expect(dryRun.repository.upsertTemplate).not.toHaveBeenCalled()
    expect(JSON.parse(dryRun.io.outLines.at(-1)!)).toMatchObject({
      propertyId: PROPERTY,
      dryRun: true,
      profile: 'validated',
    })
    expect(dryRun.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'operator', id: OPERATOR },
        capability: 'property.publish_reply',
        organizationId: ORGANIZATION,
        propertyId: PROPERTY,
      }),
    )

    const applied = await run(true, [
      '--reason',
      'Import the approved template library',
      '--apply',
    ])

    expect(applied.result.exitCode).toBe(0)
    expect(applied.repository.upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: PROPERTY, updatedBy: OPERATOR }),
    )
    expect(applied.repository.upsertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: PROPERTY, updatedBy: OPERATOR }),
    )
    expect(JSON.parse(applied.io.outLines.at(-1)!)).toMatchObject({
      propertyId: PROPERTY,
      dryRun: false,
      profile: 'inserted',
    })
  })
})
