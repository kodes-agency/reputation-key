// Identity context — ambient request context port.
//
// ARC-03-T13. Two places used to reach the web framework directly for the
// current request's headers: the composition root and the better-auth identity
// adapter, each with its own dynamic import of the web framework's server runtime.
// A framework call inside infrastructure (and inside the root) means the
// container cannot be built deterministically in a worker or process fixture.
//
// Identity declares WHAT it needs — the current request's headers, or empty
// ones outside a server context — and the composition boundary supplies the
// framework-specific adapter.

export type RequestContextPort = Readonly<{
  /**
   * Headers carrying the current request's cookies/headers, or an EMPTY Headers
   * object when there is no server request context (worker, job, fixture).
   * Never throws: absence of a request is a normal state, not a failure.
   */
  currentRequestHeaders: () => Promise<Headers>
}>
