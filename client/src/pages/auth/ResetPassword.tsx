import { LOGO_AUTH } from '@/config/logo'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { authApi } from '@/api/cloud/auth'
import { AxiosError } from 'axios'
import type { ApiResponse } from '@/types'

type Step = 'email' | 'code' | 'reset'

export default function ResetPassword() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const getErrorMsg = (err: unknown) => {
    if (err instanceof AxiosError) {
      // 服务端返回了业务错误消息
      if (err.response?.data) {
        const msg = (err.response.data as ApiResponse).msg
        if (msg) return msg
      }
      // 网络错误（无法连接服务器）
      if (err.code === 'ERR_NETWORK') {
        return t('errors.networkError')
      }
      // 请求超时
      if (err.code === 'ECONNABORTED') {
        return t('errors.timeout')
      }
      // 其他 HTTP 错误码
      if (err.response?.status) {
        return `${t('errors.serverUnreachable')} (${err.response.status})`
      }
    }
    return t('errors.resetFailed')
  }

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.sendResetCode(email)
      setStep('code')
    } catch (err) {
      setError(getErrorMsg(err))
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.verifyResetCode(email, code)
      setResetToken(res.data.data.reset_token)
      setStep('reset')
    } catch (err) {
      setError(getErrorMsg(err))
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError(t('errors.passwordMismatch'))
      return
    }
    setLoading(true)
    try {
      await authApi.resetPassword({ reset_token: resetToken, new_password: newPassword, confirm_password: confirmPassword })
      navigate('/login', { replace: true })
    } catch (err) {
      setError(getErrorMsg(err))
    } finally {
      setLoading(false)
    }
  }

  const stepTitle = {
    email: t('resetPassword.stepEmail'),
    code: t('resetPassword.stepCode'),
    reset: t('resetPassword.stepReset')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e1e2e]">
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <img src={LOGO_AUTH} alt="ArmorClaw" className="w-16 h-16 mx-auto" />
          <h1 className="mt-3 text-2xl font-bold text-[#cdd6f4]">{t('resetPassword.title')}</h1>
          <p className="mt-1 text-sm text-[#a6adc8]">{stepTitle[step]}</p>
        </div>

        {/* progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {(['email', 'code', 'reset'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                step === s ? 'bg-[#89b4fa] text-[#1e1e2e]' :
                (['email', 'code', 'reset'].indexOf(step) > i) ? 'bg-[#a6e3a1] text-[#1e1e2e]' :
                'bg-[#45475a] text-[#6c7086]'
              }`}>
                {i + 1}
              </div>
              {i < 2 && <div className="w-8 h-0.5 bg-[#45475a]" />}
            </div>
          ))}
        </div>

        <div className="bg-[#313244] rounded-xl p-6 shadow-lg">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] text-sm">
              {error}
            </div>
          )}

          {step === 'email' && (
            <form onSubmit={handleSendCode}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('resetPassword.emailLabel')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm placeholder-[#6c7086]"
                  placeholder={t('resetPassword.emailPlaceholder')}
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-2.5 rounded-lg bg-[#89b4fa] text-[#1e1e2e] font-semibold text-sm hover:bg-[#74c7ec] transition-colors disabled:opacity-50">
                {loading ? t('resetPassword.sendingBtn') : t('resetPassword.sendCodeBtn')}
              </button>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={handleVerifyCode}>
              <p className="text-xs text-[#a6adc8] mb-4">{t('resetPassword.codeSentTo', { email })}</p>
              <div className="mb-6">
                <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('resetPassword.codeLabel')}</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  maxLength={6}
                  className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm tracking-[0.3em] text-center placeholder-[#6c7086]"
                  placeholder={t('resetPassword.codePlaceholder')}
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-2.5 rounded-lg bg-[#89b4fa] text-[#1e1e2e] font-semibold text-sm hover:bg-[#74c7ec] transition-colors disabled:opacity-50">
                {loading ? t('resetPassword.verifyingBtn') : t('resetPassword.verifyBtn')}
              </button>
            </form>
          )}

          {step === 'reset' && (
            <form onSubmit={handleResetPassword}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('resetPassword.newPasswordLabel')}</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm placeholder-[#6c7086]"
                  placeholder={t('resetPassword.newPasswordPlaceholder')}
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-[#a6adc8] mb-1.5">{t('resetPassword.confirmNewPasswordLabel')}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#45475a] text-[#cdd6f4] border border-[#585b70] focus:border-[#89b4fa] focus:outline-none text-sm placeholder-[#6c7086]"
                  placeholder={t('resetPassword.confirmNewPasswordPlaceholder')}
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-2.5 rounded-lg bg-[#89b4fa] text-[#1e1e2e] font-semibold text-sm hover:bg-[#74c7ec] transition-colors disabled:opacity-50">
                {loading ? t('resetPassword.resettingBtn') : t('resetPassword.resetBtn')}
              </button>
            </form>
          )}

          <div className="mt-4 text-center text-xs">
            <Link to="/login" className="text-[#89b4fa] hover:text-[#74c7ec]">
              {t('resetPassword.backToLogin')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
