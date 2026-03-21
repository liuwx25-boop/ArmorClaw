import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

/**
 * 获取扩展 PATH 环境变量
 * macOS: 追加 Homebrew 路径（Electron 环境 PATH 可能不含）
 * Windows: 追加 Docker Desktop CLI 路径
 * Linux: 追加 /usr/local/bin
 */
export function getExtendedPath(): string {
  const basePath = process.env.PATH || ''
  const sep = isWindows ? ';' : ':'

  if (isMac) {
    return basePath + sep + '/opt/homebrew/bin' + sep + '/usr/local/bin'
  }
  if (isWindows) {
    return basePath + sep + 'C:\\Program Files\\Docker\\Docker\\resources\\bin'
  }
  return basePath + sep + '/usr/local/bin'
}

/**
 * 获取用户 Home 目录（跨平台）
 * 替代 process.env.HOME（Windows 上可能为空）
 */
export function getHomeDir(): string {
  return os.homedir()
}

/**
 * 获取 OpenClaw 数据目录
 * 三平台统一为 ~/.openclaw
 */
export function getOpenClawDataDir(): string {
  return path.join(os.homedir(), '.openclaw')
}

/**
 * 获取 ArmorClaw 配置目录
 * 三平台统一为 ~/.armorclaw
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.armorclaw')
}

/**
 * 获取 OpenClaw 容器日志目录
 * 三平台统一为 ~/.openclaw/logs
 * 容器内日志会通过卷挂载写入此目录
 */
export function getOpenClawLogDir(): string {
  const logDir = path.join(os.homedir(), '.openclaw', 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

/**
 * 安全删除文件（跨平台）
 * 替代 shell 命令 `rm -f`
 */
export async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath)
  } catch {
    // 文件不存在或无权限，忽略
  }
}

/**
 * 检测命令是否存在（跨平台）
 * macOS/Linux: which <cmd>
 * Windows: where <cmd>
 */
export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const checkCmd = isWindows ? `where ${cmd}` : `which ${cmd}`
    await execAsync(checkCmd, { timeout: 5000, env: { ...process.env, PATH: getExtendedPath() } })
    return true
  } catch {
    return false
  }
}

/**
 * 检测路径是否存在（跨平台）
 * 替代 shell 命令 `test -d`
 */
export function pathExists(targetPath: string): boolean {
  return fs.existsSync(targetPath)
}

/**
 * 获取 docker 可执行文件的绝对路径
 * Electron 打包后的 .app 从 Finder/Launchpad 启动时，PATH 不含 Homebrew 路径
 * 直接用绝对路径避免 PATH 问题
 */
export function getDockerBinPath(): string {
  if (isMac) {
    // macOS: Homebrew ARM 路径优先，再 Intel 路径
    const candidates = ['/opt/homebrew/bin/docker', '/usr/local/bin/docker']
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
  }
  if (isWindows) {
    const winPath = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
    if (fs.existsSync(winPath)) return winPath
  }
  // fallback: 依赖 PATH
  return 'docker'
}

/**
 * 获取 colima 可执行文件的绝对路径
 */
export function getColimaBinPath(): string {
  if (isMac) {
    const candidates = ['/opt/homebrew/bin/colima', '/usr/local/bin/colima']
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
  }
  return 'colima'
}

/**
 * 获取 Colima 的 Docker socket 路径（macOS）
 * Colima 默认 socket: ~/.colima/default/docker.sock
 * Electron 打包后不继承终端的 docker context，需要显式设置 DOCKER_HOST
 */
export function getColimaDockerHost(): string | undefined {
  if (!isMac) return undefined
  const sockPath = path.join(os.homedir(), '.colima', 'default', 'docker.sock')
  if (fs.existsSync(sockPath)) {
    return `unix://${sockPath}`
  }
  return undefined
}

/**
 * 获取 exec 默认选项（含扩展 PATH 和 Colima DOCKER_HOST）
 */
export function getExecOptions(extra?: Record<string, unknown>) {
  const env: Record<string, string | undefined> = { ...process.env, PATH: getExtendedPath() }
  const dockerHost = getColimaDockerHost()
  if (dockerHost) {
    env.DOCKER_HOST = dockerHost
  }
  return {
    env,
    ...extra
  }
}

/**
 * 获取平台标识名（用于前端展示）
 */
export function getPlatformName(): 'macos' | 'windows' | 'linux' {
  if (isMac) return 'macos'
  if (isWindows) return 'windows'
  return 'linux'
}
