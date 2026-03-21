import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from './logger'

export interface BrandingConfig {
  appName: string
  appId: string
  icons: {
    mac: string
    win: string
    linux: string
  }
  logo: string
}

const DEFAULT_BRANDING: BrandingConfig = {
  appName: 'ArmorClaw',
  appId: 'com.armorclaw.client',
  icons: {
    mac: 'icons/icon.icns',
    win: 'icons/icon.ico',
    linux: 'icons/icon.png',
  },
  logo: 'icons/logo.jpg',
}

let cachedBranding: BrandingConfig | null = null

/**
 * 获取 resources 目录的绝对路径
 * - 打包后: process.resourcesPath/resources
 * - 开发模式: <项目根>/resources
 */
function getResourcesDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '..', 'resources')
}

/**
 * 加载品牌配置（branding.json）
 * 优先从 resources/branding.json 读取，加载失败则使用默认值
 */
export function loadBranding(): BrandingConfig {
  if (cachedBranding) {
    return cachedBranding
  }

  const brandingPath = path.join(getResourcesDir(), 'branding.json')
  try {
    if (fs.existsSync(brandingPath)) {
      const raw = JSON.parse(fs.readFileSync(brandingPath, 'utf-8'))
      cachedBranding = {
        appName: raw.appName || DEFAULT_BRANDING.appName,
        appId: raw.appId || DEFAULT_BRANDING.appId,
        icons: {
          mac: raw.icons?.mac || DEFAULT_BRANDING.icons.mac,
          win: raw.icons?.win || DEFAULT_BRANDING.icons.win,
          linux: raw.icons?.linux || DEFAULT_BRANDING.icons.linux,
        },
        logo: raw.logo || DEFAULT_BRANDING.logo,
      }
      log.info('Branding loaded from:', brandingPath)
    } else {
      cachedBranding = { ...DEFAULT_BRANDING }
      log.info('branding.json not found, using defaults')
    }
  } catch (e) {
    log.warn('Failed to load branding.json, using defaults:', e)
    cachedBranding = { ...DEFAULT_BRANDING }
  }

  return cachedBranding
}

/**
 * 根据当前平台获取应用图标的绝对路径
 */
export function getAppIconPath(): string {
  const branding = loadBranding()
  const resourcesDir = getResourcesDir()

  let iconRelative: string
  switch (process.platform) {
    case 'darwin':
      iconRelative = branding.icons.mac
      break
    case 'win32':
      iconRelative = branding.icons.win
      break
    default:
      iconRelative = branding.icons.linux
      break
  }

  return path.join(resourcesDir, iconRelative)
}

/**
 * 获取应用名称
 */
export function getAppName(): string {
  return loadBranding().appName
}
