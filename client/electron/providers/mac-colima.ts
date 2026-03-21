import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import log from '../logger'
import type { DockerProvider, InstallProgress } from './docker-provider'
import { getExtendedPath, getExecOptions, commandExists, getDockerBinPath, getColimaBinPath } from '../utils/platform'

const execAsync = promisify(exec)

function execOpts(extra?: Record<string, unknown>) {
  return getExecOptions(extra)
}

/**
 * macOS Colima Provider
 * 通过 Homebrew 安装 Colima + Docker CLI，使用 Colima VM 运行 Docker
 */
export class ColimaProvider implements DockerProvider {
  readonly name = 'Colima'

  async checkInstalled(): Promise<boolean> {
    return commandExists('colima')
  }

  async install(onProgress: (progress: InstallProgress) => void): Promise<boolean> {
    try {
      // Check Homebrew
      onProgress({ step: 'homebrew', progress: 10, message: '检查 Homebrew...' })
      const hasBrew = await commandExists('brew')

      if (!hasBrew) {
        onProgress({ step: 'homebrew', progress: 20, message: '请先安装 Homebrew: https://brew.sh' })
        throw new Error('请先手动安装 Homebrew: https://brew.sh')
      }

      // Install Colima + Docker CLI via Homebrew
      onProgress({ step: 'colima', progress: 30, message: '安装 Colima (通过 Homebrew)...' })

      await new Promise<void>((resolve, reject) => {
        const brewProcess = spawn('brew', ['install', 'colima', 'docker'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PATH: getExtendedPath() }
        })

        let lastMessage = '安装中...'

        brewProcess.stdout?.on('data', (data: Buffer) => {
          const output = data.toString().trim()
          if (output) {
            if (output.includes('Downloading')) lastMessage = '下载中...'
            else if (output.includes('Installing')) lastMessage = '正在安装...'
            else if (output.includes('Pouring')) lastMessage = '解压安装包...'
            onProgress({ step: 'colima', progress: 40, message: lastMessage })
          }
        })

        brewProcess.stderr?.on('data', (data: Buffer) => {
          const output = data.toString().trim()
          if (output && !output.startsWith('==>')) {
            log.warn('brew stderr:', output)
          }
        })

        brewProcess.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`brew install 退出码: ${code}`))
        })

        brewProcess.on('error', reject)
      })

      onProgress({ step: 'colima', progress: 70, message: '启动 Colima...' })
      await this.start()

      onProgress({ step: 'complete', progress: 100, message: '安装完成' })
      return true
    } catch (error) {
      log.error('ColimaProvider install failed:', error)
      // 将具体错误信息向上抛出，让前端展示给用户
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  async start(): Promise<boolean> {
    const colimaBin = getColimaBinPath()

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { stdout } = await execAsync(
          `${colimaBin} status 2>/dev/null || echo "not running"`,
          execOpts()
        )
        if (stdout.includes('not running') || stdout.includes('stopped')) {
          await execAsync(`${colimaBin} start --cpu 2 --memory 2`, execOpts({ timeout: 180000 }))
        }
        // 等待 Docker daemon 就绪（最多 60 秒）
        for (let i = 0; i < 30; i++) {
          if (await this.isRunning()) return true
          await new Promise(r => setTimeout(r, 2000))
        }
        throw new Error('Docker daemon not ready after colima start')
      } catch (error) {
        if (attempt === 0) {
          // 首次失败：强制清理残留状态（应对异常关机后锁文件未释放的情况）后重试
          log.warn('ColimaProvider start failed, force-cleaning and retrying...', error)
          try {
            await execAsync(`${colimaBin} stop --force`, execOpts({ timeout: 30000 }))
          } catch { /* 清理失败也继续重试 */ }
          continue
        }
        log.error('ColimaProvider start failed after retry:', error)
        return false
      }
    }
    return false
  }

  async isRunning(): Promise<boolean> {
    try {
      const dockerBin = getDockerBinPath()
      // 用 docker version 替代 docker info，响应更快；超时放宽到 15 秒
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
