// Job name constants for portal context.
// Defined in application layer (not infrastructure) so both application
// use cases and infrastructure job handlers can import without boundary
// violations (infra → application is allowed; application → infra is not).

export const PROCESS_IMAGE_JOB_NAME = 'process-image' as const
