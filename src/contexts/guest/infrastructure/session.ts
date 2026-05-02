import { createHash } from 'crypto'
import { getEnv } from '#/shared/config/env'

const COOKIE_NAME = 'guest_session'
const COOKIE_PATH = '/p/'
const COOKIE_MAX_AGE = 86400 // 24 hours

export function generateSessionId(): string {
  return crypto.randomUUID()
}

export function getSessionCookieOptions(): {
  httpOnly: true
  sameSite: 'lax'
  secure: true
  maxAge: number
  path: string
} {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: true,
    maxAge: COOKIE_MAX_AGE,
    path: COOKIE_PATH,
  }
}

export function hashIp(ip: string): string {
  const env = getEnv()
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const salt = `${env.GUEST_SESSION_SALT}:${today}`
  return createHash('sha256').update(`${ip}:${salt}`).digest('hex')
}

export const GUEST_SESSION_COOKIE = COOKIE_NAME
