import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// 导入所有命名空间 - 中文
import commonZh from './locales/zh-CN/common.json'
import authZh from './locales/zh-CN/auth.json'
import navZh from './locales/zh-CN/nav.json'
import billingZh from './locales/zh-CN/billing.json'
import packagesZh from './locales/zh-CN/packages.json'
import aiZh from './locales/zh-CN/ai.json'
import imZh from './locales/zh-CN/im.json'
import sessionsZh from './locales/zh-CN/sessions.json'
import skillsZh from './locales/zh-CN/skills.json'
import filesZh from './locales/zh-CN/files.json'
import terminalZh from './locales/zh-CN/terminal.json'
import containerZh from './locales/zh-CN/container.json'
import dashboardZh from './locales/zh-CN/dashboard.json'
import profileZh from './locales/zh-CN/profile.json'
import layoutZh from './locales/zh-CN/layout.json'

// 导入所有命名空间 - 英文
import commonEn from './locales/en-US/common.json'
import authEn from './locales/en-US/auth.json'
import navEn from './locales/en-US/nav.json'
import billingEn from './locales/en-US/billing.json'
import packagesEn from './locales/en-US/packages.json'
import aiEn from './locales/en-US/ai.json'
import imEn from './locales/en-US/im.json'
import sessionsEn from './locales/en-US/sessions.json'
import skillsEn from './locales/en-US/skills.json'
import filesEn from './locales/en-US/files.json'
import terminalEn from './locales/en-US/terminal.json'
import containerEn from './locales/en-US/container.json'
import dashboardEn from './locales/en-US/dashboard.json'
import profileEn from './locales/en-US/profile.json'
import layoutEn from './locales/en-US/layout.json'

// 从 localStorage 获取已保存的语言设置
const savedLanguage = localStorage.getItem('armorclaw-language') || 'zh-CN'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': {
        common: commonZh,
        auth: authZh,
        nav: navZh,
        billing: billingZh,
        packages: packagesZh,
        ai: aiZh,
        im: imZh,
        sessions: sessionsZh,
        skills: skillsZh,
        files: filesZh,
        terminal: terminalZh,
        container: containerZh,
        dashboard: dashboardZh,
        profile: profileZh,
        layout: layoutZh,
      },
      'en-US': {
        common: commonEn,
        auth: authEn,
        nav: navEn,
        billing: billingEn,
        packages: packagesEn,
        ai: aiEn,
        im: imEn,
        sessions: sessionsEn,
        skills: skillsEn,
        files: filesEn,
        terminal: terminalEn,
        container: containerEn,
        dashboard: dashboardEn,
        profile: profileEn,
        layout: layoutEn,
      },
    },
    lng: savedLanguage,
    fallbackLng: 'zh-CN',
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
  })

// 监听语言变化，保存到 localStorage
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('armorclaw-language', lng)
})

export default i18n
