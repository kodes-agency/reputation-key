import { describe, expect, it, vi } from 'vitest'
import * as catalogue from '#/shared/ai-runtime-capability-contract'
import { templateFrameChoices } from './template-frame-choices'
const CHOICES = {
  closing: 0,
  signOff: 0,
  contactSentence: 0,
  emoji: 0,
  includeContact: true,
}
describe('template frame metadata activation', () => {
  it('keeps the exact served v1 metadata while B1 is dark', () => {
    const historical = vi.spyOn(catalogue, 'getAiRuntimeCapability').mockReturnValue({
      ...catalogue.getAiRuntimeCapability('reply_drafting'),
      runtimeProfileVersion: 'reply-drafting-runtime-v1',
      operationProfileVersion: 'reply-suggestion-v1',
    })
    try {
      expect(templateFrameChoices(CHOICES, 'positiveText')).toBe(CHOICES)
    } finally {
      historical.mockRestore()
    }
  })
  it('records the selected band when the catalogue deliberately serves v2', () => {
    const served = catalogue.getAiRuntimeCapability('reply_drafting')
    const selected = vi.spyOn(catalogue, 'getAiRuntimeCapability').mockReturnValue({
      ...served,
      operationProfileVersion: 'reply-suggestion-v2',
      runtimeProfileVersion: 'reply-drafting-runtime-v2',
    })
    try {
      expect(templateFrameChoices(CHOICES, 'positiveText')).toEqual({
        ...CHOICES,
        ratingBand: 'positiveText',
      })
    } finally {
      selected.mockRestore()
    }
  })
})
