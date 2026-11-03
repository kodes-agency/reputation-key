import { ChartColumn, QrCode } from 'lucide-react'
import { StaffSurface } from './staff-surface'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '#/components/ui/tabs'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#/components/ui/select'
import { StaffAccountMenu } from './staff-account-menu'
import { StaffCode } from './staff-code'
import { StaffResults } from './staff-results'
import type {
  StaffHomeData,
  StaffHomeFns,
  StaffHomeSearch,
  StaffParticipation,
} from './types'

export function StaffHomeView({
  home,
  participation,
  search,
  onSearch,
  fns,
  embedded,
}: Readonly<{
  home: StaffHomeData
  participation: StaffParticipation
  search: StaffHomeSearch
  onSearch: (search: StaffHomeSearch) => void
  fns: StaffHomeFns
  embedded: boolean
}>) {
  const properties =
    home.participations.length > 1 ? (
      <Select
        value={participation.participationId}
        onValueChange={(p) => onSearch({ ...search, p })}
      >
        <SelectTrigger aria-label="Property">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {home.participations.map((row) => (
            <SelectItem key={row.participationId} value={row.participationId}>
              {row.propertyName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null
  return (
    <StaffSurface participation={participation} tab={search.tab} embedded={embedded}>
      <Tabs
        value={search.tab}
        onValueChange={(tab) => {
          if (tab === 'code' || tab === 'results') onSearch({ ...search, tab })
        }}
        className="staff-home__tabs"
      >
        <div className="staff-home__panels">
          <TabsContent value="code">
            <h1 className="sr-only">My code</h1>
            <div
              className="staff-code__frame"
              data-switch={properties ? true : undefined}
            >
              {properties}
              <StaffCode
                key={participation.participationId}
                participationId={participation.participationId}
                look={participation.look}
                name={participation.propertyName}
                read={fns.getMyCode}
                paused={participation.portalState === 'paused'}
              />
            </div>
          </TabsContent>
          <TabsContent value="results" data-results>
            <div className="staff-results">
              <header className="staff-results__head">
                <h1 className="staff-results__title">My results</h1>
                <StaffAccountMenu fns={fns} />
              </header>
              <StaffResults
                participation={participation}
                period={search.period}
                onPeriod={(period) => onSearch({ ...search, period })}
                fns={fns}
              >
                {properties}
              </StaffResults>
            </div>
          </TabsContent>
        </div>
        <TabsList variant="bottom" aria-label="Your code and results">
          <TabsTrigger value="code">
            <QrCode aria-hidden="true" />
            Code
          </TabsTrigger>
          <TabsTrigger value="results">
            <ChartColumn aria-hidden="true" />
            My results
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </StaffSurface>
  )
}
