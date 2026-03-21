import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useDockerStore } from '@/stores/dockerStore'
import { useAuthStore } from '@/stores/authStore'
import { useEffect } from 'react'
import { disconnectGateway } from '@/api/container/gateway'
import { preloadServerBaseUrl, getServerBaseUrlSync } from '@/utils/server-url'
import Installer from '@/pages/Installer'
import MainLayout from '@/layouts/MainLayout'
import AuthGuard from '@/components/AuthGuard'
import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import ResetPassword from '@/pages/auth/ResetPassword'
import PlatformKeys from '@/pages/ai/PlatformKeys'
import IMChannels from '@/pages/im/IMChannels'
import Sessions from '@/pages/sessions/Sessions'
import Skills from '@/pages/skills/Skills'
import Terminal from '@/pages/Terminal'
import Profile from '@/pages/Profile'
import ContainerResources from '@/pages/ContainerResources'
import FileDirectory from '@/pages/files/FileDirectory'
import BYOKConfig from '@/pages/ai/BYOKConfig'

function App() {
  const { checkStatus, needsSetup, isChecking } = useDockerStore()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  // 检测是否在 Electron 环境中运行
  const isElectron = !!window.electronAPI

  useEffect(() => {
    // 预加载服务端地址（Electron 环境从配置文件读取）
    preloadServerBaseUrl()

    if (isElectron) {
      checkStatus()
    }
    // 应用退出时关闭 Gateway WebSocket 连接
    const handleBeforeUnload = () => disconnectGateway()
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      disconnectGateway()
    }
  }, [checkStatus, isElectron])

  // 启动时上报 client secret，确保服务端始终拥有最新的 secret hash
  const token = useAuthStore((s) => s.token)
  useEffect(() => {
    if (isElectron && isAuthenticated && token) {
      const api = (window as any).electronAPI
      if (api?.clientSecret) {
        const serverBaseUrl = getServerBaseUrlSync()
        api.clientSecret.upload(serverBaseUrl, token).then(() => {
          console.log('[App] Client secret uploaded on startup')
        }).catch((err: any) => {
          console.error('[App] Failed to upload client secret on startup:', err)
        })
      }
    }
  }, [isElectron, isAuthenticated, token])

  if (isElectron && isChecking) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a2e]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">检查环境...</p>
        </div>
      </div>
    )
  }

  // Docker 环境检测优先于登录检查，确保新设备首次使用时先完成 Docker 安装
  const defaultRedirect = (isElectron && needsSetup) ? '/installer'
    : !isAuthenticated ? '/login'
    : '/app'

  return (
    <HashRouter>
      <Routes>
        {/* auth pages (public) — 登录后如果 Docker 未就绪，跳转到 installer 而非 /app */}
        <Route path="/login" element={isAuthenticated ? <Navigate to={(isElectron && needsSetup) ? '/installer' : '/app'} replace /> : <Login />} />
        <Route path="/register" element={isAuthenticated ? <Navigate to={(isElectron && needsSetup) ? '/installer' : '/app'} replace /> : <Register />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="/installer" element={<Installer />} />

        {/* protected app routes — 需要同时满足已登录 + Docker 就绪 */}
        <Route path="/app" element={
          (isElectron && needsSetup) ? <Navigate to="/installer" replace /> : <AuthGuard><MainLayout /></AuthGuard>
        }>
          <Route index element={<Navigate to="/app/ai/platform-keys" replace />} />
          <Route path="ai/platform-keys" element={<PlatformKeys />} />
          {/* 旧路径兼容重定向 */}
          <Route path="ai/tokens" element={<Navigate to="/app/ai/platform-keys" replace />} />
          <Route path="ai/api-keys" element={<Navigate to="/app/ai/platform-keys" replace />} />
          <Route path="ai/packages" element={<Navigate to="/app/ai/platform-keys" replace />} />
          <Route path="ai/billing" element={<Navigate to="/app/ai/platform-keys" replace />} />
          <Route path="ai/config" element={<Navigate to="/app/ai/platform-keys" replace />} />
          <Route path="ai/byok" element={<BYOKConfig />} />
          <Route path="im" element={<IMChannels />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="skills" element={<Skills />} />
          <Route path="container-resources" element={<ContainerResources />} />
          <Route path="files" element={<FileDirectory />} />
          <Route path="terminal" element={<Terminal />} />
          <Route path="profile" element={<Profile />} />
        </Route>

        <Route path="*" element={<Navigate to={defaultRedirect} replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App

