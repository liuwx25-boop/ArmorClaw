import * as http from 'http'
import * as https from 'https'
import { URL } from 'url'
import log from './logger'
import { loadConfig } from './config-manager'
import { computeSignature, getClientSecret } from './client-secret-manager'
import { getProviderBaseUrl, getProviderApiKey, getPlatformKey } from './byok-manager'

const PROXY_PORT = 19090
let server: http.Server | null = null

/**
 * 启动本地代理服务器
 * 监听 localhost:19090，接收 OpenClaw 容器的 AI 请求，
 * 注入客户端签名后转发到真实服务端。
 */
export function startProxyServer(): void {
  if (server) {
    log.info('[proxy-server] Already running')
    return
  }

  server = http.createServer(handleRequest)

  server.listen(PROXY_PORT, '0.0.0.0', () => {
    log.info(`[proxy-server] Local proxy started on port ${PROXY_PORT}`)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`[proxy-server] Port ${PROXY_PORT} is already in use`)
    } else {
      log.error('[proxy-server] Server error:', err)
    }
  })
}

/**
 * 停止本地代理服务器
 */
export function stopProxyServer(): void {
  if (server) {
    server.close()
    server = null
    log.info('[proxy-server] Stopped')
  }
}

/**
 * 处理代理请求 — 根据路径前缀分流
 */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const reqPath = req.url || '/'

  // 路由分流
  if (reqPath.startsWith('/byok/')) {
    handleBYOKRequest(req, res, reqPath)
  } else if (reqPath.startsWith('/api/v1/proxy')) {
    handleProxyRequest(req, res, reqPath)
  } else {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'forbidden' }))
  }
}

/**
 * 处理现有的服务端代理请求（/api/v1/proxy/**）
 */
function handleProxyRequest(req: http.IncomingMessage, res: http.ServerResponse, reqPath: string): void {
  const config = loadConfig()
  const realProxyUrl = config.proxyService.baseUrl

  if (!realProxyUrl) {
    log.error('[proxy-server] No real proxy URL configured')
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'proxy not configured' }))
    return
  }

  if (!getClientSecret()) {
    log.error('[proxy-server] Client secret not available')
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'client secret not initialized' }))
    return
  }

  let authHeader = req.headers['authorization'] || ''
  let apiKey = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''

  // 如果是平台管理的 Key，替换为真实的 API Key
  if (apiKey === 'platform-managed') {
    log.info('[proxy-server] Detected platform-managed, trying to get real key...')
    const platformKey = getPlatformKey()
    if (platformKey) {
      apiKey = platformKey
      // 更新请求头的 authorization，供转发使用
      req.headers['authorization'] = `Bearer ${platformKey}`
      log.info('[proxy-server] Replaced platform-managed with real API key:', platformKey.substring(0, 10) + '...')
    } else {
      log.error('[proxy-server] Platform key not found! File ~/.armorclaw/platform-key.enc missing. Please re-configure API Key in settings.')
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: {
          message: 'Platform API Key not found. Please go to Settings > AI Configuration and re-configure your API Key.',
          type: 'platform_key_missing',
        }
      }))
      return
    }
  }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = computeSignature(timestamp, apiKey)

  if (!signature) {
    log.error('[proxy-server] Failed to compute signature')
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'signature computation failed' }))
    return
  }

  let targetUrl: string
  try {
    if (reqPath.startsWith('/api/v1/proxy')) {
      const suffix = reqPath.substring('/api/v1/proxy'.length)
      targetUrl = `${realProxyUrl}${suffix}`
    } else {
      targetUrl = `${realProxyUrl}${reqPath}`
    }
  } catch {
    log.error('[proxy-server] Invalid proxy URL:', realProxyUrl)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid proxy URL' }))
    return
  }

  log.info(`[proxy-server] ${req.method} ${reqPath} -> ${targetUrl} (sig=${signature.substring(0, 8)}...)`)
  forwardRequest(req, res, targetUrl, timestamp, signature)
}

/**
 * 处理 BYOK 请求（/byok/{providerId}/**）
 * 从 byok-manager 获取真实 baseUrl 和 API Key，注入后转发到厂商
 */
function handleBYOKRequest(req: http.IncomingMessage, res: http.ServerResponse, reqPath: string): void {
  // 解析 providerId: /byok/{providerId}/... 
  const parts = reqPath.substring('/byok/'.length).split('/')
  const providerId = parts[0]
  const suffix = '/' + parts.slice(1).join('/')

  if (!providerId) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'missing providerId in BYOK path' }))
    return
  }

  const providerBaseUrl = getProviderBaseUrl(providerId)
  const providerApiKey = getProviderApiKey(providerId)

  if (!providerBaseUrl || !providerApiKey) {
    log.error(`[proxy-server] BYOK provider "${providerId}" not configured`)
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: `BYOK provider "${providerId}" not found or API key missing` }))
    return
  }

  // 构造目标 URL：厂商 baseUrl + 后缀路径
  const targetUrl = providerBaseUrl.replace(/\/$/, '') + suffix

  log.info(`[proxy-server] BYOK ${req.method} ${reqPath} -> ${targetUrl} (provider=${providerId})`)
  forwardBYOKRequest(req, res, targetUrl, providerApiKey, providerId)
}

/**
 * 转发 BYOK 请求到厂商，注入真实 API Key，支持 SSE 流式转发
 */
function forwardBYOKRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  targetUrl: string,
  apiKey: string,
  providerId?: string,
): void {
  const parsed = new URL(targetUrl)
  const isHttps = parsed.protocol === 'https:'
  const client = isHttps ? https : http

  const headers: http.OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(clientReq.headers)) {
    if (key.toLowerCase() === 'host') continue
    headers[key] = value
  }
  // 注入真实 API Key（替换容器中的占位符）
  headers['authorization'] = `Bearer ${apiKey}`

  const options: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: clientReq.method || 'POST',
    headers,
    timeout: 120000,
  }

  // 收集请求体，可能需要修改 model 字段
  const bodyChunks: Buffer[] = []
  let modifiedBody: Buffer | null = null

  const proxyReq = client.request(options, (proxyRes) => {
    const respHeaders: http.OutgoingHttpHeaders = {}
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      respHeaders[key] = value
    }
    if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
      log.warn(`[proxy-server] BYOK upstream returned ${proxyRes.statusCode} for ${clientReq.method} ${clientReq.url}`)
    }
    clientRes.writeHead(proxyRes.statusCode || 502, respHeaders)

    proxyRes.on('data', (chunk: Buffer) => {
      clientRes.write(chunk)
    })

    proxyRes.on('end', () => {
      clientRes.end()
    })

    proxyRes.on('error', (err) => {
      log.error('[proxy-server] BYOK upstream response error:', err)
      if (!clientRes.headersSent) {
        clientRes.writeHead(502)
      }
      clientRes.end()
    })
  })

  proxyReq.on('error', (err) => {
    log.error('[proxy-server] BYOK upstream request error:', err)
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' })
      clientRes.end(JSON.stringify({ error: 'BYOK upstream connection failed' }))
    } else {
      clientRes.end()
    }
  })

  proxyReq.on('timeout', () => {
    proxyReq.destroy()
    if (!clientRes.headersSent) {
      clientRes.writeHead(504, { 'Content-Type': 'application/json' })
      clientRes.end(JSON.stringify({ error: 'BYOK upstream timeout' }))
    } else {
      clientRes.end()
    }
  })

  // 收集请求体，暂不发送，以便修改 model 字段
  clientReq.on('data', (chunk: Buffer) => {
    bodyChunks.push(chunk)
  })

  clientReq.on('end', () => {
    // 处理请求体：修改 model 字段（去掉厂商前缀）
    let requestBody: Buffer
    try {
      const bodyStr = Buffer.concat(bodyChunks).toString('utf-8')
      const bodyJson = JSON.parse(bodyStr)
      log.info(`[proxy-server] BYOK request body model="${bodyJson.model}" provider="${providerId}" stream=${bodyJson.stream}`)

      // 处理模型 ID：去掉厂商前缀（如 deepseek/deepseek-v3.2 -> deepseek-v3.2）
      if (bodyJson.model && bodyJson.model.includes('/')) {
        const originalModel = bodyJson.model
        bodyJson.model = bodyJson.model.split('/').pop() || bodyJson.model
        log.info(`[proxy-server] Model ID transformed: "${originalModel}" -> "${bodyJson.model}"`)
        requestBody = Buffer.from(JSON.stringify(bodyJson), 'utf-8')
        // 更新 Content-Length
        headers['content-length'] = requestBody.length.toString()
      } else {
        requestBody = Buffer.concat(bodyChunks)
      }
    } catch {
      log.info(`[proxy-server] BYOK request body (non-JSON or parse error)`)
      requestBody = Buffer.concat(bodyChunks)
    }

    // 发送修改后的请求体
    proxyReq.write(requestBody)
    proxyReq.end()
  })

  clientReq.on('error', (err) => {
    log.error('[proxy-server] BYOK client request error:', err)
    proxyReq.destroy()
  })
}

/**
 * 转发请求到真实服务端，注入签名头，支持 SSE 流式转发
 */
function forwardRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  targetUrl: string,
  timestamp: string,
  signature: string,
): void {
  const parsed = new URL(targetUrl)
  const isHttps = parsed.protocol === 'https:'
  const client = isHttps ? https : http

  // 构建转发请求头
  const headers: http.OutgoingHttpHeaders = {}
  // 透传原始请求头
  for (const [key, value] of Object.entries(clientReq.headers)) {
    if (key.toLowerCase() === 'host') continue // 不透传 host
    headers[key] = value
  }
  // 注入签名头
  headers['X-Client-Timestamp'] = timestamp
  headers['X-Client-Signature'] = signature

  const options: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: clientReq.method || 'POST',
    headers,
    timeout: 120000, // 2 分钟超时（AI 请求可能较慢）
  }

  const proxyReq = client.request(options, (proxyRes) => {
    // 透传响应头
    const respHeaders: http.OutgoingHttpHeaders = {}
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      respHeaders[key] = value
    }
    if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
      log.warn(`[proxy-server] Upstream returned ${proxyRes.statusCode} for ${clientReq.method} ${clientReq.url}`)
    }
    clientRes.writeHead(proxyRes.statusCode || 502, respHeaders)

    // SSE 流式转发：逐块转发，不缓冲
    proxyRes.on('data', (chunk: Buffer) => {
      clientRes.write(chunk)
    })

    proxyRes.on('end', () => {
      clientRes.end()
    })

    proxyRes.on('error', (err) => {
      log.error('[proxy-server] Upstream response error:', err)
      if (!clientRes.headersSent) {
        clientRes.writeHead(502)
      }
      clientRes.end()
    })
  })

  proxyReq.on('error', (err) => {
    log.error('[proxy-server] Upstream request error:', err)
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' })
      clientRes.end(JSON.stringify({ error: 'upstream connection failed' }))
    } else {
      clientRes.end()
    }
  })

  proxyReq.on('timeout', () => {
    proxyReq.destroy()
    if (!clientRes.headersSent) {
      clientRes.writeHead(504, { 'Content-Type': 'application/json' })
      clientRes.end(JSON.stringify({ error: 'upstream timeout' }))
    } else {
      clientRes.end()
    }
  })

  // 转发请求体
  clientReq.on('data', (chunk: Buffer) => {
    proxyReq.write(chunk)
  })

  clientReq.on('end', () => {
    proxyReq.end()
  })

  clientReq.on('error', (err) => {
    log.error('[proxy-server] Client request error:', err)
    proxyReq.destroy()
  })
}
