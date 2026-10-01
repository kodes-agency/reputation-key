import { describe, expect, it } from 'vitest'
import { readBoundedBody } from './read-bounded-body'

const post = (body: BodyInit | null) =>
  new Request('http://localhost/x', { method: 'POST', body })

const chunked = (parts: readonly Uint8Array[]) =>
  new Request('http://localhost/x', {
    method: 'POST',
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      },
    }),
    // Required by undici for a streamed body.
    duplex: 'half',
  } as RequestInit)

describe('readBoundedBody', () => {
  it('reads a body within the budget exactly', async () => {
    const body = await readBoundedBody(post('hello'), 5)
    expect(body && Buffer.from(body).toString()).toBe('hello')
  })

  it('returns an empty body when there is none', async () => {
    expect(await readBoundedBody(new Request('http://localhost/x'), 5)).toEqual(
      new Uint8Array(),
    )
  })

  it('refuses a body one byte over the budget', async () => {
    expect(await readBoundedBody(post('hello!'), 5)).toBeNull()
  })

  it('counts a chunked body that declares no length, and stops reading at the budget', async () => {
    const parts = [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)]
    expect(await readBoundedBody(chunked(parts), 11)).toBeNull()
    const ok = await readBoundedBody(chunked(parts), 12)
    expect(ok?.byteLength).toBe(12)
  })

  it('returns null rather than throwing when the stream fails', async () => {
    const failing = new Request('http://localhost/x', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('connection reset'))
        },
      }),
      duplex: 'half',
    } as RequestInit)
    expect(await readBoundedBody(failing, 100)).toBeNull()
  })
})
