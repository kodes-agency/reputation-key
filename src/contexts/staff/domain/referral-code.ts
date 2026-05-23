export type RandomBytesFn = (size: number) => Buffer

/**
 * Generate a unique referral code from a staff member's name.
 * Format: `{name-slug}-{4-char-hash}` (e.g., `jane-d-a3f2`).
 *
 * Slug: first name + last name, lowercased, non-alpha/hyphen stripped.
 * Hash: 4 hex chars from random bytes, ensuring uniqueness across collisions.
 */
export const generateReferralCode = (
  fullName: string,
  randomBytesFn: RandomBytesFn,
): string => {
  const slug = buildSlug(fullName)
  const hash = randomBytesFn(2).toString('hex')
  return `${slug}-${hash}`
}

function buildSlug(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'staff'
  if (parts.length === 1) {
    return parts[0]
      .toLowerCase()
      .replace(/[^a-z-]/g, '')
      .replace(/-+/g, '-')
  }

  const first = parts[0]
    .toLowerCase()
    .replace(/[^a-z-]/g, '')
    .replace(/-+/g, '-')
  const last = parts[parts.length - 1]
    .toLowerCase()
    .replace(/[^a-z-]/g, '')
    .replace(/-+/g, '-')
  return `${first}-${last}`
}
