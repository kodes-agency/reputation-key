// What's new server functions, called as signed-in members over PostgreSQL with
// the real tenant resolution, execution policy and product-updates store.

import { describe, expect, it, vi } from 'vitest'
import {
  setupServerFunctionHarness,
  type TestMember,
} from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import {
  claimProductUpdatesAutoOpenFn,
  getProductUpdatesFn,
  markProductUpdatesSeenFn,
  setProductUpdatesAutoShowFn,
} from './product-updates'

// A day after a highlight every member can see, so the weekly auto-open is due
// for a member who joined before it, whatever today's date is.
const highlight = PRODUCT_UPDATES.find(
  (entry) =>
    entry.kind === 'highlight' && entry.audience === 'everyone' && !entry.requires,
)!
const DAY_MS = 86_400_000
const now = new Date(new Date(highlight.publishedOn).getTime() + DAY_MS)

const harness = setupServerFunctionHarness({ clock: () => now })

async function manager() {
  const organization = await harness.seedOrganization()
  const member = await harness.seedMember(organization, 'PropertyManager')
  return { organization, member }
}

async function receipts(member: TestMember): Promise<string[]> {
  const { rows } = await harness
    .pool()
    .query(`SELECT entry_id FROM product_update_receipts WHERE user_id = $1`, [
      member.userId,
    ])
  return rows.map((row) => row.entry_id as string)
}

async function settings(member: TestMember) {
  const { rows } = await harness
    .pool()
    .query(
      `SELECT auto_show, organization_id FROM product_update_settings WHERE user_id = $1`,
      [member.userId],
    )
  return rows as { auto_show: boolean; organization_id: string }[]
}

describe('getProductUpdatesFn', () => {
  it("answers the signed-in member's own view, whoever the input names", async () => {
    const { member } = await manager()

    const view = await harness.callAs(member, () =>
      getProductUpdatesFn({
        data: { userId: 'someone-else', organizationId: 'elsewhere' } as never,
      }),
    )

    expect(view.entries.length).toBeGreaterThan(0)
    expect(view.autoShow).toBe(true)
    expect(await settings(member)).toEqual([])
  })

  it('refuses a Property id that is not a UUID', async () => {
    const { member } = await manager()

    await expect(
      harness.callAs(member, () =>
        getProductUpdatesFn({ data: { propertyId: 'invalid' } }),
      ),
    ).rejects.toThrow(/propertyId|uuid/i)
  })

  it('refuses a staff-only login and a caller with no session', async () => {
    const { organization } = await manager()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(staff, () => getProductUpdatesFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    await expect(
      harness.callAs(null, () => getProductUpdatesFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })
})

describe('markProductUpdatesSeenFn', () => {
  it('records receipts for the entries the member can see and ignores the rest', async () => {
    const { member } = await manager()
    const view = await harness.callAs(member, () => getProductUpdatesFn({ data: {} }))
    const visible = view.entries[0]!.id

    await harness.callAs(member, () =>
      markProductUpdatesSeenFn({
        data: { entryIds: [visible, visible, 'not-an-entry'] },
      }),
    )

    expect(await receipts(member)).toEqual([visible])
    const after = await harness.callAs(member, () => getProductUpdatesFn({ data: {} }))
    expect(after.unseenIds).not.toContain(visible)
  })

  it('refuses more than 500 entries before anything is written', async () => {
    const { member } = await manager()

    await expect(
      harness.callAs(member, () =>
        markProductUpdatesSeenFn({
          data: { entryIds: Array.from({ length: 501 }, () => 'one') },
        }),
      ),
    ).rejects.toThrow(/too big|at most|500/i)

    expect(await receipts(member)).toEqual([])
  })

  it('writes nothing for a refused caller', async () => {
    const { organization } = await manager()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(staff, () =>
        markProductUpdatesSeenFn({ data: { entryIds: ['one'] } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    expect(await receipts(staff)).toEqual([])
  })
})

describe('setProductUpdatesAutoShowFn', () => {
  it("saves the member's own switch", async () => {
    const { organization, member } = await manager()

    await harness.callAs(member, () =>
      setProductUpdatesAutoShowFn({ data: { autoShow: false } }),
    )

    expect(await settings(member)).toEqual([
      { auto_show: false, organization_id: organization.id },
    ])
    const view = await harness.callAs(member, () => getProductUpdatesFn({ data: {} }))
    expect(view.autoShow).toBe(false)
  })

  it('refuses a switch that is not a boolean', async () => {
    const { member } = await manager()

    await expect(
      harness.callAs(member, () =>
        setProductUpdatesAutoShowFn({ data: { autoShow: 'yes' as never } }),
      ),
    ).rejects.toThrow(/boolean/i)
    expect(await settings(member)).toEqual([])
  })

  it('answers an unexpected database failure as a sanitized internal error', async () => {
    const { member } = await manager()
    const fault = `harness_fault_${member.userId.replace(/-/g, '_')}`
    // Refuses only this member's rows, so other tests are unaffected.
    await harness
      .pool()
      .query(
        `ALTER TABLE product_update_settings ADD CONSTRAINT "${fault}" CHECK (user_id <> '${member.userId}') NOT VALID`,
      )

    try {
      const failure = await harness
        .callAs(member, () => setProductUpdatesAutoShowFn({ data: { autoShow: false } }))
        .then(
          () => null,
          (error: unknown) => error as Error & { code: string; status: number },
        )

      expect(failure).toMatchObject({
        code: 'internal_error',
        status: 500,
        message: 'Internal server error',
      })
      expect(failure?.message).not.toContain(fault)
    } finally {
      await harness
        .pool()
        .query(`ALTER TABLE product_update_settings DROP CONSTRAINT "${fault}"`)
    }
    expect(await settings(member)).toEqual([])
  })

  it('writes nothing for a refused caller', async () => {
    const { organization } = await manager()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(staff, () =>
        setProductUpdatesAutoShowFn({ data: { autoShow: false } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    expect(await settings(staff)).toEqual([])
  })
})

describe('claimProductUpdatesAutoOpenFn', () => {
  it('claims at most once while the cool-down lasts', async () => {
    const { member } = await manager()
    await harness
      .pool()
      .query(`UPDATE member SET "createdAt" = '2000-01-01' WHERE "userId" = $1`, [
        member.userId,
      ])
    const view = await harness.callAs(member, () => getProductUpdatesFn({ data: {} }))
    expect(view.shouldAutoOpen).toBe(true)

    const first = await harness.callAs(member, () =>
      claimProductUpdatesAutoOpenFn({ data: {} }),
    )
    const second = await harness.callAs(member, () =>
      claimProductUpdatesAutoOpenFn({ data: {} }),
    )

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(await settings(member)).toHaveLength(1)
  })

  it('does not claim for a member who switched the pop-up off', async () => {
    const { member } = await manager()
    await harness
      .pool()
      .query(`UPDATE member SET "createdAt" = '2000-01-01' WHERE "userId" = $1`, [
        member.userId,
      ])
    await harness.callAs(member, () =>
      setProductUpdatesAutoShowFn({ data: { autoShow: false } }),
    )

    const claimed = await harness.callAs(member, () =>
      claimProductUpdatesAutoOpenFn({ data: {} }),
    )

    expect(claimed).toBe(false)
  })

  it('writes nothing for a refused caller', async () => {
    const { organization } = await manager()
    const staff = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(staff, () => claimProductUpdatesAutoOpenFn({ data: {} })),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
    expect(await settings(staff)).toEqual([])
  })
})
