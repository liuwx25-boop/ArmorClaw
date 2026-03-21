import { LOGO_AUTH } from '@/config/logo'
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { AxiosError } from 'axios'
import type { ApiResponse } from '@/types'

export default function Register() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const register = useAuthStore((s) => s.register)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError(t('errors.passwordMismatch'))
      return
    }
    setLoading(true)
    try {
      await register({ username, email, password, confirm_password: confirmPassword })
      navigate('/app', { replace: true })
    } catch (err) {
      if (err instanceof AxiosError && err.response?.data) {
        setError((err.response.data as ApiResponse).msg)
      } else {
        setError(t('errors.registerFailed'))
      }
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
          <p className="mt-1 text-sm text-[#a6adc8]">{t('register.title')}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#313244] rounded-xl p-6 shadow-lg">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] text-sm">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('register.usernameLabel')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm placeholder-[#6c7086]"
              placeholder={t('register.usernamePlaceholder')}
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('register.emailLabel')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm placeholder-[#6c7086]"
              placeholder={t('register.emailPlaceholder')}
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('register.passwordLabel')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm placeholder-[#6c7086]"
              placeholder={t('register.passwordPlaceholder')}
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('register.confirmPasswordLabel')}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm placeholder-[#6c7086]"
              placeholder={t('register.confirmPasswordPlaceholder')}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#89b4fa] text-[#1e1e2e] font-semibold text-sm hover:bg-[#74c7ec] transition-colors disabled:opacity-50"
          >
            {loading ? t('register.submittingBtn') : t('register.submitBtn')}
          </button>

          <div className="mt-4 text-center text-xs">
            <span className="text-[#a6adc8]">{t('register.loginLink')}</span>
            <Link to="/login" className="ml-1 text-[#89b4fa] hover:text-[#74c7ec]">
              {t('register.goLogin')}
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
