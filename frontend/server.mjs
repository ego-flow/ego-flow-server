import http from 'node:http'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import app from './dist/server/server.js'

const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? '8088')
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const clientRoot = path.join(currentDir, 'dist', 'client')

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.m3u8', 'application/vnd.apple.mpegurl; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.xml', 'application/xml; charset=utf-8'],
])

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

function getContentType(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream'
}

function resolveStaticFile(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname)
  const normalizedPath = path.posix.normalize(decodedPath)

  if (
    normalizedPath === '/' ||
    normalizedPath.startsWith('/api/') ||
    normalizedPath.startsWith('/_server-fns/')
  ) {
    return null
  }

  const relativePath = normalizedPath.replace(/^\/+/, '')
  const candidatePath = path.resolve(clientRoot, relativePath)

  if (!candidatePath.startsWith(clientRoot)) {
    return null
  }

  return candidatePath
}

async function serveStaticAsset(req, res) {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${port}`}`)
  const assetPath = resolveStaticFile(requestUrl.pathname)

  if (!assetPath) {
    return false
  }

  try {
    await access(assetPath)
    const assetStat = await stat(assetPath)

    if (!assetStat.isFile()) {
      return false
    }

    res.writeHead(200, {
      'content-length': assetStat.size,
      'content-type': getContentType(assetPath),
      'cache-control': requestUrl.pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    })

    if (req.method === 'HEAD') {
      res.end()
      return true
    }

    createReadStream(assetPath).pipe(res)
    await once(res, 'finish')
    return true
  } catch {
    return false
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (await serveStaticAsset(req, res)) {
      return
    }

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
