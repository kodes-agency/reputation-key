import { createServer as createHttpServer } from 'node:http'
import { connect, createServer } from 'node:net'

function port(name: string, fallback?: string): number {
  const raw = process.env[name] ?? fallback
  if (!raw || !/^[0-9]+$/.test(raw)) throw new Error(`${name} is invalid`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} is invalid`)
  }
  return value
}

const targetHost = process.env.TARGET_HOST
if (!targetHost || !/^[A-Za-z0-9.-]{1,253}$/.test(targetHost)) {
  throw new Error('TARGET_HOST is invalid')
}
const targetPort = port('TARGET_PORT')
const listenPort = port('PORT', String(targetPort))
const host = process.env.HOST ?? '0.0.0.0'

const server = createServer((downstream) => {
  const upstream = connect({ host: targetHost, port: targetPort })
  downstream.setTimeout(30_000, () => downstream.destroy())
  upstream.setTimeout(30_000, () => upstream.destroy())
  downstream.on('error', () => upstream.destroy())
  upstream.on('error', () => downstream.destroy())
  downstream.pipe(upstream).pipe(downstream)
})
server.listen(listenPort, host)

const healthPort = process.env.HEALTH_PORT ? port('HEALTH_PORT') : null
const health = healthPort
  ? createHttpServer((_request, response) => {
      const probe = connect({ host: targetHost, port: targetPort })
      let settled = false
      const finish = (status: number) => {
        if (settled) return
        settled = true
        probe.destroy()
        response.writeHead(status, { 'cache-control': 'no-store' }).end()
      }
      probe.setTimeout(1_000, () => finish(503))
      probe.once('connect', () => finish(200))
      probe.once('error', () => finish(503))
    }).listen(healthPort, host)
  : null

function shutdown(): void {
  health?.close()
  server.close(() => process.exit(0))
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
