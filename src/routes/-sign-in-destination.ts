import { getActiveOrganization } from '#/contexts/identity/server/organizations'

export async function signInDestination(): Promise<'/my' | '/properties'> {
  try {
    const org = await getActiveOrganization()
    return org.availability === 'staff' ? '/my' : '/properties'
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'beta_role_inactive')
      return '/my'
    throw error
  }
}
