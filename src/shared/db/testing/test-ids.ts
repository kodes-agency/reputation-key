import { randomUUID } from 'node:crypto'

/** A fresh UUID for rows a test seeds; production code takes ids from its injected generator. */
export const newTestUuid = (): string => randomUUID()
