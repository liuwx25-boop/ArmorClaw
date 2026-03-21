import { contextBridge, ipcRenderer } from 'electron'

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

export interface ArmorClawConfig {
  proxyService: {
    baseUrl: string
    apiKey: string
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  docker: {
    checkStatus: (): Promise<DockerStatus> => ipcRenderer.invoke('docker:check-status'),
    installColima: (): Promise<boolean> => ipcRenderer.invoke('docker:install-colima'),
    startColima: (): Promise<boolean> => ipcRenderer.invoke('docker:start-colima'),
    pullImage: (): Promise<boolean> => ipcRenderer.invoke('docker:pull-image'),
    startContainer: (): Promise<boolean> => ipcRenderer.invoke('docker:start-container'),
    stopContainer: (): Promise<boolean> => ipcRenderer.invoke('docker:stop-container'),
    restartContainer: (): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke('docker:restart-container'),
    healthCheck: (): Promise<boolean> => ipcRenderer.invoke('docker:health-check'),
    autoApproveDevices: (): Promise<void> => ipcRenderer.invoke('docker:auto-approve-devices'),
    approvePairing: (provider: string, code: string): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('docker:approve-pairing', provider, code),
    getServiceUrl: (): Promise<string> => ipcRenderer.invoke('docker:get-service-url'),
    onInstallProgress: (callback: (progress: InstallProgress) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, progress: InstallProgress) => callback(progress)
      ipcRenderer.on('docker:install-progress', handler)
      return () => ipcRenderer.removeListener('docker:install-progress', handler)
    },
    onPullProgress: (callback: (progress: InstallProgress) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, progress: InstallProgress) => callback(progress)
      ipcRenderer.on('docker:pull-progress', handler)
      return () => ipcRenderer.removeListener('docker:pull-progress', handler)
    },
    installGoToolchain: (): Promise<boolean> => ipcRenderer.invoke('docker:install-go-toolchain'),
    onGoInstallProgress: (callback: (progress: InstallProgress) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, progress: InstallProgress) => callback(progress)
      ipcRenderer.on('docker:go-install-progress', handler)
      return () => ipcRenderer.removeListener('docker:go-install-progress', handler)
    },
    getContainerResources: (): Promise<{
      limits: { cpus: number; memoryMB: number; pidsLimit: number; nofileLimit: number; diskLimitMB: number }
      usage: { cpuPercent: number; memoryUsageMB: number; memoryPercent: number; pids: number; netIO: string; blockIO: string; diskUsageMB: number }
      security: { capDrop: string[]; capAdd: string[]; securityOpt: string[]; networkMode: string; readOnly: boolean; user: string }
    }> => ipcRenderer.invoke('docker:get-container-resources'),
    updateContainerResources: (resources: {
      cpus: number; memoryMB: number; pidsLimit: number; nofileLimit: number; diskLimitMB: number
    }): Promise<{ success: boolean; needsRestart: boolean; message: string }> =>
      ipcRenderer.invoke('docker:update-container-resources', resources),
    // Windows WSL2 相关 API
    checkWSL2: (): Promise<{ installed: boolean }> =>
      ipcRenderer.invoke('docker:check-wsl2'),
    installWSL2: (): Promise<{ success: boolean; needsReboot: boolean; message: string }> =>
      ipcRenderer.invoke('docker:install-wsl2'),
    checkWSL2Distro: (): Promise<{ hasDistro: boolean }> =>
      ipcRenderer.invoke('docker:check-wsl2-distro'),
    installWSL2Distro: (): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke('docker:install-wsl2-distro'),
  },
  terminal: {
    spawn: (rows: number, cols: number): Promise<void> =>
      ipcRenderer.invoke('terminal:spawn', { rows, cols }),
    write: (data: string): void =>
      ipcRenderer.send('terminal:write', data),
    resize: (rows: number, cols: number): void =>
      ipcRenderer.send('terminal:resize', { rows, cols }),
    destroy: (): void =>
      ipcRenderer.send('terminal:destroy'),
    onData: (callback: (data: string) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: string) => callback(data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    onExit: (callback: (code: number) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: { code: number }) => callback(payload.code)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    }
  },
  config: {
    load: (): Promise<ArmorClawConfig> => ipcRenderer.invoke('config:load'),
    save: (config: ArmorClawConfig): Promise<boolean> => ipcRenderer.invoke('config:save', config),
    getPath: (): Promise<string> => ipcRenderer.invoke('config:get-path'),
    /** 获取本地代理的 baseUrl（容器内访问宿主机 :19090） */
    getProxyBaseUrl: (): Promise<string> => ipcRenderer.invoke('config:get-proxy-base-url'),
    /** 获取服务端 API 地址（从 ~/.armorclaw/config.json 读取） */
    getServerBaseUrl: (): Promise<string> => ipcRenderer.invoke('config:get-server-base-url'),
  },
  clientSecret: {
    /** 上报 clientSecret 哈希到服务端 */
    upload: (serverBaseUrl: string, jwtToken: string): Promise<boolean> =>
      ipcRenderer.invoke('client-secret:upload', { serverBaseUrl, jwtToken }),
    /** 获取 secret 哈希（SHA256） */
    getHash: (): Promise<string | null> =>
      ipcRenderer.invoke('client-secret:get-hash'),
  },
  skillInstall: {
    execute: (params: {
      skillName: string
      installId: string
      installSpec: { id: string; kind: string; label: string; bins: string[]; package?: string; formula?: string; module?: string; url?: string; os?: string[] }
      timeoutMs?: number
    }): Promise<{ ok: boolean; message: string; stdout: string; stderr: string; code: number | null }> =>
      ipcRenderer.invoke('skill-install:execute', params),
  },
  customSkill: {
    /** 弹出文件选择对话框，让用户选择 SKILL.md 文件或包含 SKILL.md 的文件夹 */
    selectAndImport: (mode: 'file' | 'folder'): Promise<{ ok: boolean; skillName?: string; message: string }> =>
      ipcRenderer.invoke('custom-skill:import', mode),
    /** 列出已安装的自定义技能 */
    list: (): Promise<{ name: string; description: string; hasExtra: boolean; modifiedAt: string }[]> =>
      ipcRenderer.invoke('custom-skill:list'),
    /** 删除自定义技能 */
    remove: (skillName: string): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('custom-skill:remove', skillName),
    /** 读取 SKILL.md 内容 */
    read: (skillName: string): Promise<string> =>
      ipcRenderer.invoke('custom-skill:read', skillName),
  },
  window: {
    /** 更新 Windows titleBarOverlay 颜色（跟随主题切换） */
    setTitleBarOverlay: (options: { color: string; symbolColor: string }): Promise<void> =>
      ipcRenderer.invoke('window:set-titlebar-overlay', options),
  },
  byok: {
    save: (params: { providerId: string; baseUrl: string; apiKey: string; modelName: string }): Promise<void> =>
      ipcRenderer.invoke('byok:save', params),
    delete: (params: { providerId: string }): Promise<void> =>
      ipcRenderer.invoke('byok:delete', params),
    list: (): Promise<{ providerId: string; providerName: string; baseUrl: string; modelName: string; apiKeyMasked: string }[]> =>
      ipcRenderer.invoke('byok:list'),
    test: (params: { baseUrl: string; apiKey: string; modelName: string }): Promise<{ success: boolean; message: string; latencyMs?: number }> =>
      ipcRenderer.invoke('byok:test', params),
    updateModel: (params: { providerId: string; modelName: string }): Promise<void> =>
      ipcRenderer.invoke('byok:update-model', params),
    savePlatformKey: (params: { apiKey: string }): Promise<void> =>
      ipcRenderer.invoke('byok:save-platform-key', params),
    clearPlatformKey: (): Promise<void> =>
      ipcRenderer.invoke('byok:clear-platform-key'),
  },
  modelsJson: {
    cleanupProvider: (params: { providerId: string }): Promise<void> =>
      ipcRenderer.invoke('models-json:cleanup-provider', params),
    cleanupByApiKey: (params: { apiKey: string }): Promise<void> =>
      ipcRenderer.invoke('models-json:cleanup-by-apikey', params),
  },
  shell: {
    /** 在系统默认浏览器中打开外部链接 */
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  },
  files: {
    listDirectory: (relativePath: string): Promise<{ name: string; isDirectory: boolean; size: number; modifiedAt: string }[]> =>
      ipcRenderer.invoke('files:list-directory', relativePath),
    saveAs: (relativePath: string): Promise<boolean> =>
      ipcRenderer.invoke('files:save-as', relativePath),
    openInSystem: (relativePath: string): Promise<void> =>
      ipcRenderer.invoke('files:open-in-system', relativePath),
    getRootDir: (): Promise<string> =>
      ipcRenderer.invoke('files:get-root-dir'),
  }
})
