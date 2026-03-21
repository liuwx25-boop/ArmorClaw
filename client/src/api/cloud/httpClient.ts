import axios from 'axios'
import type { ApiResponse } from '@/types'
import { getServerBaseUrlSync } from '@/utils/server-url'

const httpClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// 每次请求前动态设置 baseURL（确保使用配置文件中的最新地址）
httpClient.interceptors.request.use((config) => {
  config.baseURL = getServerBaseUrlSync()
  const raw = localStorage.getItem('auth-storage')
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      const token: string | undefined = parsed?.state?.token
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
    } catch {
      // ignore
    }
  }
  return config
})

// ---------- response interceptor ----------
let isRefreshing = false
let pendingQueue: Array<{
  resolve: (token: string) => void
  reject: (err: unknown) => void
}> = []

function processQueue(error: unknown, token: string | null) {
  pendingQueue.forEach((p) => {
    if (error) p.reject(error)
    else p.resolve(token!)
  })
  pendingQueue = []
}

httpClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }

    // read refresh_token from persisted store
    const raw = localStorage.getItem('auth-storage')
    let refreshToken: string | undefined
    if (raw) {
      try {
        refreshToken = JSON.parse(raw)?.state?.refreshToken
      } catch {
        // ignore
      }
    }
    if (!refreshToken) return Promise.reject(error)

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        pendingQueue.push({ resolve, reject })
      }).then((newToken) => {
        original.headers.Authorization = `Bearer ${newToken}`
        original._retry = true
        return httpClient(original)
      })
    }

    isRefreshing = true
    original._retry = true

    try {
      const { data } = await axios.post<ApiResponse<{ token: string; refresh_token: string; expires_in: number }>>(
        `${getServerBaseUrlSync()}/api/v1/auth/refresh`,
        { refresh_token: refreshToken },
      )
      const newToken = data.data.token
      const newRefresh = data.data.refresh_token

      // update persisted store
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          parsed.state.token = newToken
          parsed.state.refreshToken = newRefresh
          localStorage.setItem('auth-storage', JSON.stringify(parsed))
        } catch {
          // ignore
        }
      }

      original.headers.Authorization = `Bearer ${newToken}`
      processQueue(null, newToken)
      return httpClient(original)
    } catch (refreshError) {
      processQueue(refreshError, null)
      // clear auth on refresh failure
      localStorage.removeItem('auth-storage')
      window.location.hash = '#/login'
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)

export default httpClient
