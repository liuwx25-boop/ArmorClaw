import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { isWindows, isMac, getExtendedPath } from './utils/platform'

export interface ContainerResourceConfig {
  cpus: number        // CPU 核数，如 0.5, 1, 2
  memoryMB: number    // 内存 MB，如 2048
  pidsLimit: number   // 最大进程数
  nofileLimit: number // 文件描述符限制
  diskLimitMB: number // 磁盘容量限制 MB（应用层限制）
}

export const DEFAULT_CONTAINER_RESOURCES: ContainerResourceConfig = {
  cpus: 0.5,
  memoryMB: 2048,
  pidsLimit: 50,
  nofileLimit: 256,
  diskLimitMB: 5120,  // 5 GB
}

export interface ArmorClawConfig {
  /** 服务端 API 地址，管理员可通过修改 ~/.armorclaw/config.json 调整 */
  serverApiBaseUrl: string
  proxyService: {
    baseUrl: string
  }
  containerResources?: ContainerResourceConfig
}

const CONFIG_DIR = path.join(os.homedir(), '.armorclaw')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

/** 从 client/default-config.json 读取默认配置（唯一配置源） */
function loadDefaultConfig(): { serverApiBaseUrl: string; proxyBaseUrl: string } {
  // 尝试多个可能的路径
  const possiblePaths = [
    path.join(__dirname, '..', 'default-config.json'),  // 开发环境: dist-electron/../default-config.json
    path.join(__dirname, 'default-config.json'),        // 打包后: dist-electron/default-config.json
    path.join(process.resourcesPath, 'app', 'default-config.json'),  // Electron 打包后
  ]

  for (const configPath of possiblePaths) {
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        if (config.serverApiBaseUrl && config.proxyBaseUrl) {
          return config
        }
      }
    } catch {
      // 继续尝试下一个路径
    }
  }

  // default-config.json 是唯一配置源，找不到则报错
  throw new Error(
    '[config-manager] default-config.json not found or serverApiBaseUrl not set. ' +
    'Searched paths: ' + possiblePaths.join(', ')
  )
}

const defaultConfig = loadDefaultConfig()
/** 默认服务端 API 地址，来自 default-config.json（唯一配置源） */
export const DEFAULT_SERVER_API_BASE_URL: string = defaultConfig.serverApiBaseUrl
/** 默认代理地址，来自 default-config.json（唯一配置源） */
export const DEFAULT_PROXY_BASE_URL: string = defaultConfig.proxyBaseUrl

/**
 * 检测 Docker 运行时，返回容器访问宿主机的地址
 * - Docker Desktop (Mac/Windows): host.docker.internal
 * - Colima (Mac): 从 Colima VM 获取实际 IP 地址
 * - Linux: host.docker.internal (需配合 --add-host)
 */
export function detectDockerHostAddress(): string {
  // Windows: Docker Desktop 和 WSL2 Docker 都支持 host.docker.internal
  if (isWindows) {
    return 'host.docker.internal'
  }

  if (process.platform === 'linux') {
    return 'host.docker.internal'
  }

  // macOS: 检测是否为 Colima
  if (isMac) {
    try {
      execSync('colima status', { stdio: 'ignore', env: { ...process.env, PATH: getExtendedPath() } })
      // Colima 环境：从 VM 的 /etc/hosts 获取宿主机 IP
      try {
        const output = execSync('colima ssh -- cat /etc/hosts | grep host.lima.internal', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PATH: getExtendedPath() }
        })
        const match = output.match(/^(\d+\.\d+\.\d+\.\d+)\s+host\.lima\.internal/)
        if (match) {
          return match[1]
        }
      } catch {
        // 获取 IP 失败，使用默认网段
      }
      return '192.168.5.2' // Colima 默认宿主机 IP
    } catch {
      return 'host.docker.internal' // Docker Desktop
    }
  }

  return 'host.docker.internal'
}

/**
 * 判断是否需要 --add-host 参数
 * Linux: 需要 --add-host host.docker.internal:host-gateway
 * macOS (Colima): bridge 模式下也需要 --add-host 让容器能解析 host.docker.internal
 * macOS (Docker Desktop): 自动支持 host.docker.internal，无需额外参数
 */
export function needsAddHostFlag(): boolean {
  if (process.platform === 'linux') {
    return true
  }
  // Windows: 始终添加 --add-host，因为 WSL2 Docker Engine 不一定自动支持 host.docker.internal
  if (isWindows) {
    return true
  }
  if (isMac) {
    // Colima 环境下 bridge 模式需要显式 --add-host
    try {
      execSync('colima status', { stdio: 'ignore', env: { ...process.env, PATH: getExtendedPath() } })
      return true
    } catch {
      return false
    }
  }
  return false
}

/**
 * 统一使用 bridge 网络模式（安全加固）
 * bridge 模式提供网络隔离，容器无法直接访问宿主机所有端口/服务，
 * 仅通过 -p 映射的端口可被外部访问，出站网络不受影响。
 */
export function shouldUseHostNetwork(): boolean {
  return false
}

/**
 * 加载配置文件，不存在则返回默认配置
 */
export function loadConfig(): ArmorClawConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return getDefaultConfig()
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return getDefaultConfig()
  }
}

/**
 * 保存配置文件
 */
export function saveConfig(config: ArmorClawConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

/**
 * 确保配置文件存在且与 default-config.json 保持同步。
 * - 文件不存在 → 创建默认配置
 * - 文件已存在 → 同步 serverApiBaseUrl 和 proxyService.baseUrl
 */
export function ensureConfigExists(): void {
  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(getDefaultConfig())
    return
  }

  // 已有配置文件，检查是否需要更新
  const config = loadConfig()
  let changed = false

  if (config.serverApiBaseUrl !== DEFAULT_SERVER_API_BASE_URL) {
    console.log(
      `[config-manager] serverApiBaseUrl changed: "${config.serverApiBaseUrl}" → "${DEFAULT_SERVER_API_BASE_URL}", updating config.json`
    )
    config.serverApiBaseUrl = DEFAULT_SERVER_API_BASE_URL
    changed = true
  }

  if (config.proxyService.baseUrl !== DEFAULT_PROXY_BASE_URL) {
    console.log(
      `[config-manager] proxyService.baseUrl changed: "${config.proxyService.baseUrl}" → "${DEFAULT_PROXY_BASE_URL}", updating config.json`
    )
    config.proxyService.baseUrl = DEFAULT_PROXY_BASE_URL
    changed = true
  }

  if (changed) {
    saveConfig(config)
  }
}

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  return CONFIG_FILE
}

/**
 * 获取默认配置
 */
function getDefaultConfig(): ArmorClawConfig {
  return {
    serverApiBaseUrl: DEFAULT_SERVER_API_BASE_URL,
    proxyService: {
      baseUrl: DEFAULT_PROXY_BASE_URL
    },
    containerResources: { ...DEFAULT_CONTAINER_RESOURCES },
  }
}

/**
 * 获取服务端 API 地址
 * 优先从 ~/.armorclaw/config.json 读取，未设置则使用默认值
 */
export function getServerApiBaseUrl(): string {
  const config = loadConfig()
  return config.serverApiBaseUrl || DEFAULT_SERVER_API_BASE_URL
}

/**
 * 获取容器资源配置，不存在则返回默认值
 */
export function getContainerResourceConfig(): ContainerResourceConfig {
  const config = loadConfig()
  return config.containerResources || { ...DEFAULT_CONTAINER_RESOURCES }
}

/**
 * 保存容器资源配置
 */
export function saveContainerResourceConfig(resources: ContainerResourceConfig): void {
  const config = loadConfig()
  config.containerResources = resources
  saveConfig(config)
}

/**
 * 获取用于 Docker 容器的环境变量
 * 固定指向客户端本地代理（:19090），OpenClaw 的 AI 请求经本地代理转发到服务端
 * 真实服务端代理地址保存在 ~/.armorclaw/config.json 中，容器内不可见
 */
export function getDockerEnvVars(): { baseUrl: string } {
  // 返回固定的本地代理地址（容器内通过此地址访问宿主机上的本地代理）
  const hostAddr = detectDockerHostAddress()
  const baseUrl = `http://${hostAddr}:19090/api/v1/proxy`

  return { baseUrl }
}
