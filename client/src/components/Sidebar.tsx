import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDockerStore } from '@/stores/dockerStore'
import { useAuthStore } from '@/stores/authStore'

interface NavChild {
  id: string
  labelKey: string
  path: string
}

interface NavGroup {
  id: string
  labelKey: string
  path?: string
  children?: NavChild[]
}

// 使用稳定的 id 而非翻译后的文本
const navGroupConfigs: NavGroup[] = [
  {
    id: 'ai',
    labelKey: 'groups.ai.label',
    children: [
      { id: 'platform-keys', labelKey: 'groups.ai.platformKeys', path: '/app/ai/platform-keys' },
      { id: 'byok', labelKey: 'groups.ai.byok', path: '/app/ai/byok' },
    ],
  },
  {
    id: 'im',
    labelKey: 'groups.im.label',
    path: '/app/im',
  },
  {
    id: 'sessions',
    labelKey: 'groups.sessions.label',
    path: '/app/sessions',
  },
  {
    id: 'skills',
    labelKey: 'groups.skills.label',
    path: '/app/skills',
  },
  {
    id: 'container',
    labelKey: 'groups.container.label',
    path: '/app/container-resources',
  },
  {
    id: 'files',
    labelKey: 'groups.files.label',
    path: '/app/files',
  },
  {
    id: 'terminal',
    labelKey: 'groups.terminal.label',
    path: '/app/terminal',
  },
]

export default function Sidebar() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const location = useLocation()
  const { containerRunning, stopContainer, startContainer } = useDockerStore()
  const { user, logout } = useAuthStore()

  // 使用稳定的 id 作为 key
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'ai': true,
  })

  // 动态生成带翻译的 navGroups
  const navGroups = useMemo(() => {
    return navGroupConfigs.map(group => ({
      ...group,
      label: t(group.labelKey),
      children: group.children?.map(child => ({
        ...child,
        label: t(child.labelKey),
      })),
    }))
  }, [t])

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const isActive = (path: string) => location.pathname === path

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="w-56 flex-shrink-0 bg-[#f8fafc] dark:bg-[#16162a] border-r border-gray-200 dark:border-gray-700/50 flex flex-col h-full select-none">
      {/* 导航菜单 */}
      <nav className="flex-1 overflow-y-auto py-3">
        {navGroups.map(group => (
          <div key={group.id} className="mb-1">
            {/* 一级分类标题 */}
            <button
              className={`w-full flex items-center px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-gray-700/40 transition-colors ${
                group.path && isActive(group.path) ? 'bg-sky-50 dark:bg-sky-900/30 border-l-2 border-sky-500' : ''
              }`}
              onClick={() => {
                if (group.path) {
                  navigate(group.path)
                } else if (group.children) {
                  toggleGroup(group.id)
                }
              }}
            >
              <span className="text-slate-400 dark:text-slate-500 text-xs mr-2 w-3 inline-flex justify-center">
                {group.children
                  ? expandedGroups[group.id] ? '▼' : '▶'
                  : '•'
                }
              </span>
              <span className="text-slate-700 dark:text-slate-200 font-medium">{group.label}</span>
            </button>

            {/* 二级子菜单 */}
            {group.children && expandedGroups[group.id] && (
              <div className="mt-0.5">
                {group.children.map(child => (
                  <button
                    key={child.path}
                    className={`w-full text-left pl-9 pr-4 py-1.5 text-sm transition-colors ${
                      isActive(child.path)
                        ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 font-medium border-l-2 border-sky-500'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-gray-700/40 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                    onClick={() => navigate(child.path)}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* 产品文档 */}
      <div className="border-t border-gray-200 dark:border-gray-700/50 px-4 py-2 flex-shrink-0">
        <button
          onClick={() => {
            const url = import.meta.env.VITE_DOC_URL
            if (window.electronAPI?.shell?.openExternal) {
              window.electronAPI.shell.openExternal(url)
            } else {
              window.open(url, '_blank')
            }
          }}
          className="w-full flex items-center px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-gray-700/40 hover:text-sky-600 dark:hover:text-sky-400 rounded transition-colors no-drag"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          {t('docs')}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 ml-auto flex-shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      </div>

      {/* 用户信息 */}
      {user && (
        <div className="border-t border-gray-200 dark:border-gray-700/50 px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate('/app/profile')}
              className="flex items-center min-w-0 hover:opacity-80 transition-opacity no-drag"
            >
              <div className="w-7 h-7 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div className="ml-2 min-w-0">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{user.username}</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{user.email}</p>
              </div>
            </button>
            <button
              onClick={handleLogout}
              className="ml-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0 no-drag"
              title={t('logout')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 底部服务状态 */}
      <div className="border-t border-gray-200 dark:border-gray-700/50 px-4 py-3 flex-shrink-0">
        <div className="flex items-center mb-2">
          <span className={`w-2 h-2 rounded-full mr-2 ${containerRunning ? 'bg-green-500' : 'bg-red-400'}`} />
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {containerRunning ? t('serviceStatus.running') : t('serviceStatus.stopped')}
          </span>
        </div>

        {containerRunning ? (
          <div className="flex gap-2">
            <button
              onClick={() => stopContainer()}
              className="flex-1 text-xs py-1.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors no-drag"
            >
              {t('actions.stopService')}
            </button>
          </div>
        ) : (
          <button
            onClick={() => startContainer()}
            className="w-full text-xs py-1.5 rounded bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors no-drag"
          >
            {t('actions.startService')}
          </button>
        )}
      </div>
    </aside>
  )
}
