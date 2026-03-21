import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import PackagesPricing from './PackagesPricing'
import Billing from './Billing'
import ConfigApiKeys from './ConfigApiKeys'

// ==================== Tab 组件 ====================

type TabKey = 'packages' | 'billing' | 'config'

// ==================== 主组件 ====================

export default function PlatformKeys() {
  const { t } = useTranslation('ai')
  const [activeTab, setActiveTab] = useState<TabKey>('packages')

  const tabs: { key: TabKey; labelKey: string }[] = [
    { key: 'packages', labelKey: 'platformKeys.tabs.packages' },
    { key: 'billing', labelKey: 'platformKeys.tabs.billing' },
    { key: 'config', labelKey: 'platformKeys.tabs.apiKeys' },
  ]

  const tabLabels = useMemo(() => tabs.map(tab => ({
    ...tab,
    label: t(tab.labelKey),
  })), [t])

  return (
    <div>
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-1">{t('platformKeys.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('platformKeys.subtitle')}</p>
      </div>

      {/* Tab 导航 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
        {tabLabels.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ==================== Tab 1: Token套餐价格 ==================== */}
      {activeTab === 'packages' && <PackagesPricing />}

      {/* ==================== Tab 2: Token消费 ==================== */}
      {activeTab === 'billing' && <Billing />}

      {/* ==================== Tab 3: 配置 API Key ==================== */}
      {activeTab === 'config' && <ConfigApiKeys />}
    </div>
  )
}
