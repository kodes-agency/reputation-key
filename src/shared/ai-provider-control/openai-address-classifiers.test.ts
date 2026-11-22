import { describe, expect, it, vi } from 'vitest'
import {
  hasOfficialOpenAiRefusal,
  isForbiddenOpenAiAddress,
  createRestrictedOpenAiLookup,
} from './openai-connector'

describe('OpenAI connector security classifiers', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '192.31.196.1',
    '192.52.193.1',
    '192.175.48.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    '100::1',
    '2001:db8::1',
    'fc00::1',
    'fe80::1',
    'ff00::1',
    '::192.0.2.1',
    '64:ff9b:1::1',
    '64:ff9b::1',
    '2620:4f:8000::1',
    'fec0::1',
    '3fff::1',
    '5f00::1',
    'not-an-ip',
  ])('rejects non-global DNS address %s', (address) => {
    expect(isForbiddenOpenAiAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'admits public DNS address %s',
    (address) => {
      expect(isForbiddenOpenAiAddress(address)).toBe(false)
    },
  )

  it.each([
    ['64:ff9b::', true],
    ['64:ff9b::ffff:ffff', true],
    ['64:ff9a:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['64:ff9b:0:0:0:1::', false],
    ['2620:4f:8000::', true],
    ['2620:4f:8000:ffff:ffff:ffff:ffff:ffff', true],
    ['2620:4f:7fff:ffff:ffff:ffff:ffff:ffff', false],
    ['2620:4f:8001::', false],
  ])('classifies the exact IANA special-use boundary %s', (address, forbidden) => {
    expect(isForbiddenOpenAiAddress(address)).toBe(forbidden)
  })

  it('recognizes only an official response message refusal shape', () => {
    expect(
      hasOfficialOpenAiRefusal({
        output: [
          { type: 'message', content: [{ type: 'refusal', refusal: 'not allowed' }] },
        ],
      }),
    ).toBe(true)
    expect(hasOfficialOpenAiRefusal({ refusal: 'not allowed' })).toBe(false)
    expect(
      hasOfficialOpenAiRefusal({
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 42 }] }],
      }),
    ).toBe(false)
  })

  it('rejects an entire DNS resolution containing any non-public answer', async () => {
    const dns = vi.fn(
      (
        _hostname: string,
        options: Readonly<{ all: true; verbatim: true }>,
        callback: (
          error: NodeJS.ErrnoException | null,
          addresses: readonly Readonly<{ address: string; family: number }>[],
        ) => void,
      ) => {
        expect(options).toEqual({ all: true, verbatim: true })
        callback(null, [
          { address: '127.0.0.1', family: 4 },
          { address: '1.1.1.1', family: 4 },
        ])
      },
    )
    const lookup = createRestrictedOpenAiLookup(dns)
    await expect(
      new Promise((resolve, reject) => {
        lookup('api.openai.com', { family: 4 }, (error, address) => {
          if (error) reject(error)
          else resolve(address)
        })
      }),
    ).rejects.toThrow('forbidden')
  })

  it('pins one result only after every DNS answer is public', async () => {
    const lookup = createRestrictedOpenAiLookup((_hostname, _options, callback) => {
      callback(null, [
        { address: '1.1.1.1', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ])
    })
    const selected = await new Promise((resolve, reject) => {
      lookup('api.openai.com', { family: 4 }, (error, address) => {
        if (error || address === undefined) reject(error ?? new Error('missing address'))
        else resolve(address)
      })
    })
    expect(selected).toBe('1.1.1.1')
  })
})
