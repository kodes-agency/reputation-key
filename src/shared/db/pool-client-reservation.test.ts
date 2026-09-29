import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { withReservedPoolClients } from './pool-client-reservation'

type FakeClient = Readonly<{ id: number; release: (error?: unknown) => void }>

/** A bounded pool with pg's checkout shapes: `connect()` and `connect(cb)`. */
class FakePool {
  readonly idle: FakeClient[]
  readonly waiters: Array<(client: FakeClient) => void> = []
  /** Checkouts asked of the pool itself. */
  calls = 0
  refuseCall: number | null = null
  readonly refusal = new Error('connection refused')

  constructor(size: number) {
    this.idle = Array.from({ length: size }, (_, index) => this.client(index + 1))
  }

  private client(id: number): FakeClient {
    return {
      id,
      release: () => {
        const client = this.client(id)
        const waiter = this.waiters.shift()
        if (waiter) waiter(client)
        else this.idle.push(client)
      },
    }
  }

  connect(
    callback?: (error: unknown, client?: FakeClient) => void,
  ): Promise<FakeClient> | undefined {
    this.calls += 1
    if (this.calls === this.refuseCall) return Promise.reject(this.refusal)
    const checkout = new Promise<FakeClient>((resolve) => {
      const client = this.idle.shift()
      if (client) resolve(client)
      else this.waiters.push(resolve)
    })
    if (!callback) return checkout
    void checkout.then((client) => callback(undefined, client))
    return undefined
  }

  /** pg's `pool.query` checks a client out through the callback form. */
  query(): Promise<number> {
    return new Promise((resolve) => {
      this.connect((_error, client) => {
        resolve(client!.id)
        client!.release()
      })
    })
  }
}

const database = (pool: FakePool) => ({ $client: pool as unknown as Pool })

const take = (pool: FakePool) => pool.connect() as Promise<FakeClient>

describe('withReservedPoolClients', () => {
  it('hands the reserved clients to the work before the pool is asked again', async () => {
    const pool = new FakePool(3)

    const seen = await withReservedPoolClients(database(pool), 2, async () => {
      const first = await take(pool)
      const second = await take(pool)
      const callsAfterReservation = pool.calls
      first.release()
      second.release()
      return { ids: [first.id, second.id], callsAfterReservation }
    })

    expect(seen).toEqual({ ids: [1, 2], callsAfterReservation: 2 })
    expect(pool.idle).toHaveLength(3)
  })

  it("serves pg's callback-form checkout from the reservation", async () => {
    const pool = new FakePool(2)

    const id = await withReservedPoolClients(database(pool), 1, () => pool.query())

    expect(id).toBe(1)
    expect(pool.calls).toBe(1)
    expect(pool.idle).toHaveLength(2)
  })

  it('keeps a client the work returned for its next checkout', async () => {
    const pool = new FakePool(3)

    const callsBeyondReservation = await withReservedPoolClients(
      database(pool),
      2,
      async () => {
        // A plain read before the consumer's transaction, as Inbox does.
        await pool.query()
        const first = await take(pool)
        const second = await take(pool)
        const calls = pool.calls
        first.release()
        second.release()
        return calls - 2
      },
    )

    expect(callsBeyondReservation).toBe(0)
    expect(pool.idle).toHaveLength(3)
  })

  it('lets a client released with an error leave the reservation', async () => {
    const pool = new FakePool(3)

    const calls = await withReservedPoolClients(database(pool), 2, async () => {
      const broken = await take(pool)
      broken.release(new Error('connection lost'))
      const first = await take(pool)
      const second = await take(pool)
      first.release()
      second.release()
      return pool.calls
    })

    expect(calls).toBe(3)
    expect(pool.idle).toHaveLength(3)
  })

  it('releases the clients the work never used', async () => {
    const pool = new FakePool(2)

    await withReservedPoolClients(database(pool), 2, async () => 'obsolete')

    expect(pool.idle).toHaveLength(2)
  })

  it('releases the reservation when the work fails', async () => {
    const pool = new FakePool(2)

    await expect(
      withReservedPoolClients(database(pool), 2, async () => {
        throw new Error('consumer failed')
      }),
    ).rejects.toThrow('consumer failed')
    expect(pool.idle).toHaveLength(2)
  })

  it('leaves a checkout another job makes meanwhile on the pool', async () => {
    const pool = new FakePool(2)
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    // Another job: its continuation belongs to its own context, not the work's.
    const otherJob = (async () => {
      await gate
      const client = await take(pool)
      client.release()
      return client.id
    })()

    await withReservedPoolClients(database(pool), 2, async () => {
      open()
      await new Promise((resolve) => setImmediate(resolve))
      // Both clients are reserved, so the other job queues on the pool.
      expect(pool.waiters).toHaveLength(1)
    })

    await expect(otherJob).resolves.toBe(1)
  })

  it('acquires one reservation at a time, so two half-held ones cannot starve each other', async () => {
    const pool = new FakePool(2)
    const unit = () =>
      withReservedPoolClients(database(pool), 2, async () => {
        const client = await take(pool)
        client.release()
        return client.id
      })

    // Without the queue each takes one client and waits for the other's forever.
    await expect(Promise.all([unit(), unit()])).resolves.toEqual([
      expect.any(Number),
      expect.any(Number),
    ])
    expect(pool.idle).toHaveLength(2)
  })

  it('returns a partial reservation and lets the next one proceed when a checkout fails', async () => {
    const pool = new FakePool(2)
    pool.refuseCall = pool.calls + 2

    await expect(
      withReservedPoolClients(database(pool), 2, async () => 'never'),
    ).rejects.toBe(pool.refusal)
    await expect(
      withReservedPoolClients(database(pool), 2, async () => 'next'),
    ).resolves.toBe('next')
    expect(pool.idle).toHaveLength(2)
  })

  it('runs the work directly on a database bound to a single client', async () => {
    const single = { query: async () => ({ rows: [] }) }

    await expect(
      withReservedPoolClients(
        { $client: single as unknown as Pool },
        2,
        async () => 'ran',
      ),
    ).resolves.toBe('ran')
  })
})
