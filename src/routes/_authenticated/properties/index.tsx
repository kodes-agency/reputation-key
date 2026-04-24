// Property list — shows all properties for the active organization
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { listProperties } from '#/contexts/property/server/properties'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/_authenticated/properties/')({
  component: PropertyListPage,
})

function PropertyListPage() {
  const query = useQuery({
    queryKey: ['properties'],
    queryFn: () => listProperties(),
  })

  const properties = query.data?.properties ?? []

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in rounded-2xl p-6 sm:p-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-1 text-2xl font-bold text-[var(--sea-ink)]">Properties</h1>
            <p className="text-[var(--sea-ink-soft)]">
              Manage your organization&apos;s properties and locations.
            </p>
          </div>
          <Link to="/properties/new">
            <Button>Add Property</Button>
          </Link>
        </div>

        {query.isLoading ? (
          <p className="text-sm text-[var(--sea-ink-soft)]">Loading…</p>
        ) : query.error ? (
          <p className="text-sm text-red-600">Failed to load properties.</p>
        ) : properties.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--line)] p-8 text-center">
            <p className="text-[var(--sea-ink-soft)]">No properties yet.</p>
            <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
              Add your first property to get started.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {properties.map((p) => (
              <li key={p.id}>
                <Link
                  to="/properties/$propertyId"
                  params={{ propertyId: p.id }}
                  className="block rounded-lg border border-[var(--line)] p-4 transition hover:bg-[var(--surface-strong)]"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-[var(--sea-ink)]">{p.name}</h3>
                      <p className="text-sm text-[var(--sea-ink-soft)]">
                        {p.slug} · {p.timezone}
                      </p>
                    </div>
                    <span className="text-xs text-[var(--sea-ink-soft)]">→</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
