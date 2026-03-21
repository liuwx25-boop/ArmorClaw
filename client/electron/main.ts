import { app, BrowserWindow, ipcMain, nativeImage, dialog, Menu } from 'electron'
import path from 'path'
import * as fs from 'fs'
import log from './logger'
import { DockerManager } from './docker-manager'
import { TerminalManager } from './terminal-manager'
import { loadConfig, saveConfig, getConfigPath, ensureConfigExists, ArmorClawConfig, detectDockerHostAddress, getServerApiBaseUrl } from './config-manager'
import { SkillInstallManager } from './skill-install-manager'
import { FileManager } from './file-manager'
import { CustomSkillManager } from './custom-skill-manager'
import { isMac, isWindows } from './utils/platform'
import { WSL2DockerProvider } from './providers/win-wsl2-docker'
import { initClientSecret, uploadClientSecret, getSecretHash } from './client-secret-manager'
import { startProxyServer, stopProxyServer } from './proxy-server'
import { initBYOKManager, byokSave, byokDelete, byokList, byokTest, byokUpdateModel, deleteProviderFromModelsJson, deleteProvidersByApiKeyFromModelsJson, savePlatformKey, clearPlatformKey, migrateModelsJsonKeys } from './byok-manager'
import { getAppIconPath, getAppName } from './branding'
import { fixInvalidControlUiOrigins } from './fix-openclaw-config'

// 设置应用名称（从 branding.json 读取）
app.setName(getAppName())

// 开发模式下 macOS Dock 显示自定义图标
if (isMac && !app.isPackaged) {
  const devIconPath = getAppIconPath()
  app.whenReady().then(() => {
    try {
      const icon = nativeImage.createFromPath(devIconPath)
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon)
      }
    } catch (e) {
      log.warn('Failed to set dock icon:', e)
    }
  })
}

log.info('ArmorClaw starting, version:', app.getVersion())
log.info('Log file:', log.transports.file.getFile()?.path)

// 单实例锁：防止多个 Electron 进程同时运行
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  log.info('Another instance is already running, quitting.')
  app.quit()
} else {

let mainWindow: BrowserWindow | null = null
const dockerManager = new DockerManager()
const terminalManager = new TerminalManager()
const skillInstallManager = new SkillInstallManager()
const fileManager = new FileManager()
const customSkillManager = new CustomSkillManager()

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

function createWindow() {
  const iconPath = getAppIconPath()

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  }

  // macOS: 使用 hiddenInset 标题栏（交通灯按钮嵌入式）
  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset'
  }

  // Windows/Linux: 隐藏原生标题栏，使用 titleBarOverlay 保留窗口控制按钮
  if (isWindows) {
    windowOptions.titleBarStyle = 'hidden'
    windowOptions.titleBarOverlay = {
      color: '#1a1a2e',
      symbolColor: '#e5e7eb',
      height: 56  // 与 header h-14 (56px) 一致
    }
  }

  mainWindow = new BrowserWindow(windowOptions)

  // macOS 菜单栏在顶部系统栏，不影响窗口内容，保留以符合平台惯例
  // Windows/Linux: titleBarOverlay 已替代菜单栏，无需额外处理

  // 监听页面加载失败，避免白屏
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error(`Page failed to load: ${errorDescription} (code: ${errorCode}), URL: ${validatedURL}`)
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL).catch(err => {
      log.error('Failed to load dev server URL:', err)
    })
    mainWindow.webContents.openDevTools()
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    log.info('Loading production index.html from:', indexPath)
    mainWindow.loadFile(indexPath).catch(err => {
      log.error('Failed to load index.html:', err)
    })
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    terminalManager.destroy()
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // 确保运行时配置文件存在，并将 default-config.json 的 serverApiBaseUrl 同步到 config.json
  ensureConfigExists()

  // 修复无效的 OpenClaw Gateway allowedOrigins 配置
  // 由于客户端与 Gateway 都是本地连接，设为 ["*"] 是安全的
  fixInvalidControlUiOrigins()

  // 初始化 clientSecret（safeStorage 需要 app ready 后才可用）
  initClientSecret()

  // 初始化 BYOK 管理模块
  initBYOKManager()

  // 启动时迁移：扫描 models.json，将残留的真实 API Key 保存到 platform-key.enc 并替换为占位符
  migrateModelsJsonKeys()

  // 启动本地代理服务器
  startProxyServer()

  createWindow()
})

app.on('window-all-closed', () => {
  stopProxyServer()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // macOS 重新激活时，确保代理服务启动
    startProxyServer()
    createWindow()
  }
})

// IPC handler: 动态更新 Windows titleBarOverlay 颜色（跟随主题切换）
ipcMain.handle('window:set-titlebar-overlay', (_, options: { color: string; symbolColor: string }) => {
  if (isWindows && mainWindow) {
    mainWindow.setTitleBarOverlay({
      color: options.color,
      symbolColor: options.symbolColor,
    })
  }
})

// IPC handlers for Docker management
ipcMain.handle('docker:check-status', async () => {
  return await dockerManager.checkStatus()
})

ipcMain.handle('docker:install-colima', async () => {
  try {
    return await dockerManager.installDocker((progress) => {
      mainWindow?.webContents.send('docker:install-progress', progress)
    })
  } catch (error) {
    // 将具体错误信息传回渲染进程
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message)
  }
})

ipcMain.handle('docker:start-colima', async () => {
  return await dockerManager.startDocker()
})

ipcMain.handle('docker:pull-image', async () => {
  return await dockerManager.pullImage((progress) => {
    mainWindow?.webContents.send('docker:pull-progress', progress)
  })
})

ipcMain.handle('docker:start-container', async () => {
  return await dockerManager.startContainer()
})

ipcMain.handle('docker:stop-container', async () => {
  return await dockerManager.stopContainer()
})

ipcMain.handle('docker:restart-container', async () => {
  return await dockerManager.restartContainer()
})

ipcMain.handle('docker:health-check', async () => {
  return await dockerManager.healthCheck()
})

ipcMain.handle('docker:auto-approve-devices', async () => {
  return await dockerManager.autoApproveDevices()
})

ipcMain.handle('docker:approve-pairing', async (_, provider: string, code: string) => {
  return await dockerManager.approvePairing(provider, code)
})

ipcMain.handle('docker:get-service-url', () => {
  return dockerManager.getServiceUrl()
})

ipcMain.handle('docker:install-go-toolchain', async () => {
  return await dockerManager.installGoToolchain((progress) => {
    mainWindow?.webContents.send('docker:go-install-progress', progress)
  })
})

ipcMain.handle('docker:get-container-resources', async () => {
  return await dockerManager.getContainerResources()
})

ipcMain.handle('docker:update-container-resources', async (_, resources) => {
  return await dockerManager.updateContainerResources(resources)
})

ipcMain.handle('docker:export-logs', async () => {
  return await dockerManager.exportContainerLogs()
})

// ===== Windows WSL2 相关 IPC handlers =====
if (isWindows) {
  const wsl2Provider = new WSL2DockerProvider()

  ipcMain.handle('docker:check-wsl2', async () => {
    const installed = await wsl2Provider.isWSL2Enabled()
    return { installed }
  })

  ipcMain.handle('docker:install-wsl2', async () => {
    return await wsl2Provider.installWSL2()
  })

  ipcMain.handle('docker:check-wsl2-distro', async () => {
    const hasDistro = await wsl2Provider.hasDistro()
    return { hasDistro }
  })

  ipcMain.handle('docker:install-wsl2-distro', async () => {
    return await wsl2Provider.installDistro()
  })
}

// IPC handlers for Container Terminal
ipcMain.handle('terminal:spawn', async (_, { rows, cols }) => {
  terminalManager.onData((data) => {
    mainWindow?.webContents.send('terminal:data', data)
  })
  terminalManager.onExit((code) => {
    mainWindow?.webContents.send('terminal:exit', { code })
  })
  await terminalManager.spawn(cols, rows)
})

ipcMain.on('terminal:write', (_, data: string) => {
  terminalManager.write(data)
})

ipcMain.on('terminal:resize', (_, { rows, cols }: { rows: number; cols: number }) => {
  terminalManager.resize(cols, rows)
})

ipcMain.on('terminal:destroy', () => {
  terminalManager.destroy()
})

// IPC handlers for ArmorClaw Config
ipcMain.handle('config:load', () => {
  ensureConfigExists()
  return loadConfig()
})

ipcMain.handle('config:save', (_, config: ArmorClawConfig) => {
  saveConfig(config)
  return true
})

ipcMain.handle('config:get-path', () => {
  return getConfigPath()
})

ipcMain.handle('config:get-proxy-base-url', () => {
  const hostAddr = detectDockerHostAddress()
  return `http://${hostAddr}:19090/api/v1/proxy`
})

ipcMain.handle('config:get-server-base-url', () => {
  return getServerApiBaseUrl()
})

// IPC handlers for Client Secret Management
ipcMain.handle('client-secret:upload', async (_, { serverBaseUrl, jwtToken }: { serverBaseUrl: string; jwtToken: string }) => {
  return await uploadClientSecret(serverBaseUrl, jwtToken)
})

ipcMain.handle('client-secret:get-hash', () => {
  return getSecretHash()
})

// IPC handler for Skill Install Proxy
ipcMain.handle('skill-install:execute', async (_, params) => {
  return await skillInstallManager.install(params)
})

// IPC handlers for BYOK Management
ipcMain.handle('byok:save', (_, params) => {
  byokSave(params)
})

ipcMain.handle('byok:delete', (_, params) => {
  byokDelete(params)
})

ipcMain.handle('byok:list', () => {
  return byokList()
})

ipcMain.handle('byok:test', async (_, params) => {
  return await byokTest(params)
})

ipcMain.handle('byok:update-model', (_, params) => {
  byokUpdateModel(params)
})

ipcMain.handle('byok:save-platform-key', (_, params: { apiKey: string }) => {
  log.info('[main] Received save-platform-key IPC, key length:', params.apiKey?.length || 0)
  savePlatformKey(params.apiKey)
  log.info('[main] save-platform-key IPC completed')
})

ipcMain.handle('byok:clear-platform-key', () => {
  clearPlatformKey()
})

// IPC handler for cleaning up models.json provider
ipcMain.handle('models-json:cleanup-provider', async (_, params: { providerId: string }) => {
  return deleteProviderFromModelsJson(params.providerId)
})

ipcMain.handle('models-json:cleanup-by-apikey', async (_, params: { apiKey: string }) => {
  return deleteProvidersByApiKeyFromModelsJson(params.apiKey)
})

// IPC handlers for File Manager
ipcMain.handle('files:list-directory', async (_, relativePath: string) => {
  return await fileManager.listDirectory(relativePath)
})

ipcMain.handle('files:save-as', async (_, relativePath: string) => {
  if (!mainWindow) throw new Error('窗口未就绪')
  return await fileManager.saveFileAs(relativePath, mainWindow)
})

ipcMain.handle('files:open-in-system', async (_, relativePath: string) => {
  return await fileManager.openInSystem(relativePath)
})

ipcMain.handle('files:get-root-dir', () => {
  return fileManager.getRootDir()
})

// IPC handler: 在系统默认浏览器中打开外部链接
ipcMain.handle('shell:open-external', async (_, url: string) => {
  const { shell } = require('electron')
  await shell.openExternal(url)
})

// IPC handlers for Custom Skill Management
ipcMain.handle('custom-skill:import', async (_, mode: 'file' | 'folder') => {
  if (!mainWindow) return { ok: false, message: '窗口未就绪' }
  return await customSkillManager.importSkill(mainWindow, mode)
})

ipcMain.handle('custom-skill:list', async () => {
  return await customSkillManager.listSkills()
})

ipcMain.handle('custom-skill:remove', async (_, skillName: string) => {
  return await customSkillManager.removeSkill(skillName)
})

ipcMain.handle('custom-skill:read', async (_, skillName: string) => {
  return await customSkillManager.readSkillContent(skillName)
})

} // end of gotTheLock else block
