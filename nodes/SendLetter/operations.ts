/**
 * What each operation puts on the wire, as plain functions.
 *
 * Deliberately separate from the node itself. n8n's execute context cannot be
 * constructed outside n8n, so anything written inside it can only be checked by
 * running n8n by hand and looking at the result - which is how a connector ends
 * up shipping with the recipient and the sender the wrong way round. These take
 * parameters and return a request, so the part that can be wrong can be run.
 *
 * No imports. This package carries zero runtime dependencies, which is a
 * condition of n8n's verification, and the type names it needs from
 * n8n-workflow are only needed by the node file.
 */

export type Product = 'standard' | 'priority' | 'registered'

export interface AddressFields {
  company?: string
  name: string
  street: string
  number: string
  addition?: string
  postalCode: string
  city: string
  province?: string
  country: string
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'DELETE'
  url: string
  body?: Record<string, unknown>
  qs?: Record<string, string | number>
  /** True where the answer is a PDF rather than JSON. */
  binary?: boolean
}

export function baseUrl(raw: string | undefined): string {
  return (raw && raw.trim() ? raw.trim() : 'https://onlinebriefversturen.nl').replace(/\/+$/, '')
}

/**
 * Drops the optional fields nobody filled in.
 *
 * An empty string is not the same as an absent field: `company: ''` prints a
 * blank first line in the envelope window, which pushes the name out of the
 * window on a machine that reads the top line as the addressee.
 */
export function address(fields: AddressFields): Record<string, string> {
  const out: Record<string, string> = {
    name: fields.name.trim(),
    street: fields.street.trim(),
    number: String(fields.number).trim(),
    postalCode: fields.postalCode.trim(),
    city: fields.city.trim(),
    country: fields.country.trim().toUpperCase(),
  }
  for (const key of ['company', 'addition', 'province'] as const) {
    const value = fields[key]?.trim()
    if (value) out[key] = value
  }
  return out
}

export interface SendParameters {
  sender: AddressFields
  recipient: AddressFields
  contentType: 'text' | 'binary' | 'url'
  text?: string
  /** Base64 of the PDF, taken from the incoming item's binary property. */
  fileBase64?: string
  fileName?: string
  fileUrl?: string
  subject?: string
  product?: Product
  colour?: boolean
  duplex?: boolean
  locale?: string
  idempotencyKey?: string
}

export function sendLetterRequest(base: string, p: SendParameters): HttpRequest {
  const body: Record<string, unknown> = {
    sender: address(p.sender),
    recipient: address(p.recipient),
    product: p.product ?? 'standard',
    colour: p.colour ?? false,
    duplex: p.duplex ?? true,
    locale: p.locale ?? 'nl',
  }

  // Exactly one, and chosen by the operation rather than by which field
  // happens to be filled. Sending two is refused by the API, and guessing
  // between them would put the wrong document in an envelope.
  if (p.contentType === 'text') {
    body.text = p.text ?? ''
  } else if (p.contentType === 'binary') {
    body.file = { name: p.fileName || 'document.pdf', contentBase64: p.fileBase64 ?? '' }
  } else {
    body.fileUrl = p.fileUrl ?? ''
  }

  if (p.subject) body.subject = p.subject

  // The single most useful field on an automation platform. n8n retries a
  // failed node and a workflow can be replayed by hand; without a key that is
  // a second envelope through somebody's door.
  if (p.idempotencyKey) body.idempotencyKey = p.idempotencyKey

  return { method: 'POST', url: `${base}/api/v1/letters`, body }
}

export function getLetterRequest(base: string, id: string): HttpRequest {
  return { method: 'GET', url: `${base}/api/v1/letters/${encodeURIComponent(id)}` }
}

export function listLettersRequest(
  base: string,
  options: { limit?: number; status?: string; mode?: string; before?: string } = {},
): HttpRequest {
  const qs: Record<string, string | number> = {}
  if (options.limit) qs.limit = options.limit
  if (options.status) qs.status = options.status
  if (options.mode) qs.mode = options.mode
  if (options.before) qs.before = options.before
  return { method: 'GET', url: `${base}/api/v1/letters`, qs }
}

export function cancelLetterRequest(base: string, id: string, reason?: string): HttpRequest {
  return {
    method: 'POST',
    url: `${base}/api/v1/letters/${encodeURIComponent(id)}/cancel`,
    body: reason ? { reason } : {},
  }
}

export function downloadLetterRequest(base: string, id: string, proof = false): HttpRequest {
  return {
    method: 'GET',
    url: `${base}/api/v1/letters/${encodeURIComponent(id)}/pdf`,
    qs: proof ? { proof: 1 } : {},
    binary: true,
  }
}

export function validateAddressRequest(base: string, fields: AddressFields): HttpRequest {
  return {
    method: 'POST',
    url: `${base}/api/v1/addresses/validate`,
    body: { address: address(fields) },
  }
}

export function quoteRequest(
  base: string,
  input: { destination: string; pages?: number; product?: Product; colour?: boolean; duplex?: boolean },
): HttpRequest {
  return {
    method: 'POST',
    url: `${base}/api/quote`,
    body: {
      destination: input.destination.toUpperCase(),
      pages: input.pages ?? 1,
      product: input.product ?? 'standard',
      colour: input.colour ?? false,
      duplex: input.duplex ?? true,
    },
  }
}

export function subscribeRequest(base: string, url: string, events: string[]): HttpRequest {
  return { method: 'POST', url: `${base}/api/v1/webhooks`, body: { url, events } }
}

export function unsubscribeRequest(base: string, id: string): HttpRequest {
  return { method: 'DELETE', url: `${base}/api/v1/webhooks/${encodeURIComponent(id)}` }
}

export function listWebhooksRequest(base: string): HttpRequest {
  return { method: 'GET', url: `${base}/api/v1/webhooks` }
}

/**
 * Turns a refusal into a sentence a person reading the n8n log can act on.
 *
 * The default is the status code and a stack, which tells somebody staring at
 * a red node nothing about the fact that their prepaid credit ran out and
 * there is a payment link in the response.
 */
export function describeFailure(status: number, body: unknown): string {
  const error = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } })
    ?.error

  if (!error) return `SendLetter refused the request (HTTP ${status})`

  const parts = [error.message ?? error.code ?? `HTTP ${status}`]

  const topUpUrl = error.details?.topUpUrl
  if (error.code === 'insufficient_balance' && typeof topUpUrl === 'string') {
    parts.push(`Top up at ${topUpUrl}`)
  }
  const windowSeconds = error.details?.windowSeconds
  if (error.code === 'rate_limited' && typeof windowSeconds === 'number') {
    parts.push(`Try again in ${windowSeconds} seconds.`)
  }
  const problems = error.details?.problems
  if (Array.isArray(problems)) {
    for (const problem of problems as { field?: string; message?: string }[]) {
      if (problem?.field && problem?.message) parts.push(`${problem.field}: ${problem.message}`)
    }
  }
  return parts.join('. ')
}

/** Whether n8n should offer to retry, or whether retrying can only fail again. */
export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * Whether a callback really came from SendLetter.
 *
 * Here rather than inline in the trigger node so it can be run against a
 * signature the server produced. A verifier that is only ever checked against
 * itself keeps agreeing with itself on the day the other side changes, and the
 * failure mode is a trigger that silently stops firing.
 *
 * The comparison is constant time, and the length is checked first because
 * timingSafeEqual throws on a mismatch rather than returning false.
 */
export function signatureMatches(
  secret: string,
  body: string,
  signature: string | undefined,
  crypto: {
    createHmac: (algorithm: string, key: string) => { update: (d: string, e: 'utf8') => { digest: (e: 'hex') => string } }
    timingSafeEqual: (a: Uint8Array, b: Uint8Array) => boolean
  },
): boolean {
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  const given = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length) return false
  return crypto.timingSafeEqual(given, wanted)
}
