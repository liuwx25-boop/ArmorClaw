import { safeStorage } from 'electron'
import * as crypto from 'crypto'
import * as os from 'os'
import * as http from 'http'
import * as https from 'https'
import log from './logger'

const SAFE_STORAGE_KEY = 'armorclaw-client-secret'

/** 存储在 safeStorage 中的加密 buffer（内存缓存） */
let cachedSecret: string | null = null

/**
 * 初始化 clientSecret：
 * - 检查 safeStorage 中是否已有 secret
 * - 没有则生成并存储
 */
export function initClientSecret(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('[client-secret] safeStorage encryption not available, falling back to plain')
  }

  try {
    // 尝试从 safeStorage 读取
    const stored = loadFromSafeStorage()
    if (stored) {
      cachedSecret = stored
      log.info('[client-secret] Loaded existing client secret from safeStorage')
      return
    }
  } catch (err) {
    log.warn('[client-secret] Failed to read from safeStorage:', err)
  }

  // 生成新的 secret
  cachedSecret = crypto.randomBytes(32).toString('hex')
  saveToSafeStorage(cachedSecret)
  log.info('[client-secret] Generated new client secret')
}

/**
 * 获取 clientSecret 原文（用于签名计算）
 */
export function getClientSecret(): string | null {
  return cachedSecret
}

/**
 * 获取 clientSecret 的 SHA256 哈希（用于上报和签名）
 */
export function getSecretHash(): string | null {
  if (!cachedSecret) return null
  return crypto.createHash('sha256').update(cachedSecret).digest('hex')
}

/**
 * 计算 HMAC-SHA256 签名
 * message = "{timestamp}:{apiKey}"
 * key = SHA256(clientSecret)
 */
export function computeSignature(timestamp: string, apiKey: string): string | null {
  const secretHash = getSecretHash()
  if (!secretHash) return null
  const message = `${timestamp}:${apiKey}`
  return crypto.createHmac('sha256', secretHash).update(message).digest('hex')
}

/**
 * 上报 clientSecret 哈希到服务端
 */
export function uploadClientSecret(serverBaseUrl: string, jwtToken: string): Promise<boolean> {
  return new Promise((resolve) => {
    const secretHash = getSecretHash()
    if (!secretHash) {
      log.error('[client-secret] No secret hash available for upload')
      resolve(false)
      return
    }

    const body = JSON.stringify({
      secret_hash: secretHash,
      name: os.hostname(),
    })

    const url = `${serverBaseUrl}/api/v1/user/client-secret`
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
            log.info('[client-secret] Successfully uploaded client secret to server')
            resolve(true)
          } else {
            log.error(`[client-secret] Upload failed: ${res.statusCode} ${data}`)
            resolve(false)
          }
        })
      },
    )

    req.on('error', (err) => {
      log.error('[client-secret] Upload request error:', err)
      resolve(false)
    })
    req.on('timeout', () => {
      req.destroy()
      log.error('[client-secret] Upload request timeout')
      resolve(false)
    })

    req.write(body)
    req.end()
  })
}

// ======== safeStorage 读写 ========

const STORAGE_FILE_NAME = 'client-secret.enc'

function getStoragePath(): string {
  const { app } = require('electron')
  const path = require('path')
  return path.join(app.getPath('userData'), STORAGE_FILE_NAME)
}

function loadFromSafeStorage(): string | null {
  const fs = require('fs')
  const filePath = getStoragePath()
  if (!fs.existsSync(filePath)) return null

  const encrypted = fs.readFileSync(filePath)
  if (!encrypted || encrypted.length === 0) return null

  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(encrypted)
  }
  // 降级：直接读取（不安全，仅开发环境）
  return encrypted.toString('utf-8')
}

function saveToSafeStorage(secret: string): void {
  const fs = require('fs')
  const filePath = getStoragePath()
  const dir = require('path').dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(secret)
    fs.writeFileSync(filePath, encrypted)
  } else {
    // 降级：明文存储（不安全，仅开发环境）
    fs.writeFileSync(filePath, secret, 'utf-8')
  }
}
