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
  return (
    <div
      className={
        embedded
          ? 'mx-auto flex min-h-[70svh] w-full max-w-md flex-col'
          : 'mx-auto flex min-h-svh w-full max-w-md flex-col'
      }
    >
      <header className="flex min-w-0 items-center justify-between gap-3 border-b px-4 py-2">
        {home.participations.length > 1 ? (
          <Select
            value={participation.participationId}
            onValueChange={(p) => onSearch({ ...search, p, tab: 'code' })}
          >
            <SelectTrigger variant="property" aria-label="Property">
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
        ) : (
          <p className="min-w-0 break-words font-semibold">
            {participation.propertyName}
          </p>
        )}
        <StaffAccountMenu fns={fns} />
      </header>
      <h1 className="sr-only">My code</h1>
      <Tabs
        value={search.tab}
        onValueChange={(tab) => {
          if (tab === 'code' || tab === 'results') onSearch({ ...search, tab })
        }}
        className="flex-1"
      >
        <div className="flex flex-1 flex-col justify-center p-4">
          <TabsContent value="code" placement="center">
            <StaffCode
              key={participation.participationId}
              participationId={participation.participationId}
              propertyName={participation.propertyName}
              read={fns.getMyCode}
            />
          </TabsContent>
          <TabsContent value="results">
            <StaffResults
              participation={participation}
              period={search.period}
              onPeriod={(period) => onSearch({ ...search, period })}
              fns={fns}
            />
          </TabsContent>
        </div>
        <TabsList variant="bottom" aria-label="Your code and results">
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="results">My results</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  )
}
