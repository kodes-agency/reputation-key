// Host-only accommodation for `pnpm local:up`: the web and worker run on the
// host while the Google sandbox, AI stub and mail stub run in Compose, whose
// service names the host cannot resolve. `local-provider-fetch.ts` deliberately
// compiles the AI stub address in (no environment value may retarget where the
// provider key and merchant content go), so the names are resolved here, in
// the process, instead of through an environment URL. Loaded via
// `NODE_OPTIONS=--import`; never part of any image.
import dns from 'node:dns'

const LOOPBACK_HOSTS = Object.freeze({
  'ai-provider-stub': '127.0.0.1',
  'provider-sandbox': '127.0.0.1',
  'mail-stub': '127.0.0.1',
})

const lookup = dns.lookup
dns.lookup = function loopbackLookup(hostname, options, callback) {
  return lookup.call(dns, LOOPBACK_HOSTS[hostname] ?? hostname, options, callback)
}

const promisesLookup = dns.promises.lookup
dns.promises.lookup = function loopbackPromisesLookup(hostname, options) {
  return promisesLookup.call(dns.promises, LOOPBACK_HOSTS[hostname] ?? hostname, options)
}
