import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod/v4'
import { organizationId, propertyId } from '../../src/shared/domain/ids'
import type {
  PropertyReplyProfile,
  PropertyReplyTemplate,
  ReplyTemplateRepository,
} from '../../src/contexts/review/application/ports/reply-template.repository'
import {
  importReplyTemplateLibrary,
  parseReplyTemplateLibraryFile,
} from './import-reply-templates'

const PROPERTY = propertyId('71000000-0000-4000-8000-000000000001')
const ORGANIZATION = organizationId('71000000-0000-4000-8000-000000000002')
const NOW = new Date('2026-09-08T12:00:00.000Z')

function validInput() {
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

describe('parseReplyTemplateLibraryFile', () => {
  it('accepts the governed slots, aspect, language, and rating range', () => {
    const library = parseReplyTemplateLibraryFile(validInput(), 'example')

    expect(library.templates[0]).toMatchObject({
      sourceTitle: 'General positive',
      bands: [4, 5],
      language: 'en-Latn',
    })
  })

  it.each([
    [
      'unknown slot',
      (input: ReturnType<typeof validInput>) => {
        input.example.templates[0]!.text = 'Welcome to {property_name}.'
        input.example.templates[0]!.slots = []
      },
    ],
    [
      'unknown aspect',
      (input: ReturnType<typeof validInput>) => {
        input.example.templates[0]!.aspect = 'spa' as never
      },
    ],
    [
      'non-canonical language',
      (input: ReturnType<typeof validInput>) => {
        input.example.templates[0]!.language = 'english'
      },
    ],
    [
      'over-length body',
      (input: ReturnType<typeof validInput>) => {
        input.example.templates[0]!.text = 'x'.repeat(4097)
        input.example.templates[0]!.slots = []
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const input = validInput()
    mutate(input)

    expect(() => parseReplyTemplateLibraryFile(input, 'example')).toThrow(ZodError)
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
})
