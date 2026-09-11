import { describe, expect, it } from 'vitest'
import { Route } from './insights'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'

describe('Property insights redirect', () => {
  it('sends a bookmarked /insights link to Guest voice', async () => {
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('The insights route must define beforeLoad')

    await expect(
      Promise.resolve().then(() =>
        beforeLoad({ params: { propertyId: PROPERTY_ID } } as never),
      ),
    ).rejects.toMatchObject({
      options: {
        to: '/properties/$propertyId/guests',
        params: { propertyId: PROPERTY_ID },
        replace: true,
      },
    })
  })
})
