import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'
import { formatDate } from '@/i18n/formatters'

export default function Profile() {
  const { t } = useTranslation('profile')
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  if (!user) return null

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">{t('title')}</h1>

      <div className="bg-white dark:bg-[#232340] rounded-xl shadow-sm p-6">
        {/* 头像 + 用户名 */}
        <div className="flex items-center mb-6 pb-6 border-b border-gray-100 dark:border-gray-700/50">
          <div className="w-14 h-14 rounded-full bg-[#89b4fa] text-white flex items-center justify-center text-2xl font-bold">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="ml-4">
            <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">{user.username}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
          </div>
        </div>

        {/* 详细信息 */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('fields.userId')}</span>
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{user.id}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('fields.pointsBalance')}</span>
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{user.points_balance}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('fields.registeredAt')}</span>
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
              {formatDate(user.created_at)}
            </span>
          </div>
        </div>

        {/* 退出按钮 */}
        <button
          onClick={handleLogout}
          className="mt-8 w-full py-2.5 rounded-lg bg-[#f38ba8]/10 text-[#f38ba8] font-medium text-sm hover:bg-[#f38ba8]/20 transition-colors"
        >
          {t('logout')}
        </button>
      </div>
    </div>
  )
}
