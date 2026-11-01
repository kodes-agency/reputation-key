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
  get getMyStaffHome() {
    return getMyStaffHome
  },
  get getMyCode() {
    return getMyCode
  },
  get acknowledgeStaffNotice() {
    return acknowledgeStaffNotice
  },
  get getMyResults() {
    return getMyResults
  },
  get getMyGoals() {
    return getMyGoals
  },
  get getMyColleagues() {
    return getMyColleagues
  },
  get changePassword() {
    return changePassword
  },
  get submitFeedback() {
    return submitMyStaffFeedback
  },
  get listFeedback() {
    return listMyStaffFeedback
  },
}
