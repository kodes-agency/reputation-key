// PROTOTYPE — Three variants of the concept-D Settings, switchable via ?variant=, with
// ?props=1|5|60|real and ?role=aa|pm fixtures, on /settings-prototype (PROTOTYPE — delete
// after the decision). No tests, no persistence, every Save is a stub. Question it
// answers: does "Settings works out its own shape from role and property count" feel
// right at 1 / 5 / 60 properties, as AccountAdmin and as PropertyManager, and which of
// three layouts carries it best? Brief: scratchpad/settings-brainstorm/settings-brainstorm.md
// (section 4.D). Delete this route, src/components/features/settings-prototype/,
// src/components/prototype/ and the two shell hooks in _authenticated.tsx when decided.
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  SettingsPrototypePage,
  settingsPrototypeSearchSchema,
} from '#/components/features/settings-prototype'
import { propertiesQuery } from '#/routes/-queries/route-queries'

export const Route = createFileRoute('/_authenticated/settings-prototype')({
  staticData: { page: { title: 'Settings (prototype)', tier: 'standard' } },
  // Dev only: a production build answers as if the page did not exist.
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound()
  },
  validateSearch: (search) => settingsPrototypeSearchSchema.parse(search),
  component: SettingsPrototypeRoute,
})

function SettingsPrototypeRoute() {
  const search = Route.useSearch()
  const { user, activeOrganization } = Route.useRouteContext()
  const { data } = useSuspenseQuery(propertiesQuery)
  return (
    <SettingsPrototypePage
      search={search}
      organizationName={activeOrganization?.name ?? 'Your workspace'}
      user={user}
      properties={data.properties}
    />
  )
}
