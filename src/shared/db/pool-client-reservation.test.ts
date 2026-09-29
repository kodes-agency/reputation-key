import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { Pool, type PoolClient, type PoolConfig } from 'pg'
import { withReservedPoolClients } from './pool-client-reservation'

/**
 * A pg `Client` without a server, so the real pg-pool runs: its checkout
 * shapes, one-shot `release`, idle `error` listeners and eviction rules.
 */
class StubClient extends EventEmitter {
  static instances: StubClient[] = []
  static refuseNextConnect: Error | null = null
  readonly id = StubClient.instances.push(this)
  _queryable = true
  _ending = false

  connect(callback: (error?: Error) => void): void {
    const refusal = StubClient.refuseNextConnect
    StubClient.refuseNextConnect = null
    queueMicrotask(() => callback(refusal ?? undefined))
  }

  isConnected(): boolean {
    return !this._ending
  }

  query(
    _text: unknown,
    values?: unknown,
    callback?: (
      error: Error | undefined,
      result: { rows: { clientId: number }[] },
    ) => void,
  ): Promise<{ rows: { clientId: number }[] }> | undefined {
    const result = { rows: [{ clientId: this.id }] }
    const done = typeof values === 'function' ? values : callback
    if (typeof done !== 'function') return Promise.resolve(result)
    queueMicrotask(() => done(undefined, result))
    return undefined
  }

  end(callback?: () => void): Promise<void> {
    this._ending = true
    this._queryable = false
    queueMicrotask(() => callback?.())
    return Promise.resolve()
  }
}

const pools: Pool[] = []

function stubPool(max: number): Pool {
  const pool = new Pool({ max, Client: StubClient } as unknown as PoolConfig)
  pools.push(pool)
  return pool
}

const database = (pool: Pool) => ({ $client: pool })
const stub = (client: PoolClient) => client as unknown as StubClient

/** pg's plain read: `pool.query` checks a client out through the callback form. */
async function plainRead(pool: Pool): Promise<number> {
  const result = await pool.query<{ clientId: number }>('SELECT 1')
  return result.rows[0]?.clientId ?? Number.NaN
}

afterEach(async () => {
  StubClient.instances = []
  StubClient.refuseNextConnect = null
  await Promise.all(pools.splice(0).map((pool) => pool.end()))
})

describe('withReservedPoolClients', () => {
  it('lends the reserved clients to the work before the pool opens another', async () => {
    const pool = stubPool(3)

    const seen = await withReservedPoolClients(database(pool), 2, async () => {
      const first = await pool.connect()
      const second = await pool.connect()
      const opened = pool.totalCount
      first.release()
      second.release()
      return { ids: [stub(first).id, stub(second).id], opened }
    })

    expect(seen).toEqual({ ids: [1, 2], opened: 2 })
    expect(pool.idleCount).toBe(2)
  })

  it("serves pg's callback-form checkout from the reservation", async () => {
    const pool = stubPool(2)

    const clientId = await withReservedPoolClients(database(pool), 1, () =>
      plainRead(pool),
    )

    expect(clientId).toBe(1)
    expect(pool.totalCount).toBe(1)
  })

  it('keeps a client the work returned for its next checkout', async () => {
    const pool = stubPool(3)

    const opened = await withReservedPoolClients(database(pool), 2, async () => {
      // A plain read before the consumer's transaction, as Inbox does.
      await plainRead(pool)
      const first = await pool.connect()
      const second = await pool.connect()
      first.release()
      second.release()
      return pool.totalCount
    })

    expect(opened).toBe(2)
  })

  it('refuses a second release of a lent client, as pg-pool does', async () => {
    const pool = stubPool(2)

    await withReservedPoolClients(database(pool), 2, async () => {
      const client = await pool.connect()
      client.release()
      expect(() => client.release()).toThrow(/already been released/)
    })
    expect(pool.idleCount).toBe(2)
  })

  it('lets a client released with an error leave the reservation', async () => {
    const pool = stubPool(3)

    const reopened = await withReservedPoolClients(database(pool), 2, async () => {
      const broken = await pool.connect()
      broken.release(new Error('connection lost'))
      const first = await pool.connect()
      const second = await pool.connect()
      first.release()
      second.release()
      return [stub(first).id, stub(second).id].includes(stub(broken).id)
    })

    expect(reopened).toBe(false)
    expect(pool.totalCount).toBe(2)
  })

  it('does not lend again a client whose connection is no longer usable', async () => {
    const pool = stubPool(3)

    const reused = await withReservedPoolClients(database(pool), 2, async () => {
      const dead = await pool.connect()
      stub(dead)._queryable = false
      // Drizzle releases without an error, even after a failed rollback.
      dead.release()
      const first = await pool.connect()
      const second = await pool.connect()
      first.release()
      second.release()
      return [stub(first).id, stub(second).id].includes(stub(dead).id)
    })

    expect(reused).toBe(false)
  })

  it('survives a reserved client losing its connection while it waits', async () => {
    const pool = stubPool(3)

    const reused = await withReservedPoolClients(database(pool), 2, async () => {
      const first = await pool.connect()
      const waiting = StubClient.instances[1]!
      // pg emits `error` on a client whose server went away. Unheard, that
      // event would be an uncaught exception.
      expect(() =>
        waiting.emit('error', new Error('terminating connection')),
      ).not.toThrow()
      const second = await pool.connect()
      first.release()
      second.release()
      return stub(second).id === waiting.id
    })

    expect(reused).toBe(false)
  })

  it('releases the clients the work never used', async () => {
    const pool = stubPool(2)

    await withReservedPoolClients(database(pool), 2, async () => 'obsolete')

    expect(pool.idleCount).toBe(2)
  })

  it('releases the reservation when the work fails', async () => {
    const pool = stubPool(2)

    await expect(
      withReservedPoolClients(database(pool), 2, async () => {
        throw new Error('consumer failed')
      }),
    ).rejects.toThrow('consumer failed')
    expect(pool.idleCount).toBe(2)
  })

  it('leaves a checkout another job makes meanwhile on the pool', async () => {
    const pool = stubPool(2)
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    // Another job: its continuation belongs to its own context, not the work's.
    const otherJob = (async () => {
      await gate
      return plainRead(pool)
    })()

    await withReservedPoolClients(database(pool), 2, async () => {
      open()
      await new Promise((resolve) => setImmediate(resolve))
      // Both clients are reserved, so the other job queues on the pool.
      expect(pool.waitingCount).toBe(1)
    })

    await expect(otherJob).resolves.toEqual(expect.any(Number))
  })

  it('acquires one reservation at a time, so two half-held ones cannot starve each other', async () => {
    const pool = stubPool(2)
    const unit = () =>
      withReservedPoolClients(database(pool), 2, async () => {
        const client = await pool.connect()
        client.release()
        return stub(client).id
      })

    // Without the queue each takes one client and waits for the other's forever.
    await expect(Promise.all([unit(), unit()])).resolves.toEqual([
      expect.any(Number),
      expect.any(Number),
    ])
    expect(pool.idleCount).toBe(2)
  })

  it('returns a partial reservation and lets the next one proceed when a checkout fails', async () => {
    const pool = stubPool(2)
    const refusal = new Error('connection refused')
    const first = await pool.connect()
    first.release()
    StubClient.refuseNextConnect = refusal

    await expect(
      withReservedPoolClients(database(pool), 2, async () => 'never'),
    ).rejects.toBe(refusal)
    await expect(
      withReservedPoolClients(database(pool), 2, async () => 'next'),
    ).resolves.toBe('next')
    expect(pool.idleCount).toBe(2)
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
