import { useTranslation } from 'react-i18next'
import { useThemeStore } from '@/stores/themeStore'
import { getLogoByTheme } from '@/config/logo'
import { useState, useEffect } from 'react'
import { useDockerStore } from '@/stores/dockerStore'
import '@/types'

export default function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { containerRunning, stopContainer, startContainer } = useDockerStore()
  const theme = useThemeStore((s) => s.theme)
  const logo = getLogoByTheme(theme)
  const [serviceUrl, setServiceUrl] = useState('http://127.0.0.1:18789/?token=local')

  useEffect(() => {
    window.electronAPI?.docker.getServiceUrl().then((url: string) => {
      setServiceUrl(url)
    })
  }, [])

  useEffect(() => {
    if (containerRunning) {
      const timer = setTimeout(() => {
        window.electronAPI?.docker.autoApproveDevices()
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [containerRunning])

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-[#1a1a2e]">
      <div className="drag-region h-8 flex-shrink-0 bg-white dark:bg-[#16162a] border-b border-gray-200 dark:border-gray-700/50" />

      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <img src={logo} alt="ArmorClaw" className="w-24 h-24 mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">{t('ready')}</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            {t('containerStatus')} {containerRunning ? t('status.running') : t('status.stopped')}
          </p>

          <div className="space-x-4">
            {containerRunning ? (
              <>
                <button
                  onClick={stopContainer}
                  className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                >
                  {t('actions.stop')}
                </button>
              </>
            ) : (
              <button
                onClick={startContainer}
                className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
              >
                {t('actions.start')}
              </button>
            )}
          </div>

          <p className="text-gray-400 dark:text-gray-500 text-sm mt-8">
            {t('serviceUrl')} {serviceUrl}
          </p>
        </div>
      </div>
    </div>
  )
}
