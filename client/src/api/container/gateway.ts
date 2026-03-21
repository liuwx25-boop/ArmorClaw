/**
 * OpenClaw Gateway WebSocket RPC 客户端
 *
 * 协议流程：
 * 1. 建立 WebSocket 连接
 * 2. 收到 connect.challenge 事件（含 nonce）
 * 3. 发送 connect 请求（含 auth token）
 * 4. 收到 res 响应，握手完成
 * 5. 发送业务 RPC 请求（skills.status / skills.update / config.get 等）
 */

const GATEWAY_URL = 'ws://127.0.0.1:18789'
const GATEWAY_TOKEN = 'local'
const CONNECT_TIMEOUT = 30000  // WebSocket 连接+握手超时 30 秒
const RPC_TIMEOUT = 15000      // 单次 RPC 请求超时 15 秒
const INSTALL_TIMEOUT = 300000 // 安装超时 5 分钟
const PROTOCOL_VERSION = 3

let callId = 0
function nextId(): string {
  return `client-${++callId}-${Date.now()}`
}

// ============ 连接池：复用 WebSocket 连接 ============

let sharedWs: WebSocket | null = null
let sharedWsReady = false
let connectingPromise: Promise<WebSocket> | null = null
const pendingCallbacks = new Map<string, {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

function handleSharedMessage(event: MessageEvent) {
  try {
    const data = JSON.parse(event.data as string)
    if (data.type === 'res' && data.id) {
      const cb = pendingCallbacks.get(data.id)
      if (cb) {
        pendingCallbacks.delete(data.id)
        clearTimeout(cb.timer)
        if (data.ok) {
          cb.resolve(data.payload)
        } else {
          cb.reject(new Error(data.error?.message || 'RPC 调用失败'))
        }
      }
    }
  } catch {
    // 忽略非 JSON 消息
  }
}

function cleanupSharedWs() {
  sharedWs = null
  sharedWsReady = false
  connectingPromise = null
  for (const [id, cb] of pendingCallbacks) {
    clearTimeout(cb.timer)
    cb.reject(new Error('Gateway 连接断开'))
    pendingCallbacks.delete(id)
  }
}

/**
 * 获取可复用的 Gateway WebSocket 连接
 * 如果已有活跃连接直接返回，否则新建并完成握手
 */
function getSharedConnection(): Promise<WebSocket> {
  if (sharedWs && sharedWsReady && sharedWs.readyState === WebSocket.OPEN) {
    return Promise.resolve(sharedWs)
  }
  if (connectingPromise) return connectingPromise

  connectingPromise = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`${GATEWAY_URL}/?token=${GATEWAY_TOKEN}`)
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        ws.close()
        connectingPromise = null
        reject(new Error('Gateway 连接超时'))
      }
    }, CONNECT_TIMEOUT)

    const cleanup = () => { clearTimeout(timer) }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)

        if (data.type === 'event' && data.event === 'connect.challenge') {
          const connectId = nextId()
          ws.send(JSON.stringify({
            type: 'req',
            id: connectId,
            method: 'connect',
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: 'gateway-client',
                version: '0.1.0',
                platform: navigator.platform || 'browser',
                mode: 'ui',
              },
              auth: { token: GATEWAY_TOKEN },
              role: 'operator',
              scopes: ['operator.admin'],
            },
          }))
          return
        }

        if (data.type === 'res' && !settled) {
          cleanup()
          settled = true
          if (data.ok) {
            sharedWs = ws
            sharedWsReady = true
            ws.onmessage = handleSharedMessage
            ws.onerror = () => cleanupSharedWs()
            ws.onclose = () => cleanupSharedWs()
            resolve(ws)
          } else {
            ws.close()
            connectingPromise = null
            reject(new Error(data.error?.message || 'Gateway 握手失败'))
          }
          return
        }
      } catch {
        // 忽略
      }
    }

    ws.onerror = () => {
      if (!settled) {
        cleanup()
        settled = true
        connectingPromise = null
        reject(new Error('Gateway 连接失败，请确认服务已启动'))
      }
    }

    ws.onclose = (event) => {
      if (!settled) {
        cleanup()
        settled = true
        connectingPromise = null
        reject(new Error(`Gateway 连接断开 (code: ${event.code})`))
      }
    }
  })

  return connectingPromise
}

/**
 * 在共享连接上发送 RPC 请求
 */
function sendRequest<T = unknown>(ws: WebSocket, method: string, params?: Record<string, unknown>, timeout?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = nextId()
    const timer = setTimeout(() => {
      pendingCallbacks.delete(id)
      reject(new Error(`Gateway RPC 超时: ${method}`))
    }, timeout ?? RPC_TIMEOUT)

    pendingCallbacks.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    })

    ws.send(JSON.stringify({ type: 'req', id, method, params: params || {} }))
  })
}

/**
 * 完成一次 RPC 调用：复用连接 → 请求
 * 连接失败时自动重试一次（清除旧连接后重连）
 */
async function rpcCall<T = unknown>(method: string, params?: Record<string, unknown>, timeout?: number): Promise<T> {
  try {
    const ws = await getSharedConnection()
    return await sendRequest<T>(ws, method, params, timeout)
  } catch (err) {
    // 连接级别失败，清理后重试一次
    cleanupSharedWs()
    const ws = await getSharedConnection()
    return await sendRequest<T>(ws, method, params, timeout)
  }
}

/**
 * 主动关闭共享 WebSocket 连接，清理所有 pending callbacks。
 * 应在应用退出或页面卸载时调用。
 */
export function disconnectGateway() {
  if (sharedWs) {
    const ws = sharedWs
    cleanupSharedWs()
    try { ws.close() } catch { /* ignore */ }
  }
}

// ============ Skill 相关接口 ============

export interface SkillInstallOption {
  id: string
  kind: string
  label: string
  bins: string[]
  package?: string
  formula?: string
  module?: string
  url?: string
  os?: string[]
}

export interface SkillInfo {
  name: string
  description: string
  emoji: string
  source: string
  bundled: boolean
  skillKey: string
  primaryEnv?: string
  homepage?: string
  always: boolean
  disabled: boolean
  eligible: boolean
  blockedByAllowlist: boolean
  install: SkillInstallOption[]
  requirements: {
    bins: string[]
    anyBins: string[]
    env: string[]
    config: string[]
    os: string[]
  }
  missing: {
    bins: string[]
    anyBins: string[]
    env: string[]
    config: string[]
    os: string[]
  }
}

interface SkillsStatusResult {
  workspaceDir: string
  managedSkillsDir: string
  skills: SkillInfo[]
}

/** 获取所有 Skill 列表（调用 skills.status） */
export async function fetchSkillsList(): Promise<SkillInfo[]> {
  const result = await rpcCall<SkillsStatusResult>('skills.status')
  return result.skills || []
}

/** 更新 Skill 启用/禁用状态（调用 skills.update） */
export async function patchSkillEnabled(skillKey: string, enabled: boolean): Promise<void> {
  await rpcCall('skills.update', { skillKey, enabled })
}

/** 更新 Skill 的 API Key（调用 skills.update） */
export async function updateSkillApiKey(skillKey: string, apiKey: string): Promise<void> {
  await rpcCall('skills.update', { skillKey, apiKey })
}

/** 更新 Skill 的环境变量（调用 skills.update） */
export async function updateSkillEnv(skillKey: string, env: Record<string, string>): Promise<void> {
  await rpcCall('skills.update', { skillKey, env })
}

export interface SkillInstallResult {
  ok: boolean
  message: string
  stdout: string
  stderr: string
  code: number | null
  warnings?: string[]
}

/** 安装 Skill 依赖（调用 skills.install） */
export async function installSkill(name: string, installId: string): Promise<SkillInstallResult> {
  return await rpcCall<SkillInstallResult>('skills.install', {
    name,
    installId,
    timeoutMs: INSTALL_TIMEOUT,
  }, INSTALL_TIMEOUT)
}

// ============ Config 相关接口 ============

interface ConfigGetResult {
  hash: string
  channels?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

/** 获取当前配置（含 hash） */
export async function fetchConfigHash(): Promise<string> {
  const result = await rpcCall<ConfigGetResult>('config.get')
  return result.hash
}

/** 获取完整配置（含 hash + channels 等） */
export async function fetchConfig(): Promise<ConfigGetResult> {
  return await rpcCall<ConfigGetResult>('config.get')
}

interface ConfigPatchResult {
  ok: boolean
  config: Record<string, unknown>
  restart?: Record<string, unknown>
}

/** 部分更新配置（JSON Merge Patch 语义） */
export async function patchConfig(raw: string, baseHash: string): Promise<ConfigPatchResult> {
  return await rpcCall<ConfigPatchResult>('config.patch', { raw, baseHash }, 15000)
}

// ============ Sessions 相关接口 ============

export interface GatewaySessionRow {
  key: string
  kind: 'direct' | 'group' | 'global' | 'unknown'
  label?: string
  displayName?: string
  derivedTitle?: string
  lastMessagePreview?: string
  channel?: string
  updatedAt: number | null
  sessionId?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  thinkingLevel?: string
  verboseLevel?: string
  reasoningLevel?: string
  modelProvider?: string
  model?: string
  contextTokens?: number
}

interface SessionsListResult {
  ts: number
  path: string
  count: number
  sessions: GatewaySessionRow[]
}

interface SessionDeleteResult {
  ok: boolean
  key: string
  deleted: boolean
  archived: string[]
}

export interface SessionPreviewItem {
  role: string
  text: string
  timestamp?: number
}

export interface SessionPreviewEntry {
  key: string
  status: 'ok' | 'empty' | 'missing' | 'error'
  items: SessionPreviewItem[]
}

interface SessionsPreviewResult {
  ts: number
  previews: SessionPreviewEntry[]
}

interface SessionResetResult {
  ok: boolean
  key: string
  entry: Record<string, unknown>
}

interface SessionCompactResult {
  ok: boolean
  key: string
  compacted: boolean
  kept?: number
  archived?: string
  reason?: string
}

/** 获取会话列表（调用 sessions.list） */
export async function fetchSessions(params?: {
  limit?: number
  activeMinutes?: number
  includeGlobal?: boolean
  includeUnknown?: boolean
  includeDerivedTitles?: boolean
  includeLastMessage?: boolean
}): Promise<GatewaySessionRow[]> {
  const result = await rpcCall<SessionsListResult>('sessions.list', {
    limit: 120,
    includeGlobal: true,
    includeDerivedTitles: true,
    includeLastMessage: true,
    ...params,
  })
  return result.sessions || []
}

/** 删除会话（调用 sessions.delete） */
export async function deleteSession(key: string): Promise<SessionDeleteResult> {
  return await rpcCall<SessionDeleteResult>('sessions.delete', { key, deleteTranscript: true })
}

/** 获取会话消息预览（调用 sessions.preview） */
export async function fetchSessionPreview(key: string, limit = 20): Promise<SessionPreviewEntry | null> {
  const result = await rpcCall<SessionsPreviewResult>('sessions.preview', {
    keys: [key],
    limit,
    maxChars: 500,
  })
  return result.previews?.[0] ?? null
}

/** 重置会话（调用 sessions.reset） — 生成新 sessionId，清零 token 计数 */
export async function resetSession(key: string): Promise<SessionResetResult> {
  return await rpcCall<SessionResetResult>('sessions.reset', { key })
}

/** 压缩会话对话记录（调用 sessions.compact） — 只保留最近 N 行 */
export async function compactSession(key: string, maxLines = 50): Promise<SessionCompactResult> {
  return await rpcCall<SessionCompactResult>('sessions.compact', { key, maxLines })
}
