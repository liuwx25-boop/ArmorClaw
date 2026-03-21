/**
 * 统一获取服务端 API 地址
 *
 * - Electron 环境：从 ~/.armorclaw/config.json 读取（通过 IPC）
 * - 非 Electron 环境（纯 Web）：使用 .env 中的 VITE_API_BASE_URL
 *
 * 管理员可通过修改 ~/.armorclaw/config.json 的 serverApiBaseUrl 字段调整服务端地址
 */

let cachedUrl: string | null = null

export async function getServerBaseUrl(): Promise<string> {
  if (cachedUrl) return cachedUrl

  const api = (window as any).electronAPI
  if (api?.config?.getServerBaseUrl) {
    try {
      const url = await api.config.getServerBaseUrl()
      if (url) {
        cachedUrl = url
        return url
      }
    } catch {
      // fallback to env
    }
  }

  // 非 Electron 环境或 IPC 失败时，使用 .env 配置
  cachedUrl = import.meta.env.VITE_API_BASE_URL as string
  return cachedUrl
}

/**
 * 同步获取服务端地址（用于无法 async 的场景，如 axios.create）
 * 优先返回已缓存的值，否则使用 .env 的值
 */
export function getServerBaseUrlSync(): string {
  return cachedUrl || (import.meta.env.VITE_API_BASE_URL as string)
}

/**
 * 应用启动时预加载服务端地址（在 App 初始化时调用一次）
 */
export async function preloadServerBaseUrl(): Promise<void> {
  await getServerBaseUrl()
}
