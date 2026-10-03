import { Link } from '@tanstack/react-router'
import { AlertCircle } from 'lucide-react'
import { PageShell } from '#/components/layout/page-shell'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'

/**
 * The Property layout's answer when the Property it was opened for is missing.
 * It is the only one: the pages below the layout receive a Property that
 * exists and render no blank state of their own. The way out is the Properties
 * list, not a retry, because nothing about this page can succeed on a second try.
 */
export function PropertyNotFound() {
  return (
    <PageShell>
      <EmptyState icon={AlertCircle} title="Property not found.">
        <Button variant="outline" size="sm" asChild>
          <Link to="/properties">Back to Properties</Link>
        </Button>
      </EmptyState>
    </PageShell>
  )
}
