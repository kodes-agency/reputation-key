import { describe, expect, it, vi } from 'vitest'
import {
  GrantNonceRegistry,
  createRestrictedProviderLookup,
  isForbiddenProviderAddress,
  readBoundedProviderResponse,
} from './connector-boundary'

class TestTransportError extends Error {}

describe('provider connector boundary', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.0.0.1', true],
    ['::1', true],
    ['8.8.8.8', false],
    ['2606:4700:4700::1111', false],
    ['not-an-address', true],
  ])('classifies %s against the shared egress address policy', (address, forbidden) => {
    expect(isForbiddenProviderAddress(address)).toBe(forbidden)
  })

  it('restricts a lookup to one hostname and public answers', () => {
    const lookupAll = vi.fn((_hostname, _options, callback) => {
      callback(null, [{ address: '8.8.8.8', family: 4 }])
    })
    const lookup = createRestrictedProviderLookup({
      hostname: 'provider.example',
      label: 'Example',
      lookupAll,
    })
    const accepted = vi.fn()
    lookup('provider.example', { family: 4 }, accepted)
    expect(accepted).toHaveBeenCalledWith(null, '8.8.8.8', 4)

    const refused = vi.fn()
    lookup('elsewhere.example', {}, refused)
    expect((refused.mock.calls[0]?.[0] as Error).message).toBe(
      'Example DNS hostname is forbidden',
    )
  })

  it('bounds response bytes and zeroes observed chunks after overflow', async () => {
    const first = Uint8Array.of(1, 2)
    const overflow = Uint8Array.of(3, 4, 5)
    let index = 0
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(index++ === 0 ? first : overflow)
        },
      }),
    )

    await expect(
      readBoundedProviderResponse(response, 4, () => new TestTransportError()),
    ).rejects.toBeInstanceOf(TestTransportError)
    expect(first).toEqual(Uint8Array.of(0, 0))
    expect(overflow).toEqual(Uint8Array.of(0, 0, 0))
  })

  it('bounds a response chunk flood and zeroes every observed chunk', async () => {
    const chunks = Array.from({ length: 1_025 }, () => Uint8Array.of(65))
    let cursor = 0
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[cursor]
          if (chunk === undefined) throw new Error('chunk fixture exhausted')
          cursor += 1
          controller.enqueue(chunk)
        },
        cancel,
      }),
    )

    await expect(
      readBoundedProviderResponse(response, 2_048, () => new TestTransportError()),
    ).rejects.toBeInstanceOf(TestTransportError)
    expect(cursor).toBe(1_025)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(chunks.every((chunk) => chunk[0] === 0)).toBe(true)
  })

  it('consumes a live nonce once and forgets it after expiry', () => {
    const registry = new GrantNonceRegistry()
    expect(registry.consume('nonce', 20, 10)).toBe(true)
    expect(registry.consume('nonce', 20, 10)).toBe(false)
    expect(registry.consume('nonce', 30, 20)).toBe(true)
  })
})
