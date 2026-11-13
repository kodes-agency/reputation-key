/**
 * On since the owner-approved activation release. It went on after a read-only
 * per-rule trial on the beta, a check that every backup, including Manual, is
 * within the 30-day ceiling, and a check that no reply in an uncertain
 * publication state would lose its permit. Turning it off again takes another
 * owner-approved release; queue payloads and operator enqueue confirmation
 * cannot change it.
 */
export const SCHEDULED_RETENTION_ACTIVE: boolean = true
