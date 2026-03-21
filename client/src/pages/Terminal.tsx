import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useDockerStore } from '@/stores/dockerStore'
import { useThemeStore } from '@/stores/themeStore'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const lightTheme = {
  background: '#ffffff',
  foreground: '#1e1e2e',
  cursor: '#1e1e2e',
  selectionBackground: '#b4befe',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#cdd6f4',
}

const darkTheme = {
  background: '#1a1a2e',
  foreground: '#cdd6f4',
  cursor: '#cdd6f4',
  selectionBackground: '#45475a',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  cyan: '#94e2d5',
  white: '#cdd6f4',
}

export default function Terminal() {
  const { t } = useTranslation('terminal')
  const { containerRunning } = useDockerStore()
  const theme = useThemeStore((s) => s.theme)
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<(() => void)[]>([])
  const [exited, setExited] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)

  const isElectron = !!window.electronAPI

  // 主题变化时更新终端配色
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = theme === 'dark' ? darkTheme : lightTheme
    }
  }, [theme])

  const startTerminal = useCallback(async () => {
    if (!termRef.current || !isElectron) return

    setExited(false)
    setExitCode(null)

    // Clean up previous session
    cleanupRef.current.forEach(fn => fn())
    cleanupRef.current = []
    xtermRef.current?.dispose()

    const currentTheme = useThemeStore.getState().theme
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: currentTheme === 'dark' ? darkTheme : lightTheme,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)
    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // User input -> main process
    const inputDisposable = term.onData((data) => {
      window.electronAPI.terminal.write(data)
    })
    cleanupRef.current.push(() => inputDisposable.dispose())

    // Main process stdout -> terminal display
    const removeDataListener = window.electronAPI.terminal.onData((data) => {
      term.write(data)
    })
    cleanupRef.current.push(removeDataListener)

    // Shell exit notification
    const removeExitListener = window.electronAPI.terminal.onExit((code) => {
      setExited(true)
      setExitCode(code)
    })
    cleanupRef.current.push(removeExitListener)

    // Window resize -> fit terminal
    const handleResize = () => {
      fitAddon.fit()
      window.electronAPI.terminal.resize(term.rows, term.cols)
    }
    window.addEventListener('resize', handleResize)
    cleanupRef.current.push(() => window.removeEventListener('resize', handleResize))

    // Spawn shell session
    await window.electronAPI.terminal.spawn(term.rows, term.cols)
  }, [isElectron])

  useEffect(() => {
    if (containerRunning && isElectron) {
      startTerminal()
    }

    return () => {
      cleanupRef.current.forEach(fn => fn())
      cleanupRef.current = []
      xtermRef.current?.dispose()
      xtermRef.current = null
      if (isElectron) {
        window.electronAPI.terminal.destroy()
      }
    }
  }, [containerRunning, isElectron, startTerminal])

  if (!isElectron) {
    return (
      <div className="-m-6 h-[calc(100vh-2rem)] flex items-center justify-center bg-white text-gray-600">
        <p className="text-sm">{t('notAvailable')}</p>
      </div>
    )
  }

  if (!containerRunning) {
    return (
      <div className="-m-6 h-[calc(100vh-2rem)] flex items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-red-500 text-sm mb-2">{t('containerNotRunning')}</p>
          <p className="text-xs text-gray-500">{t('startContainerHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="-m-6 h-[calc(100vh-2rem)] flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
        <span className="text-sm text-gray-700 font-medium">{t('title')}</span>
        <span className="text-xs text-gray-400">{t('header')}</span>
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative">
        <div ref={termRef} className="absolute inset-0 p-1" />

        {/* Exit overlay */}
        {exited && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80">
            <div className="text-center">
              <p className="text-sm text-gray-500 mb-3">
                {t('exited', { code: exitCode })}
              </p>
              <button
                onClick={startTerminal}
                className="px-4 py-1.5 text-xs rounded bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors"
              >
                {t('reconnect')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
