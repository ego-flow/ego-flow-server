import http from 'node:http'
import { once } from 'node:events'
import { Readable } from 'node:stream'

import app from './dist/server/server.js'

const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? '8088')

function shouldIncludeBody(method) {
  return method !== 'GET' && method !== 'HEAD'
}

function toRequest(req) {
  const protocol = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0]
  const authority = req.headers.host || `127.0.0.1:${port}`
  const url = new URL(req.url || '/', `${protocol}://${authority}`)

  const init = {
    method: req.method,
    headers: req.headers,
  }

  if (!shouldIncludeBody(req.method || 'GET')) {
    return new Request(url, init)
  }

  return new Request(url, {
    ...init,
    body: Readable.toWeb(req),
    duplex: 'half',
  })
}

function applyHeaders(res, headers) {
  if (typeof headers.getSetCookie === 'function') {
    const setCookie = headers.getSetCookie()
    if (setCookie.length > 0) {
      res.setHeader('set-cookie', setCookie)
    }
  }

  for (const [key, value] of headers.entries()) {
    if (key === 'set-cookie') {
      continue
    }

    res.setHeader(key, value)
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const response = await app.fetch(toRequest(req))

    res.statusCode = response.status
    res.statusMessage = response.statusText
    applyHeaders(res, response.headers)

    if (!response.body || req.method === 'HEAD') {
      res.end()
      return
    }

    Readable.fromWeb(response.body).pipe(res)
    await once(res, 'finish')
  } catch (error) {
    console.error('[dashboard] request failed', error)

    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    }

    res.end('Internal Server Error')
  }
})

server.listen(port, host, () => {
  console.log(`[dashboard] listening on http://${host}:${port}`)
})
