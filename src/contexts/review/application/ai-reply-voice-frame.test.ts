import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { digestResolvedReplyVoice } from '#/shared/reply-library/render-reply'
import { BUILTIN_REPLY_VOICE, resolveVoice } from '#/shared/reply-library/reply-voice'
import { createAiReplyVoicePublicApi } from './ai-reply-voice-frame'
import type { ReplyLibraryRepository } from './ports/reply-library.repository'
import type { ReviewRepository } from './ports/review.repository'

const ORGANIZATION = organizationId('org-1')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const TX = {} as Tx

function api(loader: ReplyLibraryRepository['loadVoiceOverridesForShare'] | undefined) {
  const repository = {
    loadSnapshot: vi.fn(),
    ...(loader ? { loadVoiceOverridesForShare: loader } : {}),
  } as unknown as ReplyLibraryRepository
  const reviews = { findById: vi.fn() } as unknown as ReviewRepository
  return createAiReplyVoicePublicApi({ repository, reviews })
}

const input = (voiceDigest: string, languageGroup = 'en-Latn') => ({
  organizationId: ORGANIZATION,
  propertyId: PROPERTY,
  languageGroup,
  voiceDigest,
})

describe('isCurrentVoice', () => {
  const currentDigest = digestResolvedReplyVoice(
    resolveVoice(BUILTIN_REPLY_VOICE, null, null),
    'en-Latn',
  )

  it('accepts the digest of the voice the business has now', async () => {
    const voice = api(vi.fn(async () => ({ accountVoice: null, propertyVoice: null })))
    await expect(voice.isCurrentVoice(TX, input(currentDigest))).resolves.toBe(true)
  })

  it('rejects a digest taken before the voice changed', async () => {
    const voice = api(vi.fn(async () => ({ accountVoice: null, propertyVoice: null })))
    await expect(voice.isCurrentVoice(TX, input('0'.repeat(64)))).resolves.toBe(false)
  })

  it('rejects when no voice record can be read', async () => {
    const voice = api(vi.fn(async () => null))
    await expect(voice.isCurrentVoice(TX, input(currentDigest))).resolves.toBe(false)
  })

  it('rejects when the repository cannot read voices inside the transaction', async () => {
    await expect(api(undefined).isCurrentVoice(TX, input(currentDigest))).resolves.toBe(
      false,
    )
  })

  it('rejects a language group without a built-in voice without reading storage', async () => {
    const loader = vi.fn(async () => ({ accountVoice: null, propertyVoice: null }))
    await expect(
      api(loader).isCurrentVoice(TX, input(currentDigest, 'fr-Latn')),
    ).resolves.toBe(false)
    expect(loader).not.toHaveBeenCalled()
  })
})
