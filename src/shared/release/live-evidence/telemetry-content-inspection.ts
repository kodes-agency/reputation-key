/**
 * `preproduction.observability_content_inspection` — proof that no customer
 * content reached any telemetry sink.
 *
 * The failure mode this refuses is a partial inspection: someone greps the
 * Sentry export, finds nothing, and files that as "observability inspected"
 * while structured logs, metric labels, the fact stream, and notification
 * payloads went unchecked. Every sink in `TELEMETRY_INSPECTED_SINKS` must be
 * NAMED, with its own inspected-record count and its own occurrence count, and
 * the total must be zero.
 */

import { z } from 'zod/v4'
import {
  parseCanonicalReleaseEvidence,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from '../candidate-bound-evidence'
import {
  LIVE_EVIDENCE_VERSIONS,
  liveEvidenceBaseSchema,
  liveEvidenceCommonIssues,
  liveEvidenceTextSchema,
} from './common'

export const TELEMETRY_CONTENT_INSPECTION_EVIDENCE_VERSION =
  LIVE_EVIDENCE_VERSIONS['preproduction.observability_content_inspection']

/** Every sink that can carry a payload out of the application boundary. */
export const TELEMETRY_INSPECTED_SINKS = [
  'sentry',
  'structured_log',
  'metric',
  'fact_stream',
  'notification',
] as const
export type TelemetryInspectedSink = (typeof TELEMETRY_INSPECTED_SINKS)[number]

/** The field classes that must never appear in telemetry. */
export const TELEMETRY_PROHIBITED_FIELD_CLASSES = [
  'review_text',
  'reply_text',
  'reviewer_name',
  'guest_contact',
  'end_user_email',
  'provider_access_token',
] as const

const sinkInspectionSchema = z
  .object({
    sink: z.enum(TELEMETRY_INSPECTED_SINKS),
    exportSha256: releaseEvidenceSha256Schema,
    inspectedRecordCount: z.number().int().safe().positive(),
    prohibitedFieldOccurrences: z.number().int().safe().nonnegative(),
    windowStartedAt: releaseEvidenceTimestampSchema,
    windowEndedAt: releaseEvidenceTimestampSchema,
    summary: liveEvidenceTextSchema,
  })
  .strict()

const telemetryContentInspectionEvidenceSchema = liveEvidenceBaseSchema(
  TELEMETRY_CONTENT_INSPECTION_EVIDENCE_VERSION,
  'telemetry-content-inspection',
)
  .extend({
    inspectedFieldClasses: z
      .array(z.enum(TELEMETRY_PROHIBITED_FIELD_CLASSES))
      .min(TELEMETRY_PROHIBITED_FIELD_CLASSES.length),
    sinks: z.array(sinkInspectionSchema).min(TELEMETRY_INSPECTED_SINKS.length),
  })
  .strict()
  .superRefine((value, context) => {
    liveEvidenceCommonIssues(value, context)
    for (const fieldClass of TELEMETRY_PROHIBITED_FIELD_CLASSES) {
      if (!value.inspectedFieldClasses.includes(fieldClass)) {
        context.addIssue({
          code: 'custom',
          path: ['inspectedFieldClasses'],
          message: `missing required prohibited-field class ${fieldClass}`,
        })
      }
    }
    const named = value.sinks.map(({ sink }) => sink)
    if (new Set(named).size !== named.length) {
      context.addIssue({
        code: 'custom',
        path: ['sinks'],
        message: 'duplicate telemetry sink',
      })
    }
    for (const sink of TELEMETRY_INSPECTED_SINKS) {
      if (!named.includes(sink)) {
        context.addIssue({
          code: 'custom',
          path: ['sinks'],
          message: `missing required inspected sink ${sink}`,
        })
      }
    }
    let total = 0
    for (const [index, sink] of value.sinks.entries()) {
      total += sink.prohibitedFieldOccurrences
      if (Date.parse(sink.windowEndedAt) < Date.parse(sink.windowStartedAt)) {
        context.addIssue({
          code: 'custom',
          path: ['sinks', index, 'windowEndedAt'],
          message: 'inspection window ends before it starts',
        })
      }
      if (sink.prohibitedFieldOccurrences !== 0 && value.outcome === 'passed') {
        context.addIssue({
          code: 'custom',
          path: ['sinks', index, 'prohibitedFieldOccurrences'],
          message: `sink ${sink.sink} carried prohibited content`,
        })
      }
    }
    if (value.outcome === 'passed' && total !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['sinks'],
        message: 'passed inspection requires zero prohibited-field occurrences overall',
      })
    }
    if (total !== value.redaction.prohibitedFieldOccurrences) {
      context.addIssue({
        code: 'custom',
        path: ['redaction', 'prohibitedFieldOccurrences'],
        message: 'per-sink occurrences must reconcile with the redaction total',
      })
    }
  })

export type TelemetryContentInspectionEvidence = z.infer<
  typeof telemetryContentInspectionEvidenceSchema
>

export function parseTelemetryContentInspectionEvidence(
  content: string,
): CanonicalReleaseEvidenceParseResult<TelemetryContentInspectionEvidence> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: telemetryContentInspectionEvidenceSchema,
    label: 'Telemetry content inspection evidence',
  })
}
