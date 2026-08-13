// Integration context — GBP API port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// External API boundary for Google Business Profile operations.

export type GbpAccount = Readonly<{
  name: string
  accountName: string
  type: string
  role: string | null
}>

export type GbpApiPort = Readonly<{
  listAccounts: (accessToken: string) => Promise<ReadonlyArray<GbpAccount>>
}>
