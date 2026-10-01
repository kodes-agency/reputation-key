// Identity context — where an uploaded avatar or organization logo lives and
// what address it is shown at.
//
// The bucket is private and the provider is not AWS, so a provider URL is
// neither loadable nor ours to store. A user's image and an organization's logo
// are stored as an address on the app itself, which reads the object back from
// the bucket (GET /api/public/identity-assets/<key>). The key is the whole of
// the address, so the stored value stays valid when the bucket's endpoint,
// region or provider changes.

/** The route that serves these images, without a trailing slash. */
export const IDENTITY_ASSET_PUBLIC_PATH = '/api/public/identity-assets'

const OWNER_ID = '[A-Za-z0-9_-]{1,64}'
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

// The two key shapes the request use cases issue, and nothing else: portal
// media, and any other object in the bucket, is never reachable from here.
const IDENTITY_ASSET_KEY = new RegExp(
  `^(?:avatars/${OWNER_ID}/${UUID}|organizations/${OWNER_ID}/logo/${UUID})$`,
)

export const isIdentityAssetKey = (key: string): boolean => IDENTITY_ASSET_KEY.test(key)

/** The address an object with this key is shown at, on the app at `baseUrl`. */
export const identityAssetUrl = (baseUrl: string, key: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${IDENTITY_ASSET_PUBLIC_PATH}/${key}`
