import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { AxiosError } from 'axios'
import type { ApiResponse } from '@/types'
import { LOGO_AUTH } from '@/config/logo'

export default function Login() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 错误消息映射：服务端英文 -> 翻译 key
  const errorKeyMap: Record<string, string> = {
    'user not found': 'errors.userNotFound',
    'wrong password': 'errors.wrongPassword',
    'account locked': 'errors.accountLocked',
    'invalid request body': 'errors.invalidRequest',
    'login failed': 'errors.loginFailed',
  }

  const getErrorMessage = (err: unknown): string => {
    if (err instanceof AxiosError) {
      // 网络错误（无响应）
      if (!err.response) {
        if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
          return t('errors.networkError')
        }
        if (err.code === 'ECONNABORTED') {
          return t('errors.timeout')
        }
        return t('errors.serverUnreachable')
      }
      // 服务端返回错误
      const serverMsg = (err.response.data as ApiResponse)?.msg
      if (serverMsg) {
        const key = errorKeyMap[serverMsg]
        return key ? t(key) : serverMsg
      }
    }
    return t('errors.loginFailed')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login({ email, password })
      navigate('/app', { replace: true })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e1e2e]">
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <img src={LOGO_AUTH} alt="ArmorClaw" className="w-16 h-16 mx-auto" />
          <h1 className="mt-3 text-2xl font-bold text-[#cdd6f4]">ArmorClaw</h1>
          <p className="mt-1 text-sm text-[#a6adc8]">{t('login.title')}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#313244] rounded-xl p-6 shadow-lg">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] text-sm">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('login.emailLabel')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm placeholder-[#6c7086]"
              placeholder={t('login.emailPlaceholder')}
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('login.passwordLabel')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm placeholder-[#6c7086]"
              placeholder={t('login.passwordPlaceholder')}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#89b4fa] text-[#1e1e2e] font-semibold text-sm hover:bg-[#74c7ec] transition-colors disabled:opacity-50"
          >
            {loading ? t('login.submittingBtn') : t('login.submitBtn')}
          </button>

          <div className="mt-4 flex items-center justify-between text-xs">
            <Link to="/register" className="text-[#89b4fa] hover:text-[#74c7ec]">
              {t('login.registerLink')}
            </Link>
            <Link to="/reset-password" className="text-[#a6adc8] hover:text-[#cdd6f4]">
              {t('login.forgotPassword')}
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
