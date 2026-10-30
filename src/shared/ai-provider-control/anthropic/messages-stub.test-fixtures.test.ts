import { describe, expect, it } from 'vitest'
import {
  anthropicMessageBody,
  scriptedMessagesFetch,
} from './messages-stub.test-fixtures'

describe('scripted Messages fetch', () => {
  it('records invented requests and refuses an unscripted call', async () => {
    const fake = scriptedMessagesFetch([
      { kind: 'message', body: anthropicMessageBody({ answer: { invented: true } }) },
    ])
    const response = await fake('https://local.invalid/v1/messages', {
      method: 'POST',
      body: '{"invented":true}',
    })
    expect(response.status).toBe(200)
    expect(fake.calls).toHaveLength(1)
    expect(new TextDecoder().decode(fake.calls[0]?.bodyBytes)).toBe('{"invented":true}')
    await expect(fake('https://local.invalid/v1/messages')).rejects.toThrow(
      new Error('Unscripted Anthropic request refused'),
    )
  })
})
