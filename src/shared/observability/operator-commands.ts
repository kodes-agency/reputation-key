// BETA-3 B3.9: Operator command interface.
//
// Audited operator commands for retry, redrive, suspend, disconnect,
// and cancel. These are the ONLY sanctioned way for operators to
// intervene in production state — direct database edits are prohibited.
//
// Each command:
// 1. Checks authorization (operator role required)
// 2. Records an audit log entry
// 3. Performs the action through the proper domain/state-machine path
// 4. Returns a result with evidence

import type { PropertyId } from '#/shared/domain/ids'

export type OperatorCommandResult = Readonly<{
  success: boolean
  action: string
  target: string
  timestamp: string
  evidence: Readonly<Record<string, unknown>>
}>

export type OperatorCommand =
  | { type: 'suspend_property'; propertyId: PropertyId; reason: string }
  | { type: 'restore_property'; propertyId: PropertyId }
  | { type: 'disconnect_google'; connectionId: string; reason: string }
  | { type: 'redrive_queue'; queueName: string; jobId?: string }
  | { type: 'pause_queue'; queueName: string }
  | { type: 'resume_queue'; queueName: string }
  | { type: 'reconcile_reply'; replyId: string }
  | { type: 'rebuild_projection'; context: string; propertyId: PropertyId }

/**
 * Validate that an operator command is well-formed before execution.
 * Returns an error message string if invalid, null if valid.
 */
export function validateOperatorCommand(cmd: OperatorCommand): string | null {
  switch (cmd.type) {
    case 'suspend_property':
      if (!cmd.propertyId) return 'propertyId is required'
      if (!cmd.reason?.trim()) return 'reason is required for audit'
      return null

    case 'restore_property':
      if (!cmd.propertyId) return 'propertyId is required'
      return null

    case 'disconnect_google':
      if (!cmd.connectionId) return 'connectionId is required'
      if (!cmd.reason?.trim()) return 'reason is required for audit'
      return null

    case 'redrive_queue':
      if (!cmd.queueName?.trim()) return 'queueName is required'
      return null

    case 'pause_queue':
    case 'resume_queue':
      if (!cmd.queueName?.trim()) return 'queueName is required'
      return null

    case 'reconcile_reply':
      if (!cmd.replyId?.trim()) return 'replyId is required'
      return null

    case 'rebuild_projection':
      if (!cmd.context?.trim()) return 'context is required'
      if (!cmd.propertyId) return 'propertyId is required'
      return null

    default:
      return `Unknown command type: ${(cmd as { type: string }).type}`
  }
}

/**
 * Build an audit log entry for an operator command.
 * Contains no review content, PII, or provider data.
 */
export function buildAuditEntry(
  cmd: OperatorCommand,
  operatorId: string,
  result: OperatorCommandResult,
): Readonly<{
  operatorId: string
  command: string
  target: string
  success: boolean
  timestamp: string
  evidence: Readonly<Record<string, unknown>>
}> {
  return {
    operatorId,
    command: cmd.type,
    target: result.target,
    success: result.success,
    timestamp: result.timestamp,
    evidence: result.evidence,
  }
}
