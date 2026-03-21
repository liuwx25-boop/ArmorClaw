import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi } from '@/api/cloud/auth'
import type { User, LoginRequest, RegisterRequest } from '@/types'

import { getServerBaseUrlSync } from '@/utils/server-url'

/**
 * 登录/注册成功后，异步上报 clientSecret 到服务端
 * 每次登录/注册都上报，确保服务端始终拥有最新的 secret hash
 */
async function uploadClientSecret(jwtToken: string): Promise<void> {
  try {
    const api = (window as any).electronAPI
    if (!api?.clientSecret) return

    const serverBaseUrl = getServerBaseUrlSync()
    await api.clientSecret.upload(serverBaseUrl, jwtToken)
  } catch (err) {
    console.error('[authStore] Failed to upload client secret:', err)
  }
}

interface AuthState {
  token: string | null
  refreshToken: string | null
  expiresIn: number | null
  user: User | null
  isAuthenticated: boolean

  login: (data: LoginRequest) => Promise<void>
  register: (data: RegisterRequest) => Promise<void>
  logout: () => void
  fetchProfile: () => Promise<void>
  setAuth: (token: string, refreshToken: string, expiresIn: number, user: User) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      expiresIn: null,
      user: null,
      isAuthenticated: false,

      setAuth: (token, refreshToken, expiresIn, user) => {
        set({ token, refreshToken, expiresIn, user, isAuthenticated: true })
      },

      login: async (data) => {
        const res = await authApi.login(data)
        const { token, refresh_token, expires_in, user } = res.data.data
        set({ token, refreshToken: refresh_token, expiresIn: expires_in, user, isAuthenticated: true })
        // 登录成功后上报 clientSecret
        uploadClientSecret(token)
      },

      register: async (data) => {
        const res = await authApi.register(data)
        const { token, refresh_token, expires_in, user } = res.data.data
        set({ token, refreshToken: refresh_token, expiresIn: expires_in, user, isAuthenticated: true })
        // 注册成功后上报 clientSecret
        uploadClientSecret(token)
      },

      logout: () => {
        set({ token: null, refreshToken: null, expiresIn: null, user: null, isAuthenticated: false })
      },

      fetchProfile: async () => {
        try {
          const res = await authApi.getProfile()
          set({ user: res.data.data })
        } catch {
          if (!get().token) {
            set({ isAuthenticated: false })
          }
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        expiresIn: state.expiresIn,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
