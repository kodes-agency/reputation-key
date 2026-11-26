import { randomBytes, randomUUID } from 'node:crypto'

/** A new random UUID for test seeds; fixtures take it from here so they stay off ambient crypto and production ids stay with the injected generator. */
export const freshUuid = (): string => randomUUID()

/** Random base64url text of `bytes` random bytes, for test token bodies. */
export const freshBase64Url = (bytes: number): string =>
  randomBytes(bytes).toString('base64url')
