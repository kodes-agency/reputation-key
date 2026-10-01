// In-memory object store fake — the put, get and delete parts of StoragePort.

import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'

export type InMemoryObjectStore = Pick<
  StoragePort,
  'putObject' | 'getObject' | 'deleteObject'
> &
  Readonly<{
    objects: () => ReadonlyMap<string, { body: Buffer; contentType: string }>
    failNextPut: (error: Error) => void
    failNextDelete: (error: Error) => void
    failNextGet: (error: Error) => void
  }>

export const createInMemoryObjectStore = (): InMemoryObjectStore => {
  const objects = new Map<string, { body: Buffer; contentType: string }>()
  let putFailure: Error | null = null
  let deleteFailure: Error | null = null
  let getFailure: Error | null = null
  return {
    putObject: async (key, body, contentType) => {
      if (putFailure) {
        const failure = putFailure
        putFailure = null
        throw failure
      }
      objects.set(key, { body, contentType })
    },
    getObject: async (key, maxBytes) => {
      if (getFailure) {
        const failure = getFailure
        getFailure = null
        throw failure
      }
      const object = objects.get(key)
      if (!object) return null
      if (object.body.length > maxBytes) throw new Error('object larger than allowed')
      return { body: new Uint8Array(object.body), contentType: object.contentType }
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
    failNextGet: (error) => {
      getFailure = error
    },
  }
}
