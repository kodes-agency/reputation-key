import { staffHomeSearch } from '#/shared/staff-home-search'
import { createLazyFileRoute } from '@tanstack/react-router'
import { StaffHome } from '#/components/features/staff-home'
import { staffHomeFns } from './-staff-home-fns'

export const Route = createLazyFileRoute('/my')({ component: StaffHomePage })

function StaffHomePage() {
  const { staffHome, staffUserId } = Route.useRouteContext()
  const search = staffHomeSearch(Route.useSearch())
  const navigate = Route.useNavigate()
  return (
    <main>
      <StaffHome
        userId={staffUserId}
        home={staffHome}
        search={search}
        fns={staffHomeFns}
        embedded={false}
        onSearch={(next) => void navigate({ search: next, replace: true })}
      />
    </main>
  )
}
