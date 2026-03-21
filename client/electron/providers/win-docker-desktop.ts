import { exec } from 'child_process'
import { promisify } from 'util'
import log from '../logger'
import type { DockerProvider, InstallProgress } from './docker-provider'
import { getExtendedPath, pathExists } from '../utils/platform'

const execAsync = promisify(exec)

function execOpts(extra?: Record<string, unknown>) {
  return { env: { ...process.env, PATH: getExtendedPath() }, ...extra }
}

/**
 * Windows Docker Desktop Provider
 * 检测 Docker Desktop for Windows 是否安装并运行
 */
export class WinDockerDesktopProvider implements DockerProvider {
  readonly name = 'Docker Desktop (Windows)'

  async checkInstalled(): Promise<boolean> {
    // 方式 1：检测注册表
    try {
      await execAsync(
        'reg query "HKLM\\SOFTWARE\\Docker Inc.\\Docker Desktop" /v Version',
        execOpts({ timeout: 5000 })
      )
      return true
    } catch { /* continue */ }

    // 方式 2：检测安装路径
    return pathExists('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe')
  }

  async install(onProgress: (progress: InstallProgress) => void): Promise<boolean> {
    // Docker Desktop 安装需要用户手动下载运行安装器
    onProgress({ step: 'install', progress: 0, message: '请下载安装 Docker Desktop for Windows' })
    const { shell } = require('electron')
    shell.openExternal('https://www.docker.com/products/docker-desktop/')
    return false // 返回 false 表示需要用户手动完成
  }

  async start(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // 尝试启动 Docker Desktop
        await execAsync(
          '"C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"',
          execOpts()
        )
        // 等待 Docker daemon 就绪（最多 60 秒）
        for (let i = 0; i < 30; i++) {
          if (await this.isRunning()) return true
          await new Promise(r => setTimeout(r, 2000))
        }
        throw new Error('Docker daemon not ready after Docker Desktop start')
      } catch (error) {
        if (attempt === 0) {
          // 首次失败：强制结束残留进程（应对异常关机/蓝屏后进程僵死的情况）后重试
          log.warn('WinDockerDesktopProvider start failed, killing stale processes and retrying...', error)
          try {
            await execAsync(
              'taskkill /F /IM "Docker Desktop.exe" /T 2>nul & taskkill /F /IM "com.docker.backend.exe" /T 2>nul & taskkill /F /IM "com.docker.proxy.exe" /T 2>nul',
              execOpts({ timeout: 15000 })
            )
            await new Promise(r => setTimeout(r, 3000))
          } catch { /* ignore */ }
          continue
        }
        log.error('WinDockerDesktopProvider start failed after retry:', error)
        return false
      }
    }
    return false
  }

  async isRunning(): Promise<boolean> {
    try {
      await execAsync('docker version --format "{{.Server.Version}}"', execOpts({ timeout: 15000 }))
      return true
    } catch {
      return false
    }
  }

  getDockerCommand(): string {
    return 'docker'
  }
}
