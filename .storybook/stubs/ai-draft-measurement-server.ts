// Browser stub for #/contexts/ai/server/draft-measurement.
//
// use-reply-actions.ts (measureDraft) loads the measurement server function with a dynamic
// import so it stays out of first paint. In the Storybook Vite build the real
// module would leak @tanstack/start-server-core (createServerFn and
// #/composition), like #/contexts/review/server/reply, so it is aliased here
// (see .storybook/main.ts). Measurement is advisory and content-free; stories
// record nothing.
export const recordDraftMeasurementFn = async (): Promise<void> => {}
