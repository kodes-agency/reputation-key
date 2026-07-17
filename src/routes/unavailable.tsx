// Intentional unavailable experience for dark beta features (BQC-2.6).
// Dark routes redirect here via gateDarkRoute instead of rendering a
// partially live shell.
import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { AuthCard } from '#/components/layout/auth-layout'

const unavailableSearch = z.object({
  feature: z.string().optional(),
})

export const Route = createFileRoute('/unavailable')({
  validateSearch: unavailableSearch,
  component: UnavailablePage,
})

function UnavailablePage() {
  const { feature } = useSearch({ from: '/unavailable' })
  return (
    <AuthCard
      title={feature ? `${feature} isn't available yet` : 'Not available in this beta'}
      description={
        feature
          ? `${feature} is disabled for the internal beta. It will be enabled in a later rollout.`
          : 'This part of the product is disabled for the internal beta.'
      }
    >
      <p className="text-sm">
        <Link to="/home" className="text-primary underline underline-offset-4">
          Back to home
        </Link>
      </p>
    </AuthCard>
  )
}
