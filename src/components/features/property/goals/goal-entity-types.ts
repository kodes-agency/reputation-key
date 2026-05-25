// Structural types for entity pickers in goal create forms
// Avoids importing domain types from the components layer
export type PortalOption = Readonly<{ id: string; name: string }>
export type TeamOption = Readonly<{ id: string; name: string }>
export type StaffOption = Readonly<{ id: string; userId: string }>
