// Identity context — where an uploaded avatar or organization logo lives and
// what address it is shown at.
//
// The bucket is private and the provider is not AWS, so a provider URL is
// neither loadable nor ours to store. A user's image and an organization's logo
// are stored as a root-relative path on the app itself, which reads the object
// back from the bucket (GET /api/public/identity-assets/<key>). The path is
// resolved against whatever origin the app is opened on, so the stored value
// survives a change of domain, endpoint, region or provider.

/** The route that serves these images, without a trailing slash. */
export const IDENTITY_ASSET_PUBLIC_PATH = '/api/public/identity-assets'

const OWNER_ID = '[A-Za-z0-9_-]{1,64}'
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

// The two key shapes the request use cases issue, and nothing else: portal
// media, and any other object in the bucket, is never reachable from here.
const AVATAR_KEY = new RegExp(`^avatars/(${OWNER_ID})/(${UUID})$`)
const LOGO_KEY = new RegExp(`^organizations/(${OWNER_ID})/logo/(${UUID})$`)

export type IdentityAssetKey = Readonly<{
  kind: 'avatar' | 'logo'
  /** The user id (avatar) or organization id (logo) the key is scoped to. */
  ownerId: string
  /** The random id that makes every upload a new, immutable object. */
  objectId: string
}>

export const parseIdentityAssetKey = (key: string): IdentityAssetKey | null => {
  const avatar = AVATAR_KEY.exec(key)
  if (avatar) return { kind: 'avatar', ownerId: avatar[1]!, objectId: avatar[2]! }
  const logo = LOGO_KEY.exec(key)
  if (logo) return { kind: 'logo', ownerId: logo[1]!, objectId: logo[2]! }
  return null
}

export const isIdentityAssetKey = (key: string): boolean =>
  parseIdentityAssetKey(key) !== null

/** The address an object with this key is shown at: a path on the app itself. */
export const identityAssetPath = (key: string): string =>
  `${IDENTITY_ASSET_PUBLIC_PATH}/${key}`

/** The object key behind a stored address, or null when it is not one of ours. */
export const identityAssetKeyFromPath = (address: string): string | null => {
  const prefix = `${IDENTITY_ASSET_PUBLIC_PATH}/`
  if (!address.startsWith(prefix)) return null
  const key = address.slice(prefix.length)
  return isIdentityAssetKey(key) ? key : null
}

/** Whether an If-None-Match header names `etag` (weak comparison, as the spec asks for GET). */
export const ifNoneMatchMatches = (
  header: string | null | undefined,
  etag: string,
): boolean => {
  if (!header) return false
  if (header.trim() === '*') return true
  const bare = (value: string) => value.trim().replace(/^W\//u, '')
  return header.split(',').some((candidate) => bare(candidate) === etag)
}
