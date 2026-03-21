import { exec } from 'child_process'
import { promisify } from 'util'
import log from '../logger'
import type { DockerProvider, InstallProgress } from './docker-provider'
import { getExtendedPath } from '../utils/platform'

const execAsync = promisify(exec)

function execOpts(extra?: Record<string, unknown>) {
  return { env: { ...process.env, PATH: getExtendedPath() }, ...extra }
}

/**
 * Windows WSL2 + Docker Engine Provider
 * 在 WSL2 内直接运行 Docker Engine（不依赖 Docker Desktop）
 */
export class WSL2DockerProvider implements DockerProvider {
  readonly name = 'WSL2 + Docker Engine'
  private distro = 'Ubuntu-22.04'

  async checkInstalled(): Promise<boolean> {
    // 1. 检测 WSL2 是否启用
    if (!(await this.isWSL2Enabled())) return false
    // 2. 检测是否有 Linux 发行版
    if (!(await this.hasDistro())) return false
    // 3. 检测 Docker Engine 是否安装
    return this.isDockerInstalled()
  }

  async install(onProgress: (progress: InstallProgress) => void): Promise<boolean> {
    // Step 1: 启用 WSL2
    if (!(await this.isWSL2Enabled())) {
      onProgress({ step: 'wsl2', progress: 10, message: '正在启用 WSL2（需要管理员权限）...' })
      try {
        await execAsync(
          'powershell -Command "Start-Process wsl -ArgumentList \'--install --no-distribution\' -Verb RunAs -Wait"',
          execOpts({ timeout: 120000 })
        )
        // WSL2 启用后通常需要重启系统
        onProgress({ step: 'wsl2', progress: 20, message: 'WSL2 已启用，需要重启系统后继续安装。' })
        return false // 需要重启
      } catch {
        onProgress({ step: 'wsl2', progress: 0, message: 'WSL2 启用失败，请手动执行：wsl --install' })
        return false
      }
    }

    // Step 2: 安装 Ubuntu 发行版
    if (!(await this.hasDistro())) {
      onProgress({ step: 'distro', progress: 30, message: '正在安装 Ubuntu 发行版...' })
      try {
        await execAsync(
          `wsl --install -d ${this.distro}`,
          execOpts({ timeout: 600000 }) // 10 分钟超时
        )
        onProgress({ step: 'distro', progress: 50, message: 'Ubuntu 安装完成' })
      } catch {
        onProgress({ step: 'distro', progress: 0, message: 'Ubuntu 安装失败' })
        return false
      }
    }

    // Step 3: 在 WSL2 内安装 Docker Engine
    if (!(await this.isDockerInstalled())) {
      onProgress({ step: 'docker', progress: 60, message: '正在安装 Docker Engine...' })
      try {
        const installScript = [
          'sudo apt-get update',
          'sudo apt-get install -y ca-certificates curl gnupg',
          'sudo install -m 0755 -d /etc/apt/keyrings',
          'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg',
          'sudo chmod a+r /etc/apt/keyrings/docker.gpg',
          'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null',
          'sudo apt-get update',
          'sudo apt-get install -y docker-ce docker-ce-cli containerd.io',
          'sudo usermod -aG docker $USER'
        ].join(' && ')

        await execAsync(
          `wsl -d ${this.distro} bash -c "${installScript}"`,
          execOpts({ timeout: 600000 })
        )
        onProgress({ step: 'docker', progress: 90, message: 'Docker Engine 安装完成' })
      } catch {
        onProgress({ step: 'docker', progress: 0, message: 'Docker Engine 安装失败' })
        return false
      }
    }

    onProgress({ step: 'done', progress: 100, message: '安装完成' })
    return true
  }

  async start(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await execAsync(
          `wsl -d ${this.distro} sudo service docker start`,
          execOpts({ timeout: 30000 })
        )
        // 等待就绪
        for (let i = 0; i < 15; i++) {
          if (await this.isRunning()) return true
          await new Promise(r => setTimeout(r, 2000))
        }
        throw new Error('Docker daemon not ready in WSL2 after service start')
      } catch (error) {
        if (attempt === 0) {
          // 首次失败：重置 WSL 实例（应对蓝屏/异常关机后 WSL 状态异常的情况）后重试
          log.warn('WSL2DockerProvider start failed, resetting WSL and retrying...', error)
          try {
            await execAsync('wsl --shutdown', execOpts({ timeout: 15000 }))
            await new Promise(r => setTimeout(r, 3000))
          } catch { /* ignore */ }
          continue
        }
        log.error('WSL2DockerProvider start failed after retry:', error)
        return false
      }
    }
    return false
  }

  async isRunning(): Promise<boolean> {
    try {
      await execAsync(
        `wsl -d ${this.distro} docker version --format "{{.Server.Version}}"`,
        execOpts({ timeout: 15000 })
      )
      return true
    } catch {
      return false
    }
  }

  getDockerCommand(): string {
    return `wsl -d ${this.distro} docker`
  }

  // ---- WSL2 状态检测方法（对外暴露供 IPC 调用） ----

  async isWSL2Enabled(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('wsl --status', execOpts({ timeout: 10000 }))
      // wsl --status 输出含 "Default Version: 2" 或 WSL 相关信息即表示已启用
      return stdout.includes('2') || stdout.includes('WSL')
    } catch {
      return false
    }
  }

  async hasDistro(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('wsl -l -v', execOpts({ timeout: 10000 }))
      return stdout.includes(this.distro) || stdout.includes('Ubuntu')
    } catch {
      return false
    }
  }

  async isDockerInstalled(): Promise<boolean> {
    try {
      await execAsync(
        `wsl -d ${this.distro} docker --version`,
        execOpts({ timeout: 10000 })
      )
      return true
    } catch {
      return false
    }
  }

  async installWSL2(): Promise<{ success: boolean; needsReboot: boolean; message: string }> {
    try {
      await execAsync(
        'powershell -Command "Start-Process wsl -ArgumentList \'--install --no-distribution\' -Verb RunAs -Wait"',
        execOpts({ timeout: 120000 })
      )
      return { success: true, needsReboot: true, message: 'WSL2 已启用，需要重启系统后继续。' }
    } catch (e) {
      return { success: false, needsReboot: false, message: e instanceof Error ? e.message : '安装失败' }
    }
  }

  async installDistro(): Promise<{ success: boolean; message: string }> {
    try {
      await execAsync(`wsl --install -d ${this.distro}`, execOpts({ timeout: 600000 }))
      return { success: true, message: `${this.distro} 安装完成` }
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : '安装失败' }
    }
  }
}
