import { safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as https from 'https'
import * as http from 'http'
import log from './logger'

// ======== 类型定义 ========

export interface BYOKSaveParams {
  providerId: string
  baseUrl: string
  apiKey: string
  modelName: string
}

export interface BYOKDeleteParams {
  providerId: string
}

export interface BYOKTestParams {
  baseUrl: string
  apiKey: string
  modelName: string
}

export interface BYOKUpdateModelParams {
  providerId: string
  modelName: string
}

export interface BYOKListItem {
  providerId: string
  providerName: string
  baseUrl: string
  modelName: string
  apiKeyMasked: string
}

export interface BYOKTestResult {
  success: boolean
  message: string
  latencyMs?: number
}

// ======== 存储路径 ========

const BYOK_DIR = path.join(os.homedir(), '.armorclaw')
const KEYS_FILE = path.join(BYOK_DIR, 'byok-keys.enc')
const CONFIG_FILE = path.join(BYOK_DIR, 'byok-config.json')
const PLATFORM_KEY_FILE = path.join(BYOK_DIR, 'platform-key.enc')

// ======== 内存缓存 ========

interface BYOKProviderConfig {
  baseUrl: string
  modelName: string
  providerName: string
}

interface BYOKConfigData {
  providers: Record<string, BYOKProviderConfig>
}

let keysCache: Record<string, string> = {}
let configCache: BYOKConfigData = { providers: {} }
let initialized = false

// ======== 初始化 ========

export function initBYOKManager(): void {
  if (initialized) return

  // 确保目录存在
  if (!fs.existsSync(BYOK_DIR)) {
    fs.mkdirSync(BYOK_DIR, { recursive: true })
  }

  // 加载配置（明文）
  loadConfig()

  // 加载并解密 Key
  loadKeys()

  initialized = true
  log.info('[byok-manager] Initialized, providers:', Object.keys(configCache.providers).join(', ') || '(none)')
}

// ======== 配置文件读写（明文） ========

function loadConfig(): void {
  if (!fs.existsSync(CONFIG_FILE)) {
    configCache = { providers: {} }
    return
  }
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
  configCache = JSON.parse(raw)
  if (!configCache.providers) {
    configCache.providers = {}
  }
}

function saveConfigFile(): void {
  if (!fs.existsSync(BYOK_DIR)) {
    fs.mkdirSync(BYOK_DIR, { recursive: true })
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configCache, null, 2), 'utf-8')
}

// ======== Key 文件读写（加密） ========

function loadKeys(): void {
  if (!fs.existsSync(KEYS_FILE)) {
    keysCache = {}
    return
  }

  const encrypted = fs.readFileSync(KEYS_FILE)
  if (!encrypted || encrypted.length === 0) {
    keysCache = {}
    return
  }

  let decrypted: string
  if (safeStorage.isEncryptionAvailable()) {
    decrypted = safeStorage.decryptString(encrypted)
  } else {
    // 降级：明文（仅开发环境）
    log.warn('[byok-manager] safeStorage not available, reading keys as plaintext')
    decrypted = encrypted.toString('utf-8')
  }

  keysCache = JSON.parse(decrypted)
}

function saveKeysFile(): void {
  if (!fs.existsSync(BYOK_DIR)) {
    fs.mkdirSync(BYOK_DIR, { recursive: true })
  }

  const json = JSON.stringify(keysCache)

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json)
    fs.writeFileSync(KEYS_FILE, encrypted)
  } else {
    log.warn('[byok-manager] safeStorage not available, saving keys as plaintext')
    fs.writeFileSync(KEYS_FILE, json, 'utf-8')
  }
}

// ======== API Key 脱敏 ========

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.substring(0, 3) + '****' + key.substring(key.length - 4)
}

// ======== 公开接口（IPC 调用） ========

/**
 * 保存 BYOK 配置 + 加密存储 API Key
 */
export function byokSave(params: BYOKSaveParams): void {
  const { providerId, baseUrl, apiKey, modelName } = params

  // 保存 API Key（加密）
  keysCache[providerId] = apiKey
  saveKeysFile()

  // 保存配置（明文）
  // 从预置列表中查找名称，自定义厂商用 providerId 作为名称
  let providerName = providerId
  try {
    const { PROVIDER_PRESETS } = require('../src/config/providers')
    const preset = PROVIDER_PRESETS.find((p: { id: string }) => p.id === providerId)
    if (preset) providerName = preset.name
  } catch {
    // 主进程可能无法直接 require 渲染进程的文件，使用 providerId 作为 fallback
  }

  configCache.providers[providerId] = {
    baseUrl,
    modelName,
    providerName,
  }
  saveConfigFile()

  log.info(`[byok-manager] Saved provider "${providerId}" (model: ${modelName})`)
}

/**
 * 删除 BYOK 配置 + 清除 API Key + 同步删除 models.json + 更新默认模型引用
 */
export function byokDelete(params: BYOKDeleteParams): void {
  const { providerId } = params

  delete keysCache[providerId]
  saveKeysFile()

  delete configCache.providers[providerId]
  saveConfigFile()

  // 同步删除 OpenClaw models.json 中的对应配置
  deleteProviderFromModelsJson(providerId)

  // 检查并更新 openclaw.json 中的默认模型引用
  updateDefaultModelIfNeeded(providerId)

  log.info(`[byok-manager] Deleted provider "${providerId}"`)
}

/**
 * 列出已配置的 BYOK 厂商（Key 脱敏）
 */
export function byokList(): BYOKListItem[] {
  const items: BYOKListItem[] = []
  for (const [providerId, config] of Object.entries(configCache.providers)) {
    const apiKey = keysCache[providerId] || ''
    items.push({
      providerId,
      providerName: config.providerName || providerId,
      baseUrl: config.baseUrl,
      modelName: config.modelName,
      apiKeyMasked: maskApiKey(apiKey),
    })
  }
  return items
}

/**
 * 更新模型名称
 */
export function byokUpdateModel(params: BYOKUpdateModelParams): void {
  const { providerId, modelName } = params
  const config = configCache.providers[providerId]
  if (!config) {
    throw new Error(`Provider "${providerId}" not found`)
  }
  config.modelName = modelName
  saveConfigFile()
  log.info(`[byok-manager] Updated model for "${providerId}" to "${modelName}"`)
}

/**
 * 测试连接：向厂商发送轻量请求验证 API Key
 */
export function byokTest(params: BYOKTestParams): Promise<BYOKTestResult> {
  const { baseUrl, apiKey, modelName } = params
  const startTime = Date.now()

  return new Promise((resolve) => {
    // 构造 chat completions 请求（最轻量）
    const testUrl = baseUrl.replace(/\/$/, '') + '/chat/completions'
    const body = JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
    })

    let parsedUrl: URL
    try {
      parsedUrl = new URL(testUrl)
    } catch {
      resolve({ success: false, message: `无效的 Base URL: ${baseUrl}` })
      return
    }

    const isHttps = parsedUrl.protocol === 'https:'
    const client = isHttps ? https : http

    const req = client.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          const latencyMs = Date.now() - startTime
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, message: `连接成功（${latencyMs}ms）`, latencyMs })
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            resolve({ success: false, message: `API Key 无效或无权限（HTTP ${res.statusCode}）` })
          } else {
            // 某些厂商对 max_tokens=1 可能返回 400，但说明连接通了
            let errMsg = ''
            try {
              const parsed = JSON.parse(data)
              errMsg = parsed.error?.message || parsed.message || ''
            } catch { /* ignore */ }
            if (res.statusCode === 400) {
              resolve({ success: true, message: `连接成功（${latencyMs}ms，厂商返回 400 但通信正常）`, latencyMs })
            } else {
              resolve({ success: false, message: `厂商返回 HTTP ${res.statusCode}${errMsg ? ': ' + errMsg : ''}` })
            }
          }
        })
      },
    )

    req.on('error', (err) => {
      resolve({ success: false, message: `连接失败: ${err.message}` })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({ success: false, message: '连接超时（15秒）' })
    })

    req.write(body)
    req.end()
  })
}

// ======== 供 proxy-server 调用的接口 ========

/**
 * 获取指定 provider 的真实 Base URL
 */
export function getProviderBaseUrl(providerId: string): string | null {
  return configCache.providers[providerId]?.baseUrl || null
}

/**
 * 获取指定 provider 的真实 API Key（解密后）
 */
export function getProviderApiKey(providerId: string): string | null {
  return keysCache[providerId] || null
}

/**
 * 从 models.json 中删除指定 provider
 * 用于删除 BYOK 或平台 Key 配置时同步清理 models.json
 */
export function deleteProviderFromModelsJson(providerId: string): void {
  const dataDir = path.join(os.homedir(), '.openclaw')
  const modelsJsonPath = path.join(dataDir, 'agents', 'main', 'agent', 'models.json')

  if (!fs.existsSync(modelsJsonPath)) {
    return
  }

  try {
    const content = fs.readFileSync(modelsJsonPath, 'utf-8')
    const modelsConfig = JSON.parse(content)

    if (!modelsConfig.providers || !modelsConfig.providers[providerId]) {
      return
    }

    delete modelsConfig.providers[providerId]
    fs.writeFileSync(modelsJsonPath, JSON.stringify(modelsConfig, null, 2), 'utf-8')
    log.info(`[models.json] Deleted provider "${providerId}"`)
  } catch (err) {
    log.warn(`[models.json] Failed to delete provider "${providerId}":`, err)
  }
}

/**
 * 检查并更新 openclaw.json 中的默认模型引用
 * 如果删除的 provider 包含当前默认模型，自动切换到其他可用模型
 */
export function updateDefaultModelIfNeeded(deletedProviderId: string): void {
  const dataDir = path.join(os.homedir(), '.openclaw')
  const openclawJsonPath = path.join(dataDir, 'openclaw.json')

  if (!fs.existsSync(openclawJsonPath)) {
    return
  }

  try {
    const content = fs.readFileSync(openclawJsonPath, 'utf-8')
    const openclawConfig = JSON.parse(content)

    // 获取当前默认模型
    const currentPrimary = openclawConfig?.agents?.defaults?.model?.primary
    if (!currentPrimary) {
      return
    }

    // 检查默认模型是否属于被删除的 provider
    // 格式可能是 "providerId/modelName" 或 "providerId modelName" 或其他变体
    const isDeletedProviderModel =
      currentPrimary.includes(deletedProviderId) ||
      currentPrimary.startsWith(deletedProviderId + '/') ||
      currentPrimary.startsWith(deletedProviderId + ' ')

    if (!isDeletedProviderModel) {
      return
    }

    log.info(`[openclaw.json] Default model "${currentPrimary}" references deleted provider "${deletedProviderId}", finding replacement...`)

    // 从 byok-config.json（configCache）中找用户配置的第一个可用模型
    let newDefaultModel: string | null = null

    for (const [providerId, providerConfig] of Object.entries(configCache.providers)) {
      if (providerConfig.modelName) {
        // 使用 providerId/modelName 格式
        newDefaultModel = `${providerId}/${providerConfig.modelName}`
        log.info(`[openclaw.json] Found replacement model from user config: ${newDefaultModel}`)
        break
      }
    }

    // 更新默认模型
    if (newDefaultModel) {
      openclawConfig.agents.defaults.model.primary = newDefaultModel
      fs.writeFileSync(openclawJsonPath, JSON.stringify(openclawConfig, null, 4), 'utf-8')
      log.info(`[openclaw.json] Updated default model to "${newDefaultModel}"`)
    } else {
      // 没有可用模型，清空默认模型引用
      openclawConfig.agents.defaults.model.primary = ''
      fs.writeFileSync(openclawJsonPath, JSON.stringify(openclawConfig, null, 4), 'utf-8')
      log.warn(`[openclaw.json] No available models in user config, cleared default model reference`)
    }
  } catch (err) {
    log.warn(`[openclaw.json] Failed to update default model:`, err)
  }
}

/**
 * 从 models.json 中删除所有包含指定 apiKey 的 provider
 * 用于删除平台 Key 时清理所有相关配置
 */
export function deleteProvidersByApiKeyFromModelsJson(apiKey: string): void {
  const dataDir = path.join(os.homedir(), '.openclaw')
  const modelsJsonPath = path.join(dataDir, 'agents', 'main', 'agent', 'models.json')

  if (!fs.existsSync(modelsJsonPath)) {
    return
  }

  try {
    const content = fs.readFileSync(modelsJsonPath, 'utf-8')
    const modelsConfig = JSON.parse(content)

    if (!modelsConfig.providers) {
      return
    }

    const providersToDelete: string[] = []
    for (const [providerId, config] of Object.entries(modelsConfig.providers)) {
      const providerConfig = config as { apiKey?: string }
      if (providerConfig.apiKey === apiKey) {
        providersToDelete.push(providerId)
      }
    }

    for (const providerId of providersToDelete) {
      delete modelsConfig.providers[providerId]
      log.info(`[models.json] Deleted provider "${providerId}" with matching apiKey`)
    }

    if (providersToDelete.length > 0) {
      fs.writeFileSync(modelsJsonPath, JSON.stringify(modelsConfig, null, 2), 'utf-8')
      log.info(`[models.json] Deleted ${providersToDelete.length} provider(s) with matching apiKey`)
    }
  } catch (err) {
    log.warn(`[models.json] Failed to delete providers by apiKey:`, err)
  }
}

// ======== models.json 迁移（启动时自动修复） ========

/**
 * 扫描 models.json，将真实 API Key 迁移到 platform-key.enc 并替换为占位符
 * 在应用启动时调用，确保不论容器是否重启，都能修复历史遗留问题
 */
export function migrateModelsJsonKeys(): void {
  const dataDir = path.join(os.homedir(), '.openclaw')
  const modelsJsonPath = path.join(dataDir, 'agents', 'main', 'agent', 'models.json')

  if (!fs.existsSync(modelsJsonPath)) {
    log.info('[byok-manager] models.json not found, skip migration')
    return
  }

  try {
    const content = fs.readFileSync(modelsJsonPath, 'utf-8')
    const modelsConfig = JSON.parse(content)

    if (!modelsConfig.providers) {
      return
    }

    const SAFE_PLACEHOLDERS = ['byok-placeholder', 'platform-managed', '']
    let changed = false
    let migratedKey: string | null = null

    for (const [providerId, provider] of Object.entries(modelsConfig.providers)) {
      const p = provider as { apiKey?: string }
      if (p.apiKey && !SAFE_PLACEHOLDERS.includes(p.apiKey)) {
        log.info(`[byok-manager] Migration: found real apiKey in provider "${providerId}" (${p.apiKey.substring(0, 8)}...)`)
        // 记录第一个发现的真实 Key 用于迁移
        if (!migratedKey) {
          migratedKey = p.apiKey
        }
        p.apiKey = 'platform-managed'
        changed = true
      }
    }

    // 如果发现了真实 Key，保存到 platform-key.enc
    if (migratedKey) {
      const existingKey = getPlatformKey()
      if (!existingKey) {
        savePlatformKey(migratedKey)
        log.info('[byok-manager] Migration: saved real API key to platform-key.enc')
      } else {
        log.info('[byok-manager] Migration: platform-key.enc already exists, skipping save')
      }
    }

    if (changed) {
      fs.writeFileSync(modelsJsonPath, JSON.stringify(modelsConfig, null, 2), 'utf-8')
      log.info('[byok-manager] Migration: cleaned up models.json, replaced real keys with platform-managed')
    } else {
      log.info('[byok-manager] Migration: models.json is clean, no migration needed')
    }
  } catch (err) {
    log.warn('[byok-manager] Migration failed:', err)
  }
}

// ======== 平台 Key 管理 ========

/**
 * 保存平台管理的 API Key（加密存储）
 * 用于 proxy-server 替换 platform-managed 占位符
 */
export function savePlatformKey(apiKey: string): void {
  log.info('[byok-manager] savePlatformKey called, key length:', apiKey?.length || 0)
  log.info('[byok-manager] BYOK_DIR:', BYOK_DIR)
  log.info('[byok-manager] PLATFORM_KEY_FILE:', PLATFORM_KEY_FILE)
  
  if (!fs.existsSync(BYOK_DIR)) {
    log.info('[byok-manager] Creating BYOK_DIR...')
    fs.mkdirSync(BYOK_DIR, { recursive: true })
  }

  const data = JSON.stringify({ apiKey, updatedAt: new Date().toISOString() })
  log.info('[byok-manager] Data to save:', data.substring(0, 50) + '...')

  if (safeStorage.isEncryptionAvailable()) {
    log.info('[byok-manager] Using safeStorage encryption')
    const encrypted = safeStorage.encryptString(data)
    fs.writeFileSync(PLATFORM_KEY_FILE, encrypted)
  } else {
    log.warn('[byok-manager] safeStorage not available, saving platform key as plaintext')
    fs.writeFileSync(PLATFORM_KEY_FILE, data, 'utf-8')
  }
  log.info('[byok-manager] Platform key saved to:', PLATFORM_KEY_FILE)
}

/**
 * 获取平台管理的 API Key（解密后）
 * 用于 proxy-server 替换 platform-managed 占位符
 */
export function getPlatformKey(): string | null {
  if (!fs.existsSync(PLATFORM_KEY_FILE)) {
    return null
  }

  try {
    const encrypted = fs.readFileSync(PLATFORM_KEY_FILE)
    if (!encrypted || encrypted.length === 0) {
      return null
    }

    let decrypted: string
    if (safeStorage.isEncryptionAvailable()) {
      decrypted = safeStorage.decryptString(encrypted)
    } else {
      decrypted = encrypted.toString('utf-8')
    }

    const data = JSON.parse(decrypted)
    return data.apiKey || null
  } catch (err) {
    log.warn('[byok-manager] Failed to read platform key:', err)
    return null
  }
}

/**
 * 清除平台管理的 API Key
 * 用于删除平台 Key 时清理本地存储
 */
export function clearPlatformKey(): void {
  if (fs.existsSync(PLATFORM_KEY_FILE)) {
    fs.unlinkSync(PLATFORM_KEY_FILE)
    log.info('[byok-manager] Platform key cleared')
  }
}
