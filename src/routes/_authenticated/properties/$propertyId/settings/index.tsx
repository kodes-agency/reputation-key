import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/properties/$propertyId/settings/profile',
      params,
      replace: true,
    })
  },
})
