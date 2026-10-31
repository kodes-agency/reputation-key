import { propertyIdFromLocation } from '#/components/hooks/use-property-id'
import { getProductUpdatesClient } from './-product-updates-client'
import { createFileRoute } from '@tanstack/react-router'
import { ProductUpdatesHistory } from '#/components/features/whats-new'

export const Route = createFileRoute('/_authenticated/whats-new')({
  staticData: { page: { title: "What's new", tier: 'narrow' } },
  validateSearch: (search: Record<string, unknown>): { propertyId?: string } => ({
    propertyId: propertyIdFromLocation('/', search) ?? undefined,
  }),
  component: () => <ProductUpdatesHistory getClient={getProductUpdatesClient} />,
})
