// In-memory object store fake — the putObject/deleteObject part of StoragePort.

import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'

export type InMemoryObjectStore = Pick<StoragePort, 'putObject' | 'deleteObject'> &
  Readonly<{
    objects: () => ReadonlyMap<string, { body: Buffer; contentType: string }>
    failNextPut: (error: Error) => void
    failNextDelete: (error: Error) => void
  }>

export const createInMemoryObjectStore = (): InMemoryObjectStore => {
  const objects = new Map<string, { body: Buffer; contentType: string }>()
  let putFailure: Error | null = null
  let deleteFailure: Error | null = null
  return {
    putObject: async (key, body, contentType) => {
      if (putFailure) {
        const failure = putFailure
        putFailure = null
        throw failure
      }
      objects.set(key, { body, contentType })
    },
    deleteObject: async (key) => {
      if (deleteFailure) {
        const failure = deleteFailure
        deleteFailure = null
        throw failure
      }
      objects.delete(key)
    },
    objects: () => objects,
    failNextPut: (error) => {
      putFailure = error
    },
    failNextDelete: (error) => {
      deleteFailure = error
    },
  }
}
