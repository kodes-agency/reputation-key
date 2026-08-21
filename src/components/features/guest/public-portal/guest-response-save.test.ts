// The guest response write path: what reaches the server boundary, and the
// ordering between the response and its optional image.
//
// The ordering is the reason this module exists. The image is uploaded AFTER the
// response is written, so there is a window in which the response is persisted
// and the image is not. Reporting the response only once the whole sequence
// succeeded left the guest looking at an empty form for a response that already
// existed; the retry then spent their single one-hour correction on it. So the
// tests below pin that the response is reported at the moment it is persisted,
// including — especially — when the upload afterwards fails.

import { describe, it, expect, vi } from 'vitest'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { saveGuestResponse, type GuestResponseSaveInput } from './guest-response-save'
import type { GuestResponseDraft } from './guest-response-labels'

const WRITTEN: GuestResponseView = {
  id: 'r1',
  status: 'submitted',
  responseConsent: true,
  textConsent: true,
  rating: 4,
  category: null,
  text: 'Lovely stay',
  mediaConsent: false,
  submittedAt: '2026-02-01T10:00:00Z',
  correctedAt: null,
  correctionDeadline: '2026-02-01T11:00:00Z',
  deletedAt: null,
}

const DRAFT: GuestResponseDraft = {
  rating: 4,
  text: 'Lovely stay',
  responseConsent: true,
  textConsent: true,
  mediaConsent: false,
}

const MEDIA = {
  file: new File([new Uint8Array(8)], 'ok.png', { type: 'image/png' }),
  contentType: 'image/png' as const,
}

/** Records the order of everything the save touches, which is what is under test. */
function harness(over: Partial<GuestResponseSaveInput> = {}) {
  const order: string[] = []
  const input: GuestResponseSaveInput = {
    draft: DRAFT,
    media: null,
    token: 'tok_1',
    csrfNonce: 'nonce_1',
    honeypot: '',
    isCorrecting: false,
    submitResponse: async () => {
      order.push('submitResponse')
      return WRITTEN
    },
    correctResponse: async () => {
      order.push('correctResponse')
      return WRITTEN
    },
    issueMedia: async () => {
      order.push('issueMedia')
      return {
        mediaId: 'm1',
        objectKey: 'k1',
        uploadUrl: 'https://upload.example.test/k1',
        contentType: 'image/png',
      }
    },
    confirmMedia: async () => {
      order.push('confirmMedia')
      return { mediaId: 'm1', status: 'ready' as const }
    },
    onWritten: () => order.push('onWritten'),
    ...over,
  }
  return { input, order }
}

function stubUpload(ok: boolean, order: string[]) {
  vi.stubGlobal('fetch', async () => {
    order.push('PUT')
    return { ok } as Response
  })
}

describe('saveGuestResponse — which act is being written', () => {
  it('routes a correction to correctResponse and a first response to submitResponse', async () => {
    // Sending a correction to `submitResponse` is not a mislabelled call: the
    // submit path refuses a second response, so the correction would be lost.
    const first = harness()
    expect(await saveGuestResponse(first.input)).toBe(
      'Your optional response was submitted. You may correct it once for one hour.',
    )
    expect(first.order).toEqual(['submitResponse', 'onWritten'])

    const again = harness({ isCorrecting: true })
    expect(await saveGuestResponse(again.input)).toBe(
      'Your response was corrected. You can still withdraw it.',
    )
    expect(again.order).toEqual(['correctResponse', 'onWritten'])
  })

  it('sends blank written feedback as absent rather than as an empty string', async () => {
    // The server distinguishes "no feedback given" from "feedback given, empty",
    // and only the first is a response the guest may still add text to.
    const sent: unknown[] = []
    const { input } = harness({
      draft: { ...DRAFT, text: '   ' },
      submitResponse: async ({ data }) => {
        sent.push(data)
        return WRITTEN
      },
    })
    await saveGuestResponse(input)
    expect(sent).toEqual([
      {
        token: 'tok_1',
        csrfNonce: 'nonce_1',
        rating: 4,
        text: null,
        responseConsent: true,
        textConsent: true,
        mediaConsent: false,
        honeypot: '',
      },
    ])
  })
})

describe('saveGuestResponse — response before image', () => {
  it('reports the persisted response before uploading the image', async () => {
    const { input, order } = harness({ media: MEDIA })
    stubUpload(true, order)
    await saveGuestResponse(input)
    expect(order).toEqual([
      'submitResponse',
      'onWritten',
      'issueMedia',
      'PUT',
      'confirmMedia',
    ])
    vi.unstubAllGlobals()
  })

  it('still reports the response when the image upload then fails', async () => {
    // The response is already persisted at that point. A save that reported only
    // the failure would leave the guest retrying a response that exists, which
    // consumes the one correction they get.
    const { input, order } = harness({ media: MEDIA })
    stubUpload(false, order)
    expect(await saveGuestResponse(input)).toBe('The image upload did not complete.')
    expect(order).toEqual(['submitResponse', 'onWritten', 'issueMedia', 'PUT'])
    vi.unstubAllGlobals()
  })

  it('attempts no upload when the guest chose no image', async () => {
    const { input, order } = harness()
    await saveGuestResponse(input)
    expect(order).toEqual(['submitResponse', 'onWritten'])
  })
})

describe('saveGuestResponse — a write that never landed', () => {
  it('reports the failure and no response at all', async () => {
    const { input, order } = harness({
      media: MEDIA,
      submitResponse: async () => {
        throw new Error('The portal is no longer accepting feedback.')
      },
    })
    expect(await saveGuestResponse(input)).toBe(
      'The portal is no longer accepting feedback.',
    )
    // No `onWritten`, and no image uploaded against a response that does not exist.
    expect(order).toEqual([])
  })

  it('falls back to one generic sentence when the failure carries no message', async () => {
    const { input } = harness({
      submitResponse: async () => {
        throw 'socket hang up'
      },
    })
    expect(await saveGuestResponse(input)).toBe('The response could not be saved.')
  })
})
