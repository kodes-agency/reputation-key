import { useState, useRef } from 'react'
import { StaffHome } from './staff-home'
import type { StaffHomeData, StaffHomeFns, StaffHomeSearch } from './types'

type StoryProps = Readonly<{
  width: number
  tab: 'code' | 'results'
  period: StaffHomeSearch['period']
  home: StaffHomeData
  fns: StaffHomeFns
  embedded?: boolean
}>
export function StaffStoryScreen({
  width,
  tab,
  period,
  home,
  fns,
  embedded,
}: StoryProps) {
  const [search, setSearch] = useState<StaffHomeSearch>({ tab, period })
  const acknowledged = useRef(false)
  return (
    <div style={{ width, maxWidth: '100%' }}>
      <StaffHome
        userId="polly"
        embedded={embedded}
        home={home}
        search={search}
        onSearch={setSearch}
        fns={{
          ...fns,
          getMyStaffHome: async () => ({
            participations: home.participations.map((row) => ({
              ...row,
              noticeAcknowledged: acknowledged.current || row.noticeAcknowledged,
            })),
          }),
          acknowledgeStaffNotice: async () => {
            acknowledged.current = true
            return { acknowledged: true }
          },
        }}
      />
    </div>
  )
}
