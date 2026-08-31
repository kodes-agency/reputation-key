export type InboxCtx = Readonly<{
  user?: Readonly<{
    id: string
  }>
  activeOrganization: {
    id: string
  } | null
}>
