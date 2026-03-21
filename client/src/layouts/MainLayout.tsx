import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Sidebar from '@/components/Sidebar'
import { useThemeStore } from '@/stores/themeStore'
import { getLogoByTheme } from '@/config/logo'
import LanguageSwitcher from '@/components/LanguageSwitcher'

const isWindows = navigator.platform === 'Win32'

export default function MainLayout() {
  const { t } = useTranslation('layout')
  const { theme, toggleTheme } = useThemeStore()
  const logo = getLogoByTheme(theme)

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-[#1a1a2e]">
      {/* 顶部栏：拖拽区 + Logo + 产品名 + 主题切换 */}
      <header className={`dark-header drag-region h-14 flex-shrink-0 bg-white border-b border-gray-200 dark:border-gray-700/50 flex items-center px-5 ${isWindows ? 'pr-36' : ''}`}>
        <img src={logo} alt="ArmorClaw" className="w-8 h-8 no-drag" />
        <span className="ml-2.5 text-base font-semibold text-gray-800 dark:text-gray-100 tracking-wide no-drag">
          ArmorClaw
        </span>

        {/* 右侧：语言切换 + 主题切换按钮 */}
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <button
            onClick={toggleTheme}
            className="no-drag p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
            title={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
          >
            {theme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* 下方：侧边栏 + 内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 侧边栏 - 固定不滚动 */}
        <Sidebar />

        {/* 右侧内容区 - 独立滚动 */}
        <main className="flex-1 bg-slate-100 dark:bg-[#1a1a2e] overflow-y-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
