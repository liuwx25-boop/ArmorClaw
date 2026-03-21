/**
 * Logo 配置文件
 *
 * 请将对应的 logo 图片放到以下路径：
 *   白色主题 logo：client/src/assets/logo-light.png
 *   黑色主题 logo：client/src/assets/logo-dark.png
 *
 * 命名约定：
 *   logo-light  —— 白色/浅色主界面使用的 logo
 *   logo-dark   —— 黑色/深色主界面使用的 logo
 *   logo-auth   —— 登录/注册等认证页面使用的 logo（固定深色背景）
 */

import logoForLight from '@/assets/logo-light.png'
import logoForDark from '@/assets/logo-dark.png'

/** 白色主题下显示的 logo */
export const LOGO_LIGHT = logoForLight

/** 黑色主题下显示的 logo */
export const LOGO_DARK = logoForDark

/**
 * 登录/注册/重置密码页面使用的 logo
 * 这些页面固定为深色背景，所以使用黑色主题的 logo
 */
export const LOGO_AUTH = logoForDark

/**
 * 根据当前主题获取对应 logo
 * @param theme - 'light' | 'dark'
 */
export function getLogoByTheme(theme: 'light' | 'dark'): string {
  return theme === 'light' ? LOGO_LIGHT : LOGO_DARK
}
