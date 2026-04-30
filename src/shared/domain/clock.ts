// Clock port — injectable time source for testable time-dependent code.
// Infrastructure provides the real implementation; tests provide a fixed clock.

// fallow-ignore-next-line unused-type
export type Clock = Readonly<{
  now: () => Date
}>

// Clock implementations are inlined by consumers:
//   real:    () => new Date()
//   fixed:   (d) => () => d
//   advancing: (start, inc) => { let c = start.getTime(); return () => { const d = new Date(c); c += inc; return d; } }
// Keeping the type only avoids dead-code warnings for unused helpers.
