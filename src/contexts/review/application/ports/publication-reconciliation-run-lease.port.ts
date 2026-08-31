/**
 * Cross-process exclusion for the provider-publication reconciliation sweep.
 * The implementation must retain ownership for the handle's whole lifetime;
 * a process-local boolean is not sufficient in a multi-replica deployment.
 */
export type PublicationReconciliationRunLeaseHandle = Readonly<{
  release: () => Promise<void>
}>

export type PublicationReconciliationRunLease = Readonly<{
  tryAcquire: () => Promise<PublicationReconciliationRunLeaseHandle | null>
}>
