import { randomUUID } from 'node:crypto'

/** A new random UUID for test seeds; Portal fixtures take it from here so they stay off ambient crypto. */
export const freshUuid = (): string => randomUUID()
