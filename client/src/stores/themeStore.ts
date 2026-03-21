import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      toggleTheme: () =>
        set((state) => {
          const next = state.theme === 'light' ? 'dark' : 'light'
          applyTheme(next)
          return { theme: next }
        }),
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
    }),
    {
      name: 'armorclaw-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }

  // Windows: 同步更新 titleBarOverlay 颜色
  if (window.electronAPI?.window?.setTitleBarOverlay) {
    const overlay = theme === 'dark'
      ? { color: '#1a1a2e', symbolColor: '#e5e7eb' }
      : { color: '#ffffff', symbolColor: '#1f2937' }
    window.electronAPI.window.setTitleBarOverlay(overlay).catch(() => {})
  }
}
