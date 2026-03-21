import { useTranslation } from 'react-i18next'

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation('layout')

  const toggleLanguage = () => {
    const currentLang = i18n.language
    // i18n.language 可能是 'zh' 或 'zh-CN'，需要处理
    const isZh = currentLang.startsWith('zh')
    const newLang = isZh ? 'en-US' : 'zh-CN'
    i18n.changeLanguage(newLang)
    console.log('Language switched to:', newLang)
  }

  // 处理语言显示
  const currentLang = i18n.language
  const isZh = currentLang.startsWith('zh')

  return (
    <button
      onClick={toggleLanguage}
      className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors no-drag"
      title={isZh ? t('language.switchToEn') : t('language.switchToZh')}
    >
      {isZh ? 'EN' : '中文'}
    </button>
  )
}
