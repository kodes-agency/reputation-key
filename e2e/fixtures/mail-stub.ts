// BQC-6.7 — deterministic mail (Resend) stub server: the fake identity outbox.
//
// A small dependency-free node:http server that serves the ONE HTTP surface
// the app's real Resend client calls: `POST /emails` (resend.emails.send).
// The app runs its production client against this stub through the BQC-6.7
// operator sandbox seam (RESEND_BASE_URL, see src/shared/config/env.ts +
// src/shared/auth/emails.ts) — no fake mailers are injected anywhere, and
// nothing ever calls the real Resend API in e2e.
//
// Every send is RECORDED (to / from / subject / html) so specs assert
// DELIVERY INTENT + CONTENT CLASSIFICATION without a provider: exactly-one
// send, correct recipient, and the subject classifies the mail kind (the
// app's subjects are distinct per kind — see emails.ts):
//   verification : 'Verify your email — Reputation Key'
//   reset        : 'Reset your password — Reputation Key'
//   invitation   : '<inviter> invited you to join <org>'
//
// Control surface (never recorded):
//   GET  /__control/health        → 200 'ok'
//   GET  /__control/sends         → recorded sends
//   POST /__control/reset         → clear recorded sends + restore success mode
//   POST /__control/failure-mode  body: FailureMode — script send failures
//
// Failure modes:
//   { mode: 'success' }              → POST /emails → 200 { id }
//   { mode: 'always-fail', status }  → POST /emails → status (Resend error body)
//
// Harness scope note (6.2): mail sends are SERVER→stub traffic (the Resend
// client runs in the web/worker processes) and control calls come from the
// Playwright runner process via fetch — neither ever surfaces as a browser
// page event, so request-log's assertNoExternalHosts and the error-detection
// mutation gate never see the stub. No allowlist entries are needed.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export const MAIL_STUB_PORT = 4101
export const MAIL_STUB_BASE_URL =
  process.env.MAIL_STUB_BASE_URL ?? `http://localhost:${MAIL_STUB_PORT}`

/**
 * BQC-6.7 sandbox env: point the app's Resend client at the stub. Spread into
 * the web + worker process env by the Playwright harness.
 */
export const MAIL_SANDBOX_ENV = {
  RESEND_BASE_URL: MAIL_STUB_BASE_URL,
} as const

export type RecordedSend = Readonly<{
  at: string
  to: string
  from: string
  subject: string
  html: string
}>

export type FailureMode =
  Readonly<{ mode: 'success' }> | Readonly<{ mode: 'always-fail'; status: number }>

export type MailStub = Readonly<{
  host: string
  port: number
  stop: () => Promise<void>
}>

type SendPayload = Readonly<{
  from?: string
  to?: string | string[]
  subject?: string
  html?: string
}>

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? {})
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export async function startMailStub(
  port: number = MAIL_STUB_PORT,
  host: string = '127.0.0.1',
): Promise<MailStub> {
  const sends: RecordedSend[] = []
  let failureMode: FailureMode = { mode: 'success' }
  let sequence = 0
  const MAX_RECORDED = 10_000

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      const method = req.method ?? 'GET'
      const path = url.pathname
      const body = method === 'GET' ? '' : await readBody(req)

      // ── Control surface (never recorded) ──
      if (path === '/__control/health' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('ok')
        return
      }
      if (path === '/__control/sends' && method === 'GET') {
        json(res, 200, { sends })
        return
      }
      if (path === '/__control/reset' && method === 'POST') {
        sends.length = 0
        failureMode = { mode: 'success' }
        json(res, 200, { ok: true })
        return
      }
      if (path === '/__control/failure-mode' && method === 'POST') {
        failureMode = JSON.parse(body) as FailureMode
        json(res, 200, { ok: true })
        return
      }

      // ── Resend API surface ──
      if (path === '/emails' && method === 'POST') {
        if (failureMode.mode === 'always-fail') {
          // Mirror the Resend error body shape the SDK parses into { error }.
          json(res, failureMode.status, {
            name: 'application_error',
            statusCode: failureMode.status,
            message: 'Scripted mail failure',
          })
          return
        }
        const payload = JSON.parse(body || '{}') as SendPayload
        if (sends.length < MAX_RECORDED) {
          sends.push({
            at: new Date().toISOString(),
            to: Array.isArray(payload.to) ? payload.to.join(',') : (payload.to ?? ''),
            from: payload.from ?? '',
            subject: payload.subject ?? '',
            html: payload.html ?? '',
          })
        }
        sequence += 1
        json(res, 200, { id: `stub-email-${sequence}` })
        return
      }

      json(res, 404, { error: `Stub has no route for ${method} ${path}` })
    })().catch((err) => {
      json(res, 500, { error: String(err) })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })

  return {
    host,
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

// ── Control client (used by specs + orchestration) ────────────────────

async function controlFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${MAIL_STUB_BASE_URL}${path}`, init)
  if (!res.ok) {
    throw new Error(
      `Mail stub control ${path} failed: HTTP ${res.status} ${await res.text()}`,
    )
  }
  return res
}

export const mailStubControl = {
  async health(): Promise<void> {
    await controlFetch('/__control/health')
  },

  async sends(): Promise<RecordedSend[]> {
    const res = await controlFetch('/__control/sends')
    const body = (await res.json()) as { sends: RecordedSend[] }
    return body.sends
  },

  async setFailureMode(mode: FailureMode): Promise<void> {
    await controlFetch('/__control/failure-mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mode),
    })
  },

  async reset(): Promise<void> {
    await controlFetch('/__control/reset', { method: 'POST' })
  },
}
