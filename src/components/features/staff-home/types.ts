import type {
  getMyStaffHome,
  getMyCode,
  acknowledgeStaffNotice,
} from '#/contexts/identity/server/staff-self'
import type {
  getMyResults,
  getMyGoals,
  getMyColleagues,
} from '#/contexts/reporting/server/staff-self-results'
import type {
  changeMyStaffPassword,
  submitMyStaffFeedback,
  listMyStaffFeedback,
} from '#/contexts/identity/server/staff-self-account'
import type { StaffHomeSearch } from '#/shared/staff-home-search'

type Call<T extends (...args: never[]) => unknown> = (
  ...args: Parameters<T>
) => ReturnType<T>
export type StaffHomeFns = Readonly<{
  getMyStaffHome: Call<typeof getMyStaffHome>
  getMyCode: Call<typeof getMyCode>
  acknowledgeStaffNotice: Call<typeof acknowledgeStaffNotice>
  getMyResults: Call<typeof getMyResults>
  getMyGoals: Call<typeof getMyGoals>
  getMyColleagues: Call<typeof getMyColleagues>
  changePassword: Call<typeof changeMyStaffPassword>
  submitFeedback: Call<typeof submitMyStaffFeedback>
  listFeedback: Call<typeof listMyStaffFeedback>
}>
export type StaffHomeData = Awaited<ReturnType<StaffHomeFns['getMyStaffHome']>>
export type StaffParticipation = StaffHomeData['participations'][number]
export type StaffPeriod = StaffHomeSearch['period']
export type StaffResults = Awaited<ReturnType<StaffHomeFns['getMyResults']>>
export type StaffGoal = Awaited<ReturnType<StaffHomeFns['getMyGoals']>>['goals'][number]
export type StaffColleague = Awaited<
  ReturnType<StaffHomeFns['getMyColleagues']>
>['colleagues'][number]
export type { StaffHomeSearch }
