'use strict'
// Client for the onboard worker endpoints. Auth: dedicated token in the X-Recovery-Token header.
const TIMEOUT_MS = 15000

function createOnboardClient({ onboardUrl, workerToken }, fetchImpl = globalThis.fetch) {
  const scrub = (s) => String(s).split(workerToken).join('[redacted]')

  async function request(method, path, { body } = {}) {
    const url = onboardUrl + path
    const init = {
      method,
      headers: { accept: 'application/json', 'X-Recovery-Token': workerToken },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Never follow a redirect: the token header would go along to wherever it points.
      redirect: 'manual',
    }
    if (body) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    let res
    try {
      res = await fetchImpl(url, init)
    } catch (e) {
      throw new Error(`onboard ${method} ${path} failed: ${scrub((e && e.message) || e)}`)
    }
    if (!res.ok) throw new Error(`onboard ${method} ${path} returned ${res.status}`)
    try {
      return await res.json()
    } catch {
      return null
    }
  }

  return {
    async getPending() {
      const rows = await request('GET', '/api/recovery-request/pending')
      if (!Array.isArray(rows)) throw new Error('onboard pending: expected an array')
      return rows
    },
    async putResult(requestId, result) {
      const id = encodeURIComponent(requestId)
      await request('PUT', `/api/recovery-request/${id}/result`, { body: result })
    },
  }
}

module.exports = { createOnboardClient }
