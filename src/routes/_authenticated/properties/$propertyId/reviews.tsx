import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/reviews')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/inbox',
      search: { propertyId: params.propertyId },
    })
  },
})
