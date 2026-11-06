import { ensureActiveOrg } from '#/shared/auth/auth.functions'
import {
  getMyStaffHome,
  getMyCode,
  acknowledgeStaffNotice,
} from '#/contexts/identity/server/staff-self'
import {
  getMyResults,
  getMyGoals,
  getMyColleagues,
} from '#/contexts/reporting/server/staff-self-results'
import {
  changeMyStaffPassword,
  submitMyStaffFeedback,
  listMyStaffFeedback,
} from '#/contexts/identity/server/staff-self-account'

async function changePassword(input: Parameters<typeof changeMyStaffPassword>[0]) {
  await changeMyStaffPassword(input)
  await ensureActiveOrg()
}

export const staffHomeFns = {
  getMyStaffHome,
  getMyCode,
  acknowledgeStaffNotice,
  getMyResults,
  getMyGoals,
  getMyColleagues,
  changePassword,
  submitFeedback: submitMyStaffFeedback,
  listFeedback: listMyStaffFeedback,
}
