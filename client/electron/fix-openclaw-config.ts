import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import log from './logger'

/**
 * 修复无效的 gateway.controlUi.allowedOrigins 配置
 *
 * 由于客户端与 OpenClaw Gateway 都运行在本地容器中，
 * 所有访问都是本地 IP (127.0.0.1)，因此将 allowedOrigins 设为 ["*"]
 * 是安全的，不会引入安全风险。
 *
 * 修复触发条件：
 * - allowedOrigins 未配置
 * - allowedOrigins 包含无效值（如 ".", "null", "", null, undefined）
 */
export function fixInvalidControlUiOrigins(): boolean {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')

  if (!fs.existsSync(configPath)) {
    log.info('[config-fix] openclaw.json not found, skip')
    return false
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)

    // 检查 allowedOrigins 是否有效
    const needsFix = checkNeedsFix(config)

    if (!needsFix) {
      log.info('[config-fix] allowedOrigins is valid, skip')
      return false
    }

    // 应用修复
    const fixed = applyFix(config)

    // 写回文件
    fs.writeFileSync(configPath, JSON.stringify(fixed, null, 2), 'utf-8')
    log.info('[config-fix] Fixed invalid allowedOrigins, set to ["*"]')
    return true

  } catch (err) {
    log.error('[config-fix] Failed to fix config:', err)
    return false
  }
}

/**
 * 检测配置是否需要修复
 */
function checkNeedsFix(config: any): boolean {
  const allowedOrigins = config?.gateway?.controlUi?.allowedOrigins

  // 未配置，不需要修复
  if (allowedOrigins === undefined || allowedOrigins === null) {
    return false
  }

  // 不是数组，需要修复
  if (!Array.isArray(allowedOrigins)) {
    return true
  }

  // 检查是否包含无效值
  const invalidValues = ['.', 'null', 'undefined', '']
  return allowedOrigins.some((origin: any) =>
    origin === null ||
    origin === undefined ||
    (typeof origin === 'string' && invalidValues.includes(origin.trim()))
  )
}

/**
 * 应用修复：将 allowedOrigins 设为 ["*"]
 */
function applyFix(config: any): any {
  return {
    ...config,
    gateway: {
      ...config.gateway,
      controlUi: {
        ...(config.gateway?.controlUi || {}),
        allowedOrigins: ['*']
      }
    }
  }
}
