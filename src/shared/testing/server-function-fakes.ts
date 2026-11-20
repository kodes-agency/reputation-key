// The fakes the server-function harness hands the container in place of what
// lies outside the process, with handles a test reads and steers.

import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import type { InvitationEmailParams } from '#/shared/auth/emails'
import type { Clock } from '#/shared/domain/clock'
import {
  createInMemoryGoogleOAuthPort,
  type InMemoryGoogleOAuthPort,
} from './in-memory-google-oauth-port'
import {
  createInMemoryObjectStore,
  type InMemoryObjectStore,
} from './in-memory-object-store'
import { createInMemoryQueue, type InMemoryQueue } from './in-memory-queue'

export type InMemoryStorage = StoragePort &
  Pick<InMemoryObjectStore, 'objects' | 'failNextPut' | 'failNextGet' | 'failNextDelete'>

/** Sent emails, in order, and a way to make the next send fail. */
export type CapturedEmail = Readonly<{
  send: (params: InvitationEmailParams) => Promise<void>
  captured: () => ReadonlyArray<InvitationEmailParams>
  failNext: (error: Error) => void
  clear: () => void
}>

export type HarnessQueues = Readonly<{
  default: InMemoryQueue
  background: InMemoryQueue
  opsDomainEvents: InMemoryQueue
  opsBackground: InMemoryQueue
  opsQuarantine: InMemoryQueue
}>

export type HarnessFakes = Readonly<{
  storage: InMemoryStorage
  googleOAuth: InMemoryGoogleOAuthPort
  email: CapturedEmail
  queues: HarnessQueues
}>

/** In-memory storage that answers every StoragePort call without a network. */
export function createInMemoryStorage(): InMemoryStorage {
  const store = createInMemoryObjectStore()
  return {
    ...store,
    createPresignedUploadUrl: async (key) => ({ uploadUrl: `memory://${key}`, key }),
    inspectObject: async (key) => {
      const object = store.objects().get(key)
      if (!object) throw new Error(`No object at ${key}`)
      return { contentType: object.contentType, sizeBytes: object.body.length }
    },
    confirmUpload: async (key) => {
      if (!store.objects().has(key)) throw new Error(`No object at ${key}`)
    },
    listObjects: async (prefix, maxKeys, startAfter) => {
      const keys = [...store.objects().keys()]
        .filter((key) => key.startsWith(prefix) && (!startAfter || key > startAfter))
        .sort()
      return {
        objects: keys.slice(0, maxKeys).map((key) => ({
          key,
          sizeBytes: store.objects().get(key)?.body.length ?? 0,
          lastModified: null,
        })),
        truncated: keys.length > maxKeys,
      }
    },
  }
}

export function createCapturedEmail(): CapturedEmail {
  const sent: InvitationEmailParams[] = []
  let failure: Error | null = null
  return {
    send: async (params) => {
      if (failure) {
        const error = failure
        failure = null
        throw error
      }
      sent.push(params)
    },
    captured: () => [...sent],
    failNext: (error) => {
      failure = error
    },
    clear: () => {
      sent.length = 0
      failure = null
    },
  }
}

export function createHarnessFakes(clock: Clock): HarnessFakes {
  return {
    storage: createInMemoryStorage(),
    googleOAuth: createInMemoryGoogleOAuthPort(),
    email: createCapturedEmail(),
    queues: {
      default: createInMemoryQueue({ clock }),
      background: createInMemoryQueue({ clock }),
      opsDomainEvents: createInMemoryQueue({ clock }),
      opsBackground: createInMemoryQueue({ clock }),
      opsQuarantine: createInMemoryQueue({ clock }),
    },
  }
}
