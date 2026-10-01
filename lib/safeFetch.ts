import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

type ResolvedAddress = { address: string; family: number }
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family?: number) => void

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((result, octet) => ((result << 8) | Number(octet)) >>> 0, 0)
}

function inIpv4Range(address: string, network: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(network) & mask)
}

/** True only for globally routable unicast IP addresses. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const blockedRanges: Array<[string, number]> = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
      ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ]
    return !blockedRanges.some(([network, prefix]) => inIpv4Range(address, network, prefix))
  }

  if (family !== 6) return false

  const groups = address.toLowerCase().split(':')
  const firstGroup = Number.parseInt(groups[0] || '0', 16)
  // Permit global-unicast 2000::/3 only; reject special-use, mapped, local,
  // link-local, multicast, transition and documentation address ranges.
  if (firstGroup < 0x2000 || firstGroup > 0x3fff) return false
  if (address.toLowerCase().startsWith('2002:')) return false // 6to4 embeds IPv4 destinations
  if (address.toLowerCase().startsWith('2001:db8:')) return false // documentation prefix
  if (/^2001:(?:0{0,3}[0-9a-f]{1,3}):/i.test(address)) {
    const secondGroup = Number.parseInt(groups[1] || '0', 16)
    if (secondGroup <= 0x01ff) return false // special-purpose 2001::/23
  }
  return true
}

/**
 * Rejects unsafe URL forms and literal private IP addresses before DNS or HTTP.
 */
export function isSafeUrl(targetUrl: string): boolean {
  try {
    const formatted = /^https?:\/\//i.test(targetUrl) ? targetUrl : `https://${targetUrl}`
    const parsed = new URL(formatted)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return false

    const host = parsed.hostname.toLowerCase()
    if (
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.example') ||
      host.endsWith('.onion')
    ) return false

    const literalIp = host.replace(/^\[|\]$/g, '')
    return isIP(literalIp) ? isPublicIpAddress(literalIp) : true
  } catch {
    return false
  }
}

async function resolvePublicAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const literalIp = hostname.replace(/^\[|\]$/g, '')
  if (isIP(literalIp)) {
    if (!isPublicIpAddress(literalIp)) throw new Error(`Non-public destination address rejected: ${literalIp}`)
    return [{ address: literalIp, family: isIP(literalIp) }]
  }

  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error(`DNS for ${hostname} returned a non-public destination address`)
  }
  return addresses
}

function createPinnedLookup(addresses: ResolvedAddress[]) {
  return (_hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    const family = typeof options.family === 'string'
      ? (options.family === 'IPv4' ? 4 : 6)
      : options.family || 0
    const eligible = family ? addresses.filter((address) => address.family === family) : addresses
    if (eligible.length === 0) {
      const error = Object.assign(new Error('No validated DNS address matches the requested IP family'), { code: 'ENOTFOUND' })
      callback(error, '', 0)
      return
    }
    if (options.all) callback(null, eligible)
    else callback(null, eligible[0].address, eligible[0].family)
  }
}

async function requestToPublicAddress(url: URL, init: RequestInit): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase()
  if ((method !== 'GET' && method !== 'HEAD') || init.body != null) {
    throw new Error('Safe crawler requests support GET/HEAD only and cannot include a request body')
  }

  const addresses = await resolvePublicAddresses(url.hostname)
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  const transport = url.protocol === 'https:' ? https : http
  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(url, {
      method,
      headers,
      signal: init.signal as AbortSignal | undefined,
      agent: new transport.Agent({ keepAlive: false }),
      lookup: createPinnedLookup(addresses),
    }, (incoming) => {
      const responseHeaders = new Headers()
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
        responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1])
      }

      const noBody = init.method?.toUpperCase() === 'HEAD' || [204, 205, 304].includes(incoming.statusCode || 0)
      const body = noBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>
      try {
        resolve(new Response(body, {
          status: incoming.statusCode || 502,
          statusText: incoming.statusMessage,
          headers: responseHeaders,
        }))
      } catch (error) {
        incoming.destroy(error instanceof Error ? error : undefined)
        reject(error)
      }
    })
    request.once('error', reject)
    request.end()
  })
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_SAFE_REDIRECTS = 5

/** Resolves public DNS once and pins the socket to a validated address per hop. */
export async function fetchWithSafeRedirects(
  targetUrl: string,
  init: RequestInit = {}
): Promise<Response> {
  let currentUrl = targetUrl

  for (let redirects = 0; ; redirects++) {
    if (!isSafeUrl(currentUrl)) {
      throw new Error(`Unsafe target or redirect URL rejected by SSRF guard: ${currentUrl}`)
    }

    let parsed: URL
    try {
      parsed = new URL(/^https?:\/\//i.test(currentUrl) ? currentUrl : `https://${currentUrl}`)
    } catch {
      throw new Error(`Invalid target URL rejected by SSRF guard: ${currentUrl}`)
    }

    const response = await requestToPublicAddress(parsed, init)
    if (!REDIRECT_STATUSES.has(response.status)) return response

    const location = response.headers.get('location')
    if (!location) return response
    if (redirects >= MAX_SAFE_REDIRECTS) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`Too many redirects while fetching ${targetUrl}`)
    }

    let nextUrl: string
    try {
      nextUrl = new URL(location, parsed).toString()
    } catch {
      await response.body?.cancel().catch(() => {})
      throw new Error(`Invalid redirect destination while fetching ${targetUrl}`)
    }

    await response.body?.cancel().catch(() => {})
    if (!isSafeUrl(nextUrl)) {
      throw new Error(`Unsafe redirect destination rejected by SSRF guard: ${nextUrl}`)
    }
    currentUrl = nextUrl
  }
}
