import { describe, expect, it } from 'vitest'
import { refusingGoneLookImage } from './portal-copied-content'

const foreignKeyViolation = (constraint: string) =>
  Object.assign(new Error('insert or update violates foreign key constraint'), {
    code: '23503',
    constraint,
  })

describe('refusingGoneLookImage', () => {
  it.each(['portal_look_overrides_hero_asset_fk', 'portal_look_overrides_logo_asset_fk'])(
    'answers %s as a refusal the manager can retry, not a fault',
    async (constraint) => {
      await expect(
        refusingGoneLookImage(async () => {
          throw foreignKeyViolation(constraint)
        }),
      ).rejects.toMatchObject({ code: 'revision_conflict' })
    },
  )

  it('lets any other failure through as it was', async () => {
    const other = foreignKeyViolation('portal_links_category_tenant_fk')
    await expect(
      refusingGoneLookImage(async () => {
        throw other
      }),
    ).rejects.toBe(other)
  })

  it('finishes quietly when the commit does', async () => {
    await expect(refusingGoneLookImage(async () => undefined)).resolves.toBeUndefined()
  })
})
