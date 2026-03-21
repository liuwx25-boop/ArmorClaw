import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { tmpdir } from 'os'
import * as fs from 'fs'
import * as path from 'path'
import log from './logger'
import { getDockerEnvVars, needsAddHostFlag, shouldUseHostNetwork, getContainerResourceConfig, saveContainerResourceConfig, ContainerResourceConfig, detectDockerHostAddress } from './config-manager'
import { getExecOptions, getOpenClawDataDir, getOpenClawLogDir, safeUnlink, isWindows, isMac, getPlatformName, getDockerBinPath, getColimaBinPath } from './utils/platform'
import { savePlatformKey, getPlatformKey } from './byok-manager'
import type { DockerProvider } from './providers/docker-provider'
import { ColimaProvider } from './providers/mac-colima'
import { MacDockerDesktopProvider } from './providers/mac-docker-desktop'
import { WinDockerDesktopProvider } from './providers/win-docker-desktop'
import { WSL2DockerProvider } from './providers/win-wsl2-docker'
import { hasInstalledTools, generateReinstallCommands, getToolsSummary } from './installed-tools'

const execAsync = promisify(exec)

export interface InstallProgress {
  step: string
  progress: number
  message: string
}

export interface DockerStatus {
  platform: 'macos' | 'windows' | 'linux'
  dockerDesktopInstalled: boolean
  colimaInstalled: boolean
  wsl2Installed: boolean
  dockerRunning: boolean
  containerExists: boolean
  containerRunning: boolean
  needsSetup: boolean
}

const CONTAINER_NAME = 'openclaw'
const IMAGE_NAME_FULL = 'armorclaw:full'
const IMAGE_NAME_LITE = 'armorclaw:lite'
const SNAPSHOT_IMAGE = 'armorclaw:snapshot'
const CONTAINER_PORT = 18789
const GATEWAY_TOKEN = 'local'

export class DockerManager {

  private execOptions = getExecOptions()
  private provider: DockerProvider | null = null

  /** Cache detected image name to avoid repeated docker commands */
  private detectedImage: string | null = null

  /** 获取 docker 可执行文件绝对路径（不含引号，供 execFile 等直接使用） */
  private get docker(): string {
    return getDockerBinPath()
  }

  /** 获取 docker 路径（带引号包裹，供 execAsync/shell 命令使用） */
  private get dockerQuoted(): string {
    const p = getDockerBinPath()
    // Windows 路径可能含空格（如 C:\Program Files\...），需要引号包裹
    return `"${p}"`
  }

  /**
   * 检测本地可用的 ArmorClaw 镜像，优先 full，其次 lite。
   * 结果缓存在 detectedImage 中，避免重复检测。
   */
  private async detectAvailableImage(): Promise<string | null> {
    if (this.detectedImage) return this.detectedImage

    for (const candidate of [IMAGE_NAME_FULL, IMAGE_NAME_LITE]) {
      try {
        const { stdout } = await execAsync(
          `${this.dockerQuoted} images ${candidate} --format "{{.Repository}}:{{.Tag}}"`,
          this.execOptions
        )
        if (stdout.trim() === candidate) {
          this.detectedImage = candidate
          log.info(`Detected available image: ${candidate}`)
          return candidate
        }
      } catch { /* ignore */ }
    }
    return null
  }

  /**
   * 获取当前使用的镜像名（full 或 lite），如果未检测到则默认 full。
   */
  private async getImageName(): Promise<string> {
    return (await this.detectAvailableImage()) || IMAGE_NAME_FULL
  }

  /**
   * 按平台和已安装环境选择最优 DockerProvider
   */
  async selectProvider(): Promise<DockerProvider> {
    if (this.provider) return this.provider

    if (isMac) {
      const desktop = new MacDockerDesktopProvider()
      if (await desktop.checkInstalled()) {
        this.provider = desktop
        return desktop
      }
      this.provider = new ColimaProvider()
      return this.provider
    }

    if (isWindows) {
      const desktop = new WinDockerDesktopProvider()
      if (await desktop.checkInstalled()) {
        this.provider = desktop
        return desktop
      }
      this.provider = new WSL2DockerProvider()
      return this.provider
    }

    // Linux: 直接使用系统 Docker（与 Colima provider 复用 isRunning 逻辑）
    this.provider = new ColimaProvider()
    return this.provider
  }

  /** 获取当前 Provider（用于外部访问） */
  getProvider(): DockerProvider | null {
    return this.provider
  }

  async checkStatus(): Promise<DockerStatus> {
    const platform = getPlatformName()

    let dockerDesktopInstalled = false
    let colimaInstalled = false
    let wsl2Installed = false

    if (isMac) {
      const macDesktop = new MacDockerDesktopProvider()
      dockerDesktopInstalled = await macDesktop.checkInstalled()
      const colima = new ColimaProvider()
      colimaInstalled = await colima.checkInstalled()
    } else if (isWindows) {
      const winDesktop = new WinDockerDesktopProvider()
      dockerDesktopInstalled = await winDesktop.checkInstalled()
      const wsl2 = new WSL2DockerProvider()
      wsl2Installed = await wsl2.isWSL2Enabled()
    }

    const provider = await this.selectProvider()
    // 带重试的 Docker 运行状态检测（Colima daemon 响应可能较慢）
    let dockerRunning = await provider.isRunning()
    if (!dockerRunning) {
      // 等待 3 秒后重试一次
      await new Promise(r => setTimeout(r, 3000))
      dockerRunning = await provider.isRunning()
    }
    const containerExists = dockerRunning ? await this.containerExists() : false
    const containerRunning = containerExists ? await this.isContainerRunning() : false

    const needsSetup = !dockerRunning || !containerRunning

    return {
      platform,
      dockerDesktopInstalled,
      colimaInstalled,
      wsl2Installed,
      dockerRunning,
      containerExists,
      containerRunning,
      needsSetup
    }
  }

  private async containerExists(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `${this.dockerQuoted} ps -a --filter "name=^${CONTAINER_NAME}$" --format "{{.Names}}"`,
        this.execOptions
      )
      return stdout.trim() === CONTAINER_NAME
    } catch {
      return false
    }
  }

  private async isContainerRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `${this.dockerQuoted} ps --filter "name=^${CONTAINER_NAME}$" --format "{{.Names}}"`,
        this.execOptions
      )
      return stdout.trim() === CONTAINER_NAME
    } catch {
      return false
    }
  }

  /**
   * 安装 Docker 环境（通过 Provider 策略模式）
   */
  async installDocker(onProgress: (progress: InstallProgress) => void): Promise<boolean> {
    const provider = await this.selectProvider()
    return provider.install(onProgress)
  }

  /**
   * 启动 Docker 运行时（通过 Provider 策略模式）
   */
  async startDocker(): Promise<boolean> {
    const provider = await this.selectProvider()
    return provider.start()
  }

  // 保留兼容性：macOS Colima 专用方法（前端可能仍调用这些名称）
  async installColima(onProgress: (progress: InstallProgress) => void): Promise<boolean> {
    return this.installDocker(onProgress)
  }

  async startColima(): Promise<boolean> {
    return this.startDocker()
  }

  async pullImage(onProgress: (progress: InstallProgress) => void): Promise<boolean> {
    try {
      onProgress({ step: 'pull', progress: 10, message: '检查 ArmorClaw 镜像...' })
      log.info('[pullImage] Starting, resourcesPath:', process.resourcesPath)

      // First check if a bundled tar.gz exists in the installer resources.
      // If it does, ALWAYS load it — this ensures that reinstalling the client
      // replaces the old image with the new one (even if an old image already exists).
      const resourceDir = require('path').join(process.resourcesPath, 'resources')
      const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
      const candidates = [
        require('path').join(resourceDir, `armorclaw-${arch}.tar.gz`),
        require('path').join(resourceDir, 'armorclaw.tar.gz'),
      ]
      log.info('[pullImage] resourceDir:', resourceDir, 'arch:', arch)
      log.info('[pullImage] candidates:', candidates)
      for (const c of candidates) {
        log.info(`[pullImage] existsSync("${c}"):`, require('fs').existsSync(c))
      }
      const bundledTar = candidates.find(p => require('fs').existsSync(p))
      log.info('[pullImage] bundledTar:', bundledTar || '(not found)')

      if (bundledTar) {
        // Bundled tar found — always load it to ensure the image is up-to-date.
        // Stop and remove existing container first (it references the old image).
        const containerRunning = await this.isContainerRunning()
        if (containerRunning || await this.containerExists()) {
          onProgress({ step: 'pull', progress: 15, message: '清理旧容器...' })
          log.info('[pullImage] Removing existing container before loading new image')
          try {
            await execAsync(`${this.dockerQuoted} rm -f ${CONTAINER_NAME}`, { ...this.execOptions, timeout: 60000 })
          } catch { /* container might not exist */ }
        }

        // Determine if we're running on Colima — need special handling for large file transfer
        const isColimaEnv = this.provider instanceof ColimaProvider && isMac

        if (isColimaEnv) {
          // ===== Colima 优化路径 =====
          // Colima 的 virtiofs/sshfs 文件共享在传输大文件时不稳定，
          // 直接 `docker load -i <宿主机路径>` 会通过跨 VM 文件系统读取 ~600MB 的 tar.gz，
          // 容易卡死（CPU 0%、daemon 无响应）。
          // 优化：先用 `colima ssh` 将文件拷贝到 VM 内部，再在 VM 内执行 docker load（本地磁盘 IO）。
          const colimaBin = getColimaBinPath()
          const vmTmpPath = '/tmp/armorclaw-image.tar.gz'

          onProgress({ step: 'pull', progress: 20, message: '拷贝镜像到 Colima VM...' })
          log.info('[pullImage] Colima: copying tar to VM via colima cp')

          // 使用 cat + colima ssh 管道将文件流式传入 VM（避免 virtiofs 大文件传输问题）
          // cat <host-file> | colima ssh -- sh -c "cat > /tmp/xxx"
          const tarSizeMB = Math.round(fs.statSync(bundledTar).size / 1024 / 1024)
          log.info(`[pullImage] Colima: tar size = ${tarSizeMB}MB`)

          await new Promise<void>((resolve, reject) => {
            const copyCmd = `cat "${bundledTar}" | ${colimaBin} ssh -- sh -c "cat > ${vmTmpPath}"`
            const copyProc = spawn('sh', ['-c', copyCmd], {
              stdio: ['ignore', 'pipe', 'pipe'],
              env: this.execOptions.env as Record<string, string>
            })
            let stderr = ''
            copyProc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
            // 拷贝阶段进度模拟（没有实际进度，用定时器模拟 20→45）
            let copyProgress = 20
            const copyTimer = setInterval(() => {
              if (copyProgress < 45) {
                copyProgress += 1
                onProgress({ step: 'pull', progress: copyProgress, message: `拷贝镜像到 VM (${tarSizeMB}MB)...` })
              }
            }, 3000)
            copyProc.on('close', (code) => {
              clearInterval(copyTimer)
              if (code === 0) resolve()
              else reject(new Error(`colima cp failed (exit ${code}): ${stderr.slice(-500)}`))
            })
            copyProc.on('error', (err) => { clearInterval(copyTimer); reject(err) })
          })
          log.info('[pullImage] Colima: tar copied to VM successfully')

          // 在 VM 内执行 docker load（本地磁盘 IO，快速且稳定）
          onProgress({ step: 'pull', progress: 50, message: '在 VM 内加载镜像（本地磁盘，速度较快）...' })
          log.info('[pullImage] Colima: loading image inside VM')

          await new Promise<void>((resolve, reject) => {
            const loadCmd = `${colimaBin} ssh -- sudo docker load -i ${vmTmpPath}`
            const loadProc = spawn('sh', ['-c', loadCmd], {
              stdio: ['ignore', 'pipe', 'pipe'],
              env: this.execOptions.env as Record<string, string>
            })
            let stdout = '', stderr = ''
            let loadProgress = 50
            loadProc.stdout?.on('data', (d: Buffer) => {
              stdout += d.toString()
              // docker load 输出示例: "Loaded image: armorclaw:lite" 或逐层输出
              const text = d.toString()
              if (text.includes('Loading layer') || text.includes('Loaded')) {
                loadProgress = Math.min(loadProgress + 5, 90)
                const layerMatch = text.match(/Loading layer\s+[\d.]+[kMG]B\/[\d.]+[kMG]B/)
                const msg = layerMatch ? `加载中: ${layerMatch[0]}` : '加载镜像层...'
                onProgress({ step: 'pull', progress: loadProgress, message: msg })
              }
            })
            loadProc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
            // 定时进度更新
            const loadTimer = setInterval(() => {
              if (loadProgress < 85) {
                loadProgress += 2
                onProgress({ step: 'pull', progress: loadProgress, message: '在 VM 内加载镜像...' })
              }
            }, 5000)
            loadProc.on('close', (code) => {
              clearInterval(loadTimer)
              if (code === 0) resolve()
              else reject(new Error(`docker load in VM failed (exit ${code}): ${stderr.slice(-500)}`))
            })
            loadProc.on('error', (err) => { clearInterval(loadTimer); reject(err) })
          })
          log.info('[pullImage] Colima: docker load inside VM completed')

          // 清理 VM 内临时文件
          onProgress({ step: 'pull', progress: 92, message: '清理临时文件...' })
          try {
            await execAsync(`${colimaBin} ssh -- rm -f ${vmTmpPath}`, { ...this.execOptions, timeout: 30000 })
          } catch { /* 清理失败不影响主流程 */ }

        } else {
          // ===== Docker Desktop / WSL2 / Linux 标准路径 =====
          // Docker Desktop 的 VirtioFS (macOS) / Plan9+WSL2 (Windows) 足够稳定，
          // 直接 docker load 不会卡死，但用 spawn 替代 execFile 以提供细粒度进度。
          onProgress({ step: 'pull', progress: 20, message: `从安装包加载镜像（${arch}，可能需要几分钟）...` })
          log.info('[pullImage] Loading bundled tar with spawn for progress reporting, docker:', this.docker)

          await new Promise<void>((resolve, reject) => {
            const loadProc = spawn(this.docker, ['load', '-i', bundledTar], {
              stdio: ['ignore', 'pipe', 'pipe'],
              env: this.execOptions.env as Record<string, string>
            })
            let stdout = '', stderr = ''
            let loadProgress = 20
            loadProc.stdout?.on('data', (d: Buffer) => {
              stdout += d.toString()
              const text = d.toString()
              if (text.includes('Loading layer') || text.includes('Loaded')) {
                loadProgress = Math.min(loadProgress + 5, 90)
                const layerMatch = text.match(/Loading layer\s+[\d.]+[kMG]B\/[\d.]+[kMG]B/)
                const msg = layerMatch ? `加载中: ${layerMatch[0]}` : '加载镜像层...'
                onProgress({ step: 'pull', progress: loadProgress, message: msg })
              }
            })
            loadProc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
            // 定时心跳进度（防止用户觉得卡住）
            const heartbeatTimer = setInterval(() => {
              if (loadProgress < 85) {
                loadProgress += 2
                onProgress({ step: 'pull', progress: loadProgress, message: '正在加载镜像，请耐心等待...' })
              }
            }, 8000)
            loadProc.on('close', (code) => {
              clearInterval(heartbeatTimer)
              if (code === 0) resolve()
              else reject(new Error(`docker load failed (exit ${code}): ${stderr.slice(-500)}`))
            })
            loadProc.on('error', (err) => { clearInterval(heartbeatTimer); reject(err) })
          })
          log.info('[pullImage] docker load completed successfully')
        }

        // Re-detect after loading — the tar could contain full or lite
        this.detectedImage = null  // reset cache
        const loaded = await this.detectAvailableImage()
        if (loaded) {
          onProgress({ step: 'pull', progress: 100, message: `镜像加载完成 (${loaded})` })
          return true
        }
      }

      // No bundled tar — check if an image already exists locally (normal runtime)
      const existing = await this.detectAvailableImage()
      if (existing) {
        onProgress({ step: 'pull', progress: 100, message: `镜像已存在 (${existing})` })
        return true
      }

      // Image not found locally and not bundled — provide guidance
      throw new Error(
        '本地未找到 ArmorClaw 镜像。请在已有镜像的电脑上执行命令导出镜像，然后拷贝到本机加载。'
      )
    } catch (error) {
      log.error('Pull image failed:', error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  async startContainer(): Promise<boolean> {
    try {
      // Check if container exists
      if (await this.containerExists()) {
        if (await this.isContainerRunning()) {
          return true
        }
        // Reuse the stopped container to preserve skill-installed tools
        // (npm -g, go install, brew install, etc. are stored inside the container filesystem).
        // Use restartContainer() if you need to recreate with updated config.
        log.info('Starting existing stopped container (preserving installed tools)...')
        await execAsync(`${this.dockerQuoted} start ${CONTAINER_NAME}`, this.execOptions)
        return true
      }

      // Container doesn't exist, create new one from detected image
      const image = await this.getImageName()
      return await this.startContainerFromImage(image)
    } catch (error) {
      log.error('Start container failed:', error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  /**
   * 导出容器日志到宿主机文件
   * 日志文件位置: ~/.openclaw/logs/openclaw.log
   */
  async exportContainerLogs(): Promise<string> {
    const logDir = getOpenClawLogDir()
    const logFile = require('path').join(logDir, 'openclaw.log')
    try {
      const { stdout } = await execAsync(
        `${this.dockerQuoted} logs --tail 5000 --timestamps ${CONTAINER_NAME}`,
        { ...this.execOptions, maxBuffer: 10 * 1024 * 1024 }
      )
      require('fs').writeFileSync(logFile, stdout, 'utf-8')
      log.info('Container logs exported to:', logFile)
      return logFile
    } catch (error) {
      log.error('Export container logs failed:', error)
      throw error
    }
  }

  /**
   * 获取容器 DNS 参数
   *
   * 策略：公共 DNS 优先，确保容器始终能解析外网域名（飞书、QQ 等）。
   * 宿主机私网 DNS（192.168.x / 10.x / 172.16-31.x）在 Docker 容器内
   * 通常不可达（尤其是 Colima / Docker Desktop 的 VM 网络），因此过滤掉。
   * 只保留宿主机上的公网 DNS 并去重，再与固定公共 DNS 合并，最多传 3 个。
   */
  private async getHostDnsFlags(): Promise<string> {
    // 固定的公共 DNS（阿里 + 腾讯），保证外网可达
    const publicDns = ['223.5.5.5', '119.29.29.29']

    try {
      let hostServers: string[] = []
      if (isMac) {
        const { stdout } = await execAsync('scutil --dns 2>/dev/null | grep "nameserver\\[" | head -5', { timeout: 5000 })
        hostServers = stdout.match(/\d+\.\d+\.\d+\.\d+/g) || []
      } else if (isWindows) {
        const { stdout } = await execAsync('powershell -Command "Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object -ExpandProperty ServerAddresses | Select-Object -First 3"', { timeout: 5000 })
        hostServers = stdout.trim().split(/\r?\n/).filter(s => /^\d+\.\d+\.\d+\.\d+$/.test(s.trim())).map(s => s.trim())
      }

      // 过滤掉私网地址（容器内大概率不可达）
      const isPrivate = (ip: string) => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(ip)
      const hostPublic = hostServers.filter(s => !isPrivate(s))
      if (hostPublic.length > 0) {
        log.info('Detected host public DNS servers:', hostPublic)
      }

      // 合并：公共 DNS 在前（优先级高），宿主机公网 DNS 在后，去重，最多 3 个
      const merged = [...new Set([...publicDns, ...hostPublic])].slice(0, 3)
      log.info('Container DNS config:', merged)
      return merged.map(s => `--dns ${s}`).join(' ')
    } catch (error) {
      log.warn('Failed to detect host DNS, using public DNS defaults:', error)
    }
    return publicDns.map(s => `--dns ${s}`).join(' ')
  }

  /**
   * Stop container with snapshot commit to preserve skill-installed tools.
   * This prevents losing npm -g, go install, uv tool install dependencies
   * when the container is stopped.
   */
  async stopContainer(): Promise<boolean> {
    try {
      // Commit snapshot before stopping to preserve installed tools
      if (await this.isContainerRunning()) {
        try {
          log.info('Committing container snapshot before stop to preserve installed tools...')
          await execAsync(
            `${this.dockerQuoted} commit ${CONTAINER_NAME} ${SNAPSHOT_IMAGE}`,
            { ...this.execOptions, timeout: 120000 }
          )
          log.info('Container snapshot committed successfully before stop.')
        } catch (commitErr) {
          log.warn('Failed to commit snapshot before stop, installed tools may be lost:', commitErr)
        }
      }
      await execAsync(`${this.dockerQuoted} stop ${CONTAINER_NAME}`, this.execOptions)
      return true
    } catch (error) {
      log.error('Stop container failed:', error)
      return false
    }
  }

  /**
   * Restart container: commit snapshot → remove → recreate with latest config.
   * Uses `docker commit` to preserve runtime-installed tools (skill dependencies)
   * before removing the container, then recreates from the snapshot image.
   */
  async restartContainer(): Promise<{ success: boolean; message: string }> {
    try {
      // Step 1: If container exists, commit a snapshot to preserve installed tools
      let useSnapshotImage = false
      if (await this.containerExists()) {
        try {
          log.info('Committing container snapshot to preserve installed tools...')
          await execAsync(
            `${this.dockerQuoted} commit ${CONTAINER_NAME} ${SNAPSHOT_IMAGE}`,
            { ...this.execOptions, timeout: 120000 }
          )
          useSnapshotImage = true
          log.info('Container snapshot committed successfully.')
        } catch (commitErr) {
          log.warn('Failed to commit container snapshot, will use base image:', commitErr)
        }
      }

      // Step 2: Force remove the container
      try {
        await execAsync(`${this.dockerQuoted} rm -f ${CONTAINER_NAME}`, { ...this.execOptions, timeout: 60000 })
      } catch {
        // Container might not exist, continue
      }

      // Step 3: Wait until container is truly gone (up to 10s)
      for (let i = 0; i < 20; i++) {
        const exists = await this.containerExists()
        if (!exists) break
        await new Promise(r => setTimeout(r, 500))
      }

      // Step 4: Recreate container from snapshot (preserves tools) or detected image
      const baseImage = await this.getImageName()
      const started = await this.startContainerFromImage(useSnapshotImage ? SNAPSHOT_IMAGE : baseImage)
      if (!started) {
        // If snapshot image failed, fall back to base image
        if (useSnapshotImage) {
          log.warn('Failed to start from snapshot, falling back to base image...')
          const fallback = await this.startContainerFromImage(baseImage)
          if (!fallback) {
            return { success: false, message: '重启失败：容器创建失败，请检查 Docker 是否正常运行。' }
          }
          await this.cleanupSnapshotImage()
          return { success: true, message: '容器已重启（未能保留运行时安装的工具，已使用基础镜像）。' }
        }
        return { success: false, message: '重启失败：容器创建失败，请检查 Docker 是否正常运行。' }
      }

      return { success: true, message: '容器已重启，所有配置已生效（已保留运行时安装的工具）。' }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '未知错误'
      log.error('Restart container failed:', error)
      return { success: false, message: `重启失败：${errMsg}` }
    }
  }

  /**
   * 确保 openclaw.json 配置文件存在，包含 gateway 必要配置。
   * 容器使用 --bind lan 时，需要 controlUi 的 origin 策略配置，
   * 否则 Electron 客户端的 WebSocket 连接会被 origin 检查拒绝。
   *
   * 同时将所有 provider 的 baseUrl 指向本地代理（:19090），
   * 使 AI 请求经由客户端本地代理注入签名后转发到真实服务端。
   */
  private ensureOpenClawConfig(): void {
    const dataDir = getOpenClawDataDir()
    const configPath = path.join(dataDir, 'openclaw.json')

    // 确保数据目录存在
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    // Electron 生产模式加载本地 HTML 时浏览器发送 origin: "file://"
    // 但 new URL("file://").origin 返回字符串 "null"（非 null），
    // 所以 openclaw 的 origin-check.ts 中 parsedOrigin.origin = "null"
    // 需要将 "null" 加入 allowedOrigins 才能匹配
    const REQUIRED_ORIGINS = ['file://', 'null']

    // 开发模式：Vite dev server 的 origin 也需要加入允许列表
    // process.env.VITE_DEV_SERVER_URL 格式如 "http://localhost:5173/"
    if (process.env.VITE_DEV_SERVER_URL) {
      try {
        const devServerUrl = new URL(process.env.VITE_DEV_SERVER_URL)
        const devServerOrigin = devServerUrl.origin // "http://localhost:5173"
        if (!REQUIRED_ORIGINS.includes(devServerOrigin)) {
          REQUIRED_ORIGINS.push(devServerOrigin)
        }
      } catch {
        // ignore invalid URL
      }
    }

    const requiredGatewayConfig = {
      gateway: {
        mode: 'local' as const,
        controlUi: {
          allowedOrigins: [...REQUIRED_ORIGINS],
        },
      },
      // 禁用 Sandbox 自动清理，用户通过客户端"容器资源管理"主动清理
      agents: {
        defaults: {
          sandbox: {
            prune: {
              idleHours: 0,
              maxAgeDays: 0,
            },
          },
        },
      },
      // Media TTL 设置为最大值 168 小时（7 天）
      // 用户需要在此期间将重要图片/视频保存到本地
      media: {
        ttlHours: 168,
      },
    }

    // 本地代理地址（容器内访问宿主机）
    const hostAddr = detectDockerHostAddress()
    const localProxyBaseUrl = `http://${hostAddr}:19090/api/v1/proxy`

    if (fs.existsSync(configPath)) {
      // 配置文件已存在，确保所需 origin 都在 allowedOrigins 中
      try {
        const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        if (!existing.gateway) existing.gateway = {}
        if (!existing.gateway.controlUi) existing.gateway.controlUi = {}

        const origins: string[] = Array.isArray(existing.gateway.controlUi.allowedOrigins)
          ? existing.gateway.controlUi.allowedOrigins
          : []

        let changed = false
        for (const required of REQUIRED_ORIGINS) {
          if (!origins.includes(required)) {
            origins.push(required)
            changed = true
          }
        }

        // 将所有 provider 的 baseUrl 指向本地代理（只替换 host 部分，保留路径）
        // 同时清除 apiKey，防止容器内 AI 读取到真实密钥
        if (existing.models?.providers) {
          const localUrl = new URL(localProxyBaseUrl)
          const localOrigin = localUrl.origin // http://host.docker.internal:19090

          for (const [name, provider] of Object.entries(existing.models.providers)) {
            const p = provider as { baseUrl?: string; apiKey?: string }

            // 清除真实 apiKey（容器内不需要，由 proxy-server 注入）
            const SAFE_PLACEHOLDERS = ['byok-placeholder', 'platform-managed', '']
            if (p.apiKey && !SAFE_PLACEHOLDERS.includes(p.apiKey)) {
              log.info(`Clearing apiKey for provider "${name}" (was ${p.apiKey.substring(0, 6)}...)`)
              p.apiKey = 'platform-managed'
              changed = true
            }

            if (p.baseUrl) {
              try {
                const currentUrl = new URL(p.baseUrl)
                if (currentUrl.origin !== localOrigin) {
                  const newBaseUrl = localOrigin + currentUrl.pathname
                  log.info(`Rewriting provider "${name}" baseUrl: ${p.baseUrl} -> ${newBaseUrl}`)
                  p.baseUrl = newBaseUrl
                  changed = true
                }
              } catch {
                // 无法解析的 baseUrl，使用原有逻辑直接替换
                if (p.baseUrl !== localProxyBaseUrl) {
                  log.info(`Rewriting provider "${name}" baseUrl: ${p.baseUrl} -> ${localProxyBaseUrl}`)
                  p.baseUrl = localProxyBaseUrl
                  changed = true
                }
              }
            }
          }
        }

        // 确保 Sandbox prune 配置存在且正确（禁用自动清理）
        if (!existing.agents) existing.agents = {}
        if (!existing.agents.defaults) existing.agents.defaults = {}
        if (!existing.agents.defaults.sandbox) existing.agents.defaults.sandbox = {}
        if (!existing.agents.defaults.sandbox.prune) existing.agents.defaults.sandbox.prune = {}
        const prune = existing.agents.defaults.sandbox.prune
        if (prune.idleHours !== 0 || prune.maxAgeDays !== 0) {
          prune.idleHours = 0
          prune.maxAgeDays = 0
          changed = true
          log.info('Set sandbox.prune to disable auto-cleanup (idleHours=0, maxAgeDays=0)')
        }

        // 确保 Media TTL 配置存在且正确（最大 168 小时）
        if (!existing.media) existing.media = {}
        if (existing.media.ttlHours !== 168) {
          existing.media.ttlHours = 168
          changed = true
          log.info('Set media.ttlHours to 168 (7 days)')
        }

        if (changed) {
          existing.gateway.controlUi.allowedOrigins = origins
          fs.writeFileSync(configPath, JSON.stringify(existing, null, 4), 'utf-8')
          log.info('Updated openclaw.json: ensured allowedOrigins and provider baseUrl')
        }
      } catch (err) {
        log.warn('Failed to read/update openclaw.json, will overwrite:', err)
        fs.writeFileSync(configPath, JSON.stringify(requiredGatewayConfig, null, 4), 'utf-8')
      }
    } else {
      // 配置文件不存在，创建初始配置
      fs.writeFileSync(configPath, JSON.stringify(requiredGatewayConfig, null, 4), 'utf-8')
      log.info('Created initial openclaw.json with gateway config')
    }

    // 同时清理 models.json 中可能存在的真实 API Key
    this.cleanupModelsJsonApiKey()
  }

  /**
   * 清理 models.json 中的真实 API Key，替换为占位符
   * 确保真实 API Key 不会存储在 OpenClaw 可访问的文件中
   * 同时将真实 Key 迁移保存到 platform-key.enc（修复历史遗留问题）
   */
  private cleanupModelsJsonApiKey(): void {
    const dataDir = getOpenClawDataDir()
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

      const SAFE_PLACEHOLDERS = ['byok-placeholder', 'platform-managed', '']
      let changed = false

      for (const [providerId, provider] of Object.entries(modelsConfig.providers)) {
        const p = provider as { apiKey?: string }
        if (p.apiKey && !SAFE_PLACEHOLDERS.includes(p.apiKey)) {
          log.info(`[models.json] Clearing apiKey for provider "${providerId}" (was ${p.apiKey.substring(0, 6)}...)`)
          // 迁移：将真实 Key 保存到 platform-key.enc（修复缺失 platform-key.enc 的历史问题）
          try {
            const existingKey = getPlatformKey()
            if (!existingKey) {
              savePlatformKey(p.apiKey)
              log.info(`[models.json] Migrated real API key to platform-key.enc for provider "${providerId}"`)
            }
          } catch (err) {
            log.warn(`[models.json] Failed to migrate API key for provider "${providerId}":`, err)
          }
          p.apiKey = 'platform-managed'
          changed = true
        }
      }

      if (changed) {
        fs.writeFileSync(modelsJsonPath, JSON.stringify(modelsConfig, null, 2), 'utf-8')
        log.info('[models.json] Cleaned up real API keys, replaced with placeholders')
      }
    } catch (err) {
      log.warn('[models.json] Failed to cleanup API keys:', err)
    }
  }

  /**
   * Start container from a specific image (used by restartContainer to support snapshot images).
   * 
   * Named volumes are used for package caches to speed up reinstallation:
   * - armorclaw-npm-cache: npm package cache
   * - armorclaw-go-cache: Go module cache
   * 
   * Note: We intentionally don't persist tool installation directories
   * (/usr/local/lib/node_modules, /home/node/go/bin) because:
   * 1. Version compatibility issues when upgrading base image
   * 2. May conflict with pre-installed tools in new images
   * 3. docker commit (P0) + installed-tools.json (P2) provide better fallback
   */
  private async startContainerFromImage(image: string): Promise<boolean> {
    try {
      // 确保 openclaw 配置文件包含 gateway origin 策略
      this.ensureOpenClawConfig()

      const proxyEnv = getDockerEnvVars()
      const useHostNetwork = shouldUseHostNetwork()
      const addHostFlag = needsAddHostFlag()
        ? '--add-host host.docker.internal:host-gateway'
        : ''
      const networkFlag = useHostNetwork ? '--network host' : `-p ${CONTAINER_PORT}:${CONTAINER_PORT}`
      const dataDir = getOpenClawDataDir()
      const logDir = getOpenClawLogDir()
      const dnsFlags = await this.getHostDnsFlags()
      const resources = getContainerResourceConfig()

      // Named volumes for package caches (persist across container recreations)
      // These speed up reinstallation without version compatibility issues
      // - npm: ~/.npm for npm global install cache
      // - Go: ~/go/pkg/mod/cache for Go module cache
      // - uv: ~/.cache/uv for uv tool install cache
      const cacheVolumes = `\
        -v armorclaw-npm-cache:/home/node/.npm \
        -v armorclaw-go-cache:/home/node/go/pkg/mod/cache \
        -v armorclaw-uv-cache:/home/node/.cache/uv`

      // Container logs: mount /tmp/openclaw to host for persistence
      // OpenClaw kernel logs to /tmp/openclaw/openclaw-YYYY-MM-DD.log by default
      const containerLogsVolume = `-v "${dataDir}/container-logs:/tmp/openclaw"`

      const cmd = `${this.dockerQuoted} run -d \
        --name ${CONTAINER_NAME} \
        --restart unless-stopped \
        ${networkFlag} \
        -v "${dataDir}:/home/node/.openclaw" \
        ${containerLogsVolume} \
        ${cacheVolumes} \
        -e OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN} \
        -e OPENCLAW_PROXY_BASE_URL=${proxyEnv.baseUrl} \
        -e GOPROXY=https://goproxy.cn,direct \
        ${addHostFlag} \
        ${dnsFlags} \
        --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
        --cap-drop ALL \
        --cap-add NET_BIND_SERVICE \
        --security-opt no-new-privileges \
        --cpus=${resources.cpus} --memory=${resources.memoryMB}m --memory-swap=${resources.memoryMB * 2}m \
        --pids-limit=${resources.pidsLimit} \
        --ulimit nofile=${resources.nofileLimit}:${resources.nofileLimit} \
        ${image} node openclaw.mjs gateway --allow-unconfigured --bind lan --token ${GATEWAY_TOKEN}`

      await execAsync(cmd, { ...this.execOptions, timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
      log.info(`Container started from image: ${image}, log dir:`, logDir)

      // If we started from base image (not snapshot), reinstall tools from manifest
      if (image !== SNAPSHOT_IMAGE && hasInstalledTools()) {
        log.info('Container started from base image, checking for tools to reinstall...')
        await this.reinstallToolsFromManifest()
      }

      return true
    } catch (error) {
      log.error(`Start container from image ${image} failed:`, error)
      return false
    }
  }

  /**
   * Reinstall tools from the installed-tools.json manifest.
   * Called when container is created from base image (not snapshot).
   */
  private async reinstallToolsFromManifest(): Promise<void> {
    const commands = generateReinstallCommands()
    if (commands.length === 0) {
      return
    }

    log.info(`Reinstalling ${commands.length} tools from manifest: ${getToolsSummary()}`)

    for (const cmd of commands) {
      try {
        // Execute installation command in container
        await execAsync(
          `${this.dockerQuoted} exec ${CONTAINER_NAME} sh -c "${cmd}"`,
          { ...this.execOptions, timeout: 300000 } // 5 min timeout per tool
        )
        log.info(`Reinstalled tool: ${cmd.split(' ')[2] || cmd}`)
      } catch (err) {
        log.warn(`Failed to reinstall tool: ${cmd}`, err)
        // Continue with other tools
      }
    }

    log.info('Tool reinstallation from manifest completed')
  }

  /**
   * Clean up the snapshot image to free disk space.
   * Called after successful restart from snapshot, or when snapshot is no longer needed.
   */
  private async cleanupSnapshotImage(): Promise<void> {
    try {
      await execAsync(`${this.dockerQuoted} rmi ${SNAPSHOT_IMAGE}`, { ...this.execOptions, timeout: 30000 })
      log.info('Cleaned up snapshot image.')
    } catch {
      // Snapshot image might not exist or is in use, ignore
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${CONTAINER_PORT}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  // Auto-approve pending device pairing requests from localhost
  async autoApproveDevices(): Promise<void> {
    try {
      // List pending devices — use try/catch instead of shell 2>/dev/null
      let stdout = ''
      try {
        const result = await execAsync(
          `${this.dockerQuoted} exec -e OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN} ${CONTAINER_NAME} node openclaw.mjs devices list --json`,
          { ...this.execOptions, timeout: 10000 }
        )
        stdout = result.stdout
      } catch {
        stdout = '{}'
      }

      // Parse the output to find pending requests
      const lines = stdout.split('\n')
      for (const line of lines) {
        const uuidMatch = line.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
        if (uuidMatch) {
          const requestId = uuidMatch[1]
          await execAsync(
            `${this.dockerQuoted} exec -e OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN} ${CONTAINER_NAME} node openclaw.mjs devices approve ${requestId}`,
            { ...this.execOptions, timeout: 10000 }
          )
          log.info(`Auto-approved device: ${requestId}`)
        }
      }
    } catch (error) {
      log.error('Auto-approve devices failed:', error)
    }
  }

  // 批准 IM 配对请求（如飞书 pairing）
  async approvePairing(provider: string, code: string): Promise<{ success: boolean; message: string }> {
    try {
      const result = await execAsync(
        `${this.dockerQuoted} exec -e OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN} ${CONTAINER_NAME} node openclaw.mjs pairing approve ${provider} ${code}`,
        { ...this.execOptions, timeout: 15000 }
      )
      log.info(`Pairing approved: provider=${provider}, code=${code}, stdout=${result.stdout.trim()}`)
      return { success: true, message: '配对批准成功' }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      log.error(`Pairing approve failed: ${raw}`)
      // 提取关键错误信息，过滤掉插件加载等噪音日志
      const match = raw.match(/No pending pairing request found for code:\s*\S+/)
      const msg = match ? '配对码无效或已过期，请重新获取配对码' : '配对失败，请检查配对码是否正确'
      return { success: false, message: msg }
    }
  }

  getServiceUrl(): string {
    return `http://127.0.0.1:${CONTAINER_PORT}/?token=${GATEWAY_TOKEN}`
  }

  getServicePort(): number {
    return CONTAINER_PORT
  }

  /**
   * Get container resource limits and real-time usage
   */
  async getContainerResources(): Promise<{
    limits: { cpus: number; memoryMB: number; pidsLimit: number; nofileLimit: number; diskLimitMB: number }
    usage: { cpuPercent: number; memoryUsageMB: number; memoryPercent: number; pids: number; netIO: string; blockIO: string; diskUsageMB: number }
    security: { capDrop: string[]; capAdd: string[]; securityOpt: string[]; networkMode: string; readOnly: boolean; user: string }
  }> {
    const resourceConfig = getContainerResourceConfig()

    // Get limits + security config from docker inspect
    const { stdout: inspectOut } = await execAsync(
      `${this.dockerQuoted} inspect --format "{{json .HostConfig}}" ${CONTAINER_NAME}`,
      this.execOptions
    )
    const hostConfig = JSON.parse(inspectOut.trim())

    const limits = {
      cpus: hostConfig.NanoCpus ? hostConfig.NanoCpus / 1e9 : 0,
      memoryMB: hostConfig.Memory ? Math.round(hostConfig.Memory / 1024 / 1024) : 0,
      pidsLimit: hostConfig.PidsLimit || 0,
      nofileLimit: hostConfig.Ulimits?.find((u: { Name: string }) => u.Name === 'nofile')?.Hard || 0,
      diskLimitMB: resourceConfig.diskLimitMB || 5120,
    }

    const security = {
      capDrop: hostConfig.CapDrop || [],
      capAdd: hostConfig.CapAdd || [],
      securityOpt: hostConfig.SecurityOpt || [],
      networkMode: hostConfig.NetworkMode || 'default',
      readOnly: hostConfig.ReadonlyRootfs || false,
      user: '',
    }

    // Get user from container config
    try {
      const { stdout: userOut } = await execAsync(
        `${this.dockerQuoted} inspect --format "{{.Config.User}}" ${CONTAINER_NAME}`,
        this.execOptions
      )
      security.user = userOut.trim() || 'root'
    } catch {
      security.user = 'unknown'
    }

    // Get real-time usage from docker stats
    let usage = { cpuPercent: 0, memoryUsageMB: 0, memoryPercent: 0, pids: 0, netIO: '--', blockIO: '--', diskUsageMB: 0 }
    try {
      const { stdout: statsOut } = await execAsync(
        `${this.dockerQuoted} stats ${CONTAINER_NAME} --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.PIDs}}|{{.NetIO}}|{{.BlockIO}}"`,
        { ...this.execOptions, timeout: 10000 }
      )
      const parts = statsOut.trim().split('|')
      if (parts.length >= 6) {
        usage.cpuPercent = parseFloat(parts[0].replace('%', '')) || 0
        const memMatch = parts[1].match(/([\d.]+)(\w+)/)
        if (memMatch) {
          const val = parseFloat(memMatch[1])
          const unit = memMatch[2].toLowerCase()
          usage.memoryUsageMB = unit.includes('gib') ? val * 1024 : unit.includes('mib') ? val : val / 1024
        }
        usage.memoryPercent = parseFloat(parts[2].replace('%', '')) || 0
        usage.pids = parseInt(parts[3]) || 0
        usage.netIO = parts[4].trim()
        usage.blockIO = parts[5].trim()
      }
    } catch {
      // Container might not be running
    }

    // Get disk usage via du inside container — use try/catch instead of 2>/dev/null
    try {
      const { stdout: duOut } = await execAsync(
        `${this.dockerQuoted} exec ${CONTAINER_NAME} du -sm /home/node/.openclaw`,
        { ...this.execOptions, timeout: 10000 }
      )
      const duMatch = duOut.trim().match(/^(\d+)/)
      if (duMatch) {
        usage.diskUsageMB = parseInt(duMatch[1]) || 0
      }
    } catch {
      // ignore
    }

    return { limits, usage, security }
  }

  /**
   * Update container resource limits dynamically via `docker update`.
   */
  async updateContainerResources(resources: ContainerResourceConfig): Promise<{ success: boolean; needsRestart: boolean; message: string }> {
    const currentConfig = getContainerResourceConfig()
    const needsRestart = resources.nofileLimit !== currentConfig.nofileLimit

    // Save to config file first
    saveContainerResourceConfig(resources)

    try {
      const swapMB = resources.memoryMB * 2
      await execAsync(
        `${this.dockerQuoted} update --cpus=${resources.cpus} --memory=${resources.memoryMB}m --memory-swap=${swapMB}m --pids-limit=${resources.pidsLimit} ${CONTAINER_NAME}`,
        this.execOptions
      )

      if (needsRestart) {
        return {
          success: true,
          needsRestart: true,
          message: '文件描述符限制已保存，需要重启容器才能生效。CPU、内存、进程数限制已即时生效。'
        }
      }
      return { success: true, needsRestart: false, message: '资源限制已更新并即时生效。' }
    } catch (error) {
      return {
        success: false,
        needsRestart: false,
        message: `更新失败：${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * Install Go toolchain into the running container.
   * Downloads a Go tarball on the host, copies into container, extracts.
   */
  async installGoToolchain(onProgress?: (progress: InstallProgress) => void): Promise<boolean> {
    const GO_VERSION = '1.23.6'

    try {
      // Step 1: Check if Go is already installed in the container
      onProgress?.({ step: 'check', progress: 10, message: '检查 Go 工具链...' })
      try {
        const { stdout } = await execAsync(
          `${this.dockerQuoted} exec ${CONTAINER_NAME} /usr/local/go/bin/go version`,
          this.execOptions
        )
        if (stdout.includes('go')) {
          onProgress?.({ step: 'done', progress: 100, message: 'Go 工具链已安装' })
          return true
        }
      } catch {
        // Go not installed, continue
      }

      // Step 2: Detect container CPU architecture
      onProgress?.({ step: 'detect', progress: 15, message: '检测系统架构...' })
      const { stdout: archOut } = await execAsync(
        `${this.dockerQuoted} exec ${CONTAINER_NAME} uname -m`,
        this.execOptions
      )
      const uname = archOut.trim()
      const arch = uname === 'aarch64' ? 'arm64' : 'amd64'

      // Step 3: Download Go tarball to host temp directory
      const tarball = `go${GO_VERSION}.linux-${arch}.tar.gz`
      const downloadUrl = `https://go.dev/dl/${tarball}`
      const localTarball = `${tmpdir()}/${tarball}`

      onProgress?.({ step: 'download', progress: 20, message: '下载 Go 工具链...' })
      await execAsync(
        `curl -fsSL -o "${localTarball}" "${downloadUrl}"`,
        { ...this.execOptions, timeout: 300000 }
      )

      // Step 4: Copy tarball into container
      onProgress?.({ step: 'copy', progress: 60, message: '复制到容器...' })
      await execAsync(
        `${this.dockerQuoted} cp "${localTarball}" ${CONTAINER_NAME}:/tmp/go.tar.gz`,
        this.execOptions
      )

      // Step 5: Extract in container as root
      onProgress?.({ step: 'extract', progress: 75, message: '安装 Go 工具链...' })
      await execAsync(
        `${this.dockerQuoted} exec -u root ${CONTAINER_NAME} tar -C /usr/local -xzf /tmp/go.tar.gz`,
        { ...this.execOptions, timeout: 60000 }
      )

      // Step 6: Create symlinks
      await execAsync(
        `${this.dockerQuoted} exec -u root ${CONTAINER_NAME} ln -sf /usr/local/go/bin/go /usr/local/bin/go`,
        this.execOptions
      )
      await execAsync(
        `${this.dockerQuoted} exec -u root ${CONTAINER_NAME} ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt`,
        this.execOptions
      )

      // Step 6.5: Configure GOPROXY
      await execAsync(
        `${this.dockerQuoted} exec ${CONTAINER_NAME} go env -w GOPROXY=https://goproxy.cn,direct`,
        this.execOptions
      )

      // Step 7: Clean up temp files (container side)
      await execAsync(
        `${this.dockerQuoted} exec -u root ${CONTAINER_NAME} rm -f /tmp/go.tar.gz`,
        this.execOptions
      )
      // Clean up host side — cross-platform file deletion
      await safeUnlink(localTarball)

      // Step 8: Verify installation
      onProgress?.({ step: 'verify', progress: 90, message: '验证安装...' })
      const { stdout: verifyOut } = await execAsync(
        `${this.dockerQuoted} exec ${CONTAINER_NAME} go version`,
        this.execOptions
      )

      if (!verifyOut.includes('go')) {
        throw new Error('Go 安装验证失败')
      }

      onProgress?.({ step: 'done', progress: 100, message: 'Go 工具链安装完成' })
      return true
    } catch (error) {
      log.error('Install Go toolchain failed:', error)
      return false
    }
  }
}
