/**
 * 独立的开发模式代理服务器
 *
 * 用于 npm run dev（纯 Vite）时，在没有 Electron 的情况下启动代理服务。
 * 复用 config-manager 的配置读取逻辑和 client-secret-manager 的签名逻辑，
 * 但不依赖 Electron safeStorage（降级为明文读写 client-secret）。
 *
 * 用法: npx tsx scripts/dev-proxy-server.ts
 */

import * as http from 'http'
import * as https from 'https'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { URL } from 'url'

// 复用 config-manager 的配置管理逻辑（无 Electron 依赖）
import {
  loadConfig,
  getServerApiBaseUrl,
  fetchAndCacheProxyUrl,
} from '../electron/config-manager'

// ========== 配置 ==========

const PROXY_PORT = 19090
const CONFIG_DIR = path.join(os.homedir(), '.armorclaw')
const SECRET_FILE = path.join(CONFIG_DIR, 'dev-client-secret')  // 开发模式专用明文存储
const UPLOADED_MARKER = path.join(CONFIG_DIR, 'dev-client-secret-uploaded')

// ========== 日志 ==========

const log = {
  info: (...args: unknown[]) => console.log(`[${new Date().toISOString()}] [info]`, ...args),
  warn: (...args: unknown[]) => console.warn(`[${new Date().toISOString()}] [warn]`, ...args),
  error: (...args: unknown[]) => console.error(`[${new Date().toISOString()}] [error]`, ...args),
}

// ========== Client Secret Manager（开发模式版） ==========

let cachedSecret: string | null = null

function initClientSecret(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }

  // 优先读取 Electron 版本的 secret（兼容已有的加密/明文存储）
  // Electron safeStorage 在开发模式下可能已经以明文写入了
  const electronSecretPath = getElectronSecretPath()
  if (electronSecretPath && fs.existsSync(electronSecretPath)) {
    try {
      const content = fs.readFileSync(electronSecretPath)
      const text = content.toString('utf-8')
      // 如果是 64 位 hex 字符串（32 字节 randomBytes），说明是明文存储的
      if (/^[0-9a-f]{64}$/i.test(text)) {
        cachedSecret = text
        log.info('[client-secret] Loaded existing secret from Electron storage (plaintext)')
        return
      }
    } catch {
      // 忽略读取失败
    }
  }

  // 读取开发模式的 secret 文件
  if (fs.existsSync(SECRET_FILE)) {
    try {
      cachedSecret = fs.readFileSync(SECRET_FILE, 'utf-8').trim()
      if (cachedSecret) {
        log.info('[client-secret] Loaded existing dev secret')
        return
      }
    } catch {
      // 忽略
    }
  }

  // 生成新的 secret
  cachedSecret = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(SECRET_FILE, cachedSecret, 'utf-8')
  log.info('[client-secret] Generated new dev secret (needs upload)')
}

/**
 * 尝试获取 Electron 存储 client-secret 的路径
 * macOS: ~/Library/Application Support/ArmorClaw/client-secret.enc
 * Linux: ~/.config/ArmorClaw/client-secret.enc
 * Windows: %APPDATA%/ArmorClaw/client-secret.enc
 */
function getElectronSecretPath(): string | null {
  let userDataDir: string
  if (process.platform === 'darwin') {
    userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'ArmorClaw')
  } else if (process.platform === 'win32') {
    userDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ArmorClaw')
  } else {
    userDataDir = path.join(os.homedir(), '.config', 'ArmorClaw')
  }
  return path.join(userDataDir, 'client-secret.enc')
}

function getSecretHash(): string | null {
  if (!cachedSecret) return null
  return crypto.createHash('sha256').update(cachedSecret).digest('hex')
}

function computeSignature(timestamp: string, apiKey: string): string | null {
  const secretHash = getSecretHash()
  if (!secretHash) return null
  const message = `${timestamp}:${apiKey}`
  return crypto.createHmac('sha256', secretHash).update(message).digest('hex')
}

// ========== 上报 Secret 到服务端 ==========

function isUploaded(): boolean {
  return fs.existsSync(UPLOADED_MARKER)
}

function markUploaded(): void {
  fs.writeFileSync(UPLOADED_MARKER, new Date().toISOString(), 'utf-8')
}

function uploadClientSecret(jwtToken: string): Promise<boolean> {
  return new Promise((resolve) => {
    const secretHash = getSecretHash()
    if (!secretHash) {
      log.error('[client-secret] No secret hash for upload')
      resolve(false)
      return
    }

    const body = JSON.stringify({ secret_hash: secretHash, name: os.hostname() })
    const url = `${getServerApiBaseUrl()}/api/v1/user/client-secret`
    const client = url.startsWith('https') ? https : http
    const parsedUrl = new URL(url)

    const req = client.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          if (res.statusCode === 200) {
            markUploaded()
            log.info('[client-secret] Uploaded to server')
            resolve(true)
          } else {
            log.error(`[client-secret] Upload failed: ${res.statusCode} ${data}`)
            resolve(false)
          }
        })
      },
    )
    req.on('error', (err) => { log.error('[client-secret] Upload error:', err); resolve(false) })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.write(body)
    req.end()
  })
}

// ========== 代理服务器 ==========

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const config = loadConfig()
  const realProxyUrl = config.proxyService.baseUrl

  if (!realProxyUrl) {
    log.error('[proxy] No real proxy URL configured')
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'proxy not configured' }))
    return
  }

  if (!cachedSecret) {
    log.error('[proxy] Client secret not available')
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'client secret not initialized' }))
    return
  }

  const authHeader = req.headers['authorization'] || ''
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : ''

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = computeSignature(timestamp, apiKey)

  if (!signature) {
    log.error('[proxy] Failed to compute signature')
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'signature computation failed' }))
    return
  }

  let targetUrl: string
  try {
    const reqPath = req.url || '/'
    if (reqPath.startsWith('/api/v1/proxy')) {
      const suffix = reqPath.substring('/api/v1/proxy'.length)
      targetUrl = `${realProxyUrl}${suffix}`
    } else {
      targetUrl = `${realProxyUrl}${reqPath}`
    }
  } catch {
    log.error('[proxy] Invalid proxy URL:', realProxyUrl)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid proxy URL' }))
    return
  }

  log.info(`[proxy] ${req.method} ${req.url} -> ${targetUrl} (sig=${signature.substring(0, 8)}...)`)
  forwardRequest(req, res, targetUrl, timestamp, signature)
}

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

  const headers: http.OutgoingHttpHeaders = {}
  for (const [key, value] of Object.entries(clientReq.headers)) {
    if (key.toLowerCase() === 'host') continue
    headers[key] = value
  }
  headers['X-Client-Timestamp'] = timestamp
  headers['X-Client-Signature'] = signature

  const options: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: clientReq.method || 'POST',
    headers,
    timeout: 120000,
  }

  const proxyReq = client.request(options, (proxyRes) => {
    const respHeaders: http.OutgoingHttpHeaders = {}
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      respHeaders[key] = value
    }
    if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
      log.warn(`[proxy] Upstream returned ${proxyRes.statusCode} for ${clientReq.method} ${clientReq.url}`)
    }
    clientRes.writeHead(proxyRes.statusCode || 502, respHeaders)

    proxyRes.on('data', (chunk: Buffer) => { clientRes.write(chunk) })
    proxyRes.on('end', () => { clientRes.end() })
    proxyRes.on('error', (err) => {
      log.error('[proxy] Upstream response error:', err)
      if (!clientRes.headersSent) clientRes.writeHead(502)
      clientRes.end()
    })
  })

  proxyReq.on('error', (err) => {
    log.error('[proxy] Upstream request error:', err)
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

  clientReq.on('data', (chunk: Buffer) => { proxyReq.write(chunk) })
  clientReq.on('end', () => { proxyReq.end() })
  clientReq.on('error', (err) => {
    log.error('[proxy] Client request error:', err)
    proxyReq.destroy()
  })
}

// ========== 启动 ==========

async function main() {
  log.info('========================================')
  log.info('ArmorClaw Dev Proxy Server starting...')
  log.info('========================================')

  // 1. 初始化 client secret
  initClientSecret()
  log.info(`[client-secret] Hash: ${getSecretHash()?.substring(0, 16)}...`)

  // 2. 确保有服务端 proxy 地址
  try {
    const proxyUrl = await fetchAndCacheProxyUrl()
    log.info(`[config] Proxy URL: ${proxyUrl}`)
  } catch (err) {
    log.error('[config] Failed to get proxy URL:', err)
    log.error('[config] Please ensure ~/.armorclaw/config.json has proxyService.baseUrl set')
    process.exit(1)
  }

  // 3. 启动代理服务器
  const server = http.createServer(handleRequest)
  server.listen(PROXY_PORT, '0.0.0.0', () => {
    log.info(`[proxy] Listening on http://0.0.0.0:${PROXY_PORT}`)
    log.info(`[proxy] Container should use: http://host.docker.internal:${PROXY_PORT}/api/v1/proxy`)
    log.info('')
    log.info('Press Ctrl+C to stop')
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`[proxy] Port ${PROXY_PORT} is already in use (Electron client already running?)`)
    } else {
      log.error('[proxy] Server error:', err)
    }
    process.exit(1)
  })

  // 优雅退出
  process.on('SIGINT', () => {
    log.info('[proxy] Shutting down...')
    server.close()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    log.info('[proxy] Shutting down...')
    server.close()
    process.exit(0)
  })
}

main().catch((err) => {
  log.error('Fatal error:', err)
  process.exit(1)
})
