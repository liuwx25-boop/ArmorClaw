import { exec } from 'child_process'
import { promisify } from 'util'
import log from '../logger'
import type { DockerProvider, InstallProgress } from './docker-provider'
import { getExecOptions, pathExists, getDockerBinPath } from '../utils/platform'

const execAsync = promisify(exec)

function execOpts(extra?: Record<string, unknown>) {
  return getExecOptions(extra)
}

/**
 * macOS Docker Desktop Provider
 * 检测 /Applications/Docker.app 是否存在
 */
export class MacDockerDesktopProvider implements DockerProvider {
  readonly name = 'Docker Desktop (macOS)'

  async checkInstalled(): Promise<boolean> {
    return pathExists('/Applications/Docker.app')
  }

  async install(onProgress: (progress: InstallProgress) => void): Promise<boolean> {
    // Docker Desktop 需要用户手动下载安装
    onProgress({ step: 'install', progress: 0, message: '请下载安装 Docker Desktop for Mac' })
    const { shell } = require('electron')
    shell.openExternal('https://www.docker.com/products/docker-desktop/')
    return false
  }

  async start(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // 尝试启动 Docker Desktop
        await execAsync('open -a Docker', execOpts())
        // 等待 Docker daemon 就绪（最多 60 秒）
        for (let i = 0; i < 30; i++) {
          if (await this.isRunning()) return true
          await new Promise(r => setTimeout(r, 2000))
        }
        throw new Error('Docker daemon not ready after Docker Desktop start')
      } catch (error) {
        if (attempt === 0) {
          // 首次失败：杀掉残留进程（应对异常关机后进程僵死的情况）后重试
          log.warn('MacDockerDesktopProvider start failed, killing stale processes and retrying...', error)
          try {
            await execAsync('killall Docker 2>/dev/null; killall "Docker Desktop" 2>/dev/null', execOpts({ timeout: 10000 }))
            await new Promise(r => setTimeout(r, 3000))
          } catch { /* ignore */ }
          continue
        }
        log.error('MacDockerDesktopProvider start failed after retry:', error)
        return false
      }
    }
    return false
  }

  async isRunning(): Promise<boolean> {
    try {
      const dockerBin = getDockerBinPath()
      await execAsync(`${dockerBin} version --format "{{.Server.Version}}"`, execOpts({ timeout: 15000 }))
      return true
    } catch {
      return false
    }
  }

  getDockerCommand(): string {
    return getDockerBinPath()
  }
}
