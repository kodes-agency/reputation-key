export const INVITATION_ACTOR_LIMIT = Object.freeze({
  maxRequests: 20,
  windowSeconds: 60 * 60,
})
export const INVITATION_ORGANIZATION_LIMIT = Object.freeze({
  maxRequests: 100,
  windowSeconds: 24 * 60 * 60,
})
export const INVITATION_BUDGET_MESSAGE = `You can send ${INVITATION_ACTOR_LIMIT.maxRequests} invitations an hour and ${INVITATION_ORGANIZATION_LIMIT.maxRequests} a day. Try again in about an hour.`
