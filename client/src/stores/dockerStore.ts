import { create } from 'zustand'

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

export interface InstallProgress {
  step: string
  progress: number
  message: string
}

interface DockerState extends DockerStatus {
  isChecking: boolean
  isInstalling: boolean
  installProgress: InstallProgress | null
  error: string | null
  
  checkStatus: () => Promise<void>
  installDocker: () => Promise<void>
  startContainer: () => Promise<void>
  stopContainer: () => Promise<void>
}

const initialStatus: DockerStatus = {
  platform: 'macos',
  dockerDesktopInstalled: false,
  colimaInstalled: false,
  wsl2Installed: false,
  dockerRunning: false,
  containerExists: false,
  containerRunning: false,
  needsSetup: true
}

export const useDockerStore = create<DockerState>((set, get) => ({
  ...initialStatus,
  isChecking: true,
  isInstalling: false,
  installProgress: null,
  error: null,

  checkStatus: async () => {
    set({ isChecking: true, error: null })
    try {
      const status = await window.electronAPI.docker.checkStatus()
      set({ ...status, isChecking: false })
    } catch (error) {
      set({ isChecking: false, error: '检查环境失败' })
    }
  },

  installDocker: async () => {
    set({ isInstalling: true, error: null })
    
    // Listen for progress updates (保存 cleanup 函数，避免监听器累积)
    const cleanupInstall = window.electronAPI.docker.onInstallProgress((progress) => {
      set({ installProgress: progress })
    })
    
    const cleanupPull = window.electronAPI.docker.onPullProgress((progress) => {
      set({ installProgress: progress })
    })

    try {
      let status = await window.electronAPI.docker.checkStatus()
      
      // Step 1: Install Docker environment if needed (cross-platform)
      // macOS: install Colima or use Docker Desktop
      // Windows: Docker Desktop or WSL2 + Docker Engine
      if (!status.dockerDesktopInstalled && !status.colimaInstalled) {
        // On Windows, check WSL2 first
        if (status.platform === 'windows' && !status.wsl2Installed) {
          set({ installProgress: { step: 'wsl2', progress: 0, message: '检查 WSL2 环境...' } })
        }
        
        set({ installProgress: { step: 'install', progress: 0, message: '安装 Docker 环境...' } })
        let installed = false
        try {
          installed = await window.electronAPI.docker.installColima()
        } catch (e) {
          // IPC 层抛出的具体错误（如 Homebrew 未安装）直接透传给用户
          throw e instanceof Error ? e : new Error(String(e))
        }
        if (!installed) {
          // Check if WSL2 needs reboot (Windows specific)
          if (status.platform === 'windows') {
            throw new Error('Docker 环境安装未完成。如果提示需要重启系统，请重启后再次打开 ArmorClaw。')
          }
          throw new Error('安装 Docker 环境失败，请查看日志获取详细信息')
        }
      }

      // Step 2: Start Docker runtime
      if (!status.dockerRunning) {
        set({ installProgress: { step: 'start', progress: 20, message: '启动 Docker...' } })
        if (status.colimaInstalled || status.wsl2Installed || (!status.dockerDesktopInstalled)) {
          const started = await window.electronAPI.docker.startColima()
          if (!started) {
            throw new Error('启动 Docker 失败')
          }
        }
        // Verify Docker is now running
        status = await window.electronAPI.docker.checkStatus()
        if (!status.dockerRunning) {
          throw new Error('Docker 启动失败，请检查 Docker 环境')
        }
      }

      // Step 3: Pull image
      set({ installProgress: { step: 'pull', progress: 40, message: '检查 ArmorClaw 镜像...' } })
      try {
        await window.electronAPI.docker.pullImage()
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e))
      }

      // Step 4: Start container
      set({ installProgress: { step: 'container', progress: 60, message: '启动 ArmorClaw 容器...' } })
      try {
        await window.electronAPI.docker.startContainer()
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e))
      }

      // Step 5: Wait for container to be in running state
      set({ installProgress: { step: 'check', progress: 70, message: '等待容器就绪...' } })
      let containerReady = false
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const st = await window.electronAPI.docker.checkStatus()
        if (st.containerRunning) {
          containerReady = true
          break
        }
      }
      if (!containerReady) {
        throw new Error('容器启动异常，请查看容器日志')
      }

      // Step 6: Health check — 首次冷启动较慢，给足等待时间
      set({ installProgress: { step: 'check', progress: 80, message: '等待服务启动...' } })
      let healthy = false
      const maxRetries = 120  // 最多等待 240 秒（120 × 2s）
      for (let i = 0; i < maxRetries; i++) {
        await new Promise(r => setTimeout(r, 2000))
        healthy = await window.electronAPI.docker.healthCheck()
        if (healthy) break
        // 渐进式提示，让用户了解进度
        const elapsed = (i + 1) * 2
        const hint = elapsed <= 30
          ? '正在初始化服务组件...'
          : elapsed <= 90
          ? '首次启动需要较长时间，请耐心等待...'
          : `仍在启动中，已等待 ${elapsed} 秒...`
        set({ installProgress: { step: 'check', progress: 80 + Math.floor((i / maxRetries) * 18), message: hint } })
      }

      if (!healthy) {
        // 超时后检查容器是否仍在运行 — 如果是则给软提示而非报错
        const finalStatus = await window.electronAPI.docker.checkStatus()
        if (finalStatus.containerRunning) {
          // 容器在运行但服务还没就绪，提示用户稍后重试而非报错
          set({ installProgress: { step: 'done', progress: 100, message: '容器已启动，服务仍在加载中，请稍后重新打开客户端' } })
          await get().checkStatus()
          return
        }
        throw new Error('服务启动超时，请查看容器日志排查问题')
      }

      set({ installProgress: { step: 'done', progress: 100, message: '安装完成' } })
      
      // Refresh status
      await get().checkStatus()
      
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '安装失败' })
    } finally {
      cleanupInstall()
      cleanupPull()
      set({ isInstalling: false })
    }
  },

  startContainer: async () => {
    try {
      await window.electronAPI.docker.startContainer()
      await get().checkStatus()
    } catch (error) {
      set({ error: '启动容器失败' })
    }
  },

  stopContainer: async () => {
    try {
      await window.electronAPI.docker.stopContainer()
      await get().checkStatus()
    } catch (error) {
      set({ error: '停止容器失败' })
    }
  }
}))

// TypeScript declaration for window.electronAPI
declare global {
  interface Window {
    electronAPI: {
      docker: {
        checkStatus: () => Promise<DockerStatus>
        installColima: () => Promise<boolean>
        startColima: () => Promise<boolean>
        pullImage: () => Promise<boolean>
        startContainer: () => Promise<boolean>
        stopContainer: () => Promise<boolean>
        restartContainer: () => Promise<{ success: boolean; message: string }>
        healthCheck: () => Promise<boolean>
        autoApproveDevices: () => Promise<void>
        getServiceUrl: () => Promise<string>
        installGoToolchain: () => Promise<boolean>
        onInstallProgress: (callback: (progress: InstallProgress) => void) => () => void
        onPullProgress: (callback: (progress: InstallProgress) => void) => () => void
        onGoInstallProgress: (callback: (progress: InstallProgress) => void) => () => void
        getContainerResources: () => Promise<{
          limits: { cpus: number; memoryMB: number; pidsLimit: number; nofileLimit: number; diskLimitMB: number }
          usage: { cpuPercent: number; memoryUsageMB: number; memoryPercent: number; pids: number; netIO: string; blockIO: string; diskUsageMB: number }
          security: { capDrop: string[]; capAdd: string[]; securityOpt: string[]; networkMode: string; readOnly: boolean; user: string }
        }>
        updateContainerResources: (resources: {
          cpus: number; memoryMB: number; pidsLimit: number; nofileLimit: number; diskLimitMB: number
        }) => Promise<{ success: boolean; needsRestart: boolean; message: string }>
        approvePairing: (provider: string, code: string) => Promise<{ success: boolean; message: string }>
        // Windows WSL2 相关 API
        checkWSL2: () => Promise<{ installed: boolean }>
        installWSL2: () => Promise<{ success: boolean; needsReboot: boolean; message: string }>
        checkWSL2Distro: () => Promise<{ hasDistro: boolean }>
        installWSL2Distro: () => Promise<{ success: boolean; message: string }>
      }
      terminal: {
        spawn: (rows: number, cols: number) => Promise<void>
        write: (data: string) => void
        resize: (rows: number, cols: number) => void
        destroy: () => void
        onData: (callback: (data: string) => void) => () => void
        onExit: (callback: (code: number) => void) => () => void
      }
      files: {
        listDirectory: (relativePath: string) => Promise<{ name: string; isDirectory: boolean; size: number; modifiedAt: string }[]>
        saveAs: (relativePath: string) => Promise<boolean>
        openInSystem: (relativePath: string) => Promise<void>
        getRootDir: () => Promise<string>
      }
      clientSecret: {
        upload: (serverBaseUrl: string, jwtToken: string) => Promise<boolean>
        getHash: () => Promise<string | null>
      }
      byok: {
        save: (params: { providerId: string; baseUrl: string; apiKey: string; modelName: string }) => Promise<void>
        delete: (params: { providerId: string }) => Promise<void>
        list: () => Promise<{ providerId: string; providerName: string; baseUrl: string; modelName: string; apiKeyMasked: string }[]>
        test: (params: { baseUrl: string; apiKey: string; modelName: string }) => Promise<{ success: boolean; message: string; latencyMs?: number }>
        updateModel: (params: { providerId: string; modelName: string }) => Promise<void>
        savePlatformKey: (params: { apiKey: string }) => Promise<void>
        clearPlatformKey: () => Promise<void>
      }
      config: {
        load: () => Promise<unknown>
        save: (config: unknown) => Promise<boolean>
        getPath: () => Promise<string>
        getProxyBaseUrl: () => Promise<string>
      }
      window: {
        setTitleBarOverlay: (options: { color: string; symbolColor: string }) => Promise<void>
      }
      modelsJson: {
        cleanupProvider: (params: { providerId: string }) => Promise<void>
        cleanupByApiKey: (params: { apiKey: string }) => Promise<void>
      }
      shell: {
        openExternal: (url: string) => Promise<void>
      }
    }
  }
}
