import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDate } from '@/i18n/formatters'

interface FileEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: string
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function getFileIcon(name: string, isDirectory: boolean): string {
  if (isDirectory) return '📁'
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, string> = {
    // 代码
    ts: '📄', tsx: '📄', js: '📄', jsx: '📄', py: '📄', go: '📄', rs: '📄', java: '📄', c: '📄', cpp: '📄', h: '📄', swift: '📄', kt: '📄',
    html: '📄', css: '📄', scss: '📄', json: '📄', yaml: '📄', yml: '📄', toml: '📄', xml: '📄', sql: '📄', sh: '📄', bash: '📄',
    // 文档
    md: '📝', txt: '📝', doc: '📝', docx: '📝', pdf: '📝', rtf: '📝',
    // 图片
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', ico: '🖼️', bmp: '🖼️',
    // 视频
    mp4: '🎬', avi: '🎬', mov: '🎬', mkv: '🎬', webm: '🎬',
    // 音频
    mp3: '🎵', wav: '🎵', flac: '🎵', ogg: '🎵',
    // 压缩包
    zip: '📦', tar: '📦', gz: '📦', rar: '📦', '7z': '📦',
    // 日志
    log: '📋',
  }
  return iconMap[ext] || '📄'
}

export default function FileDirectory() {
  const { t } = useTranslation('files')
  const [currentPath, setCurrentPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rootDir, setRootDir] = useState('')
  const [savingFile, setSavingFile] = useState<string | null>(null)

  const loadDirectory = useCallback(async (relativePath: string) => {
    setLoading(true)
    setError(null)
    try {
      const entries = await window.electronAPI.files.listDirectory(relativePath)
      setFiles(entries)
      setCurrentPath(relativePath)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loading'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    window.electronAPI.files.getRootDir().then(dir => setRootDir(dir))
    loadDirectory('')
  }, [loadDirectory])

  const navigateTo = (relativePath: string) => {
    loadDirectory(relativePath)
  }

  const handleItemClick = (entry: FileEntry) => {
    if (entry.isDirectory) {
      const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
      navigateTo(newPath)
    }
  }

  const handleSaveAs = async (entry: FileEntry) => {
    const filePath = currentPath ? `${currentPath}/${entry.name}` : entry.name
    setSavingFile(entry.name)
    try {
      await window.electronAPI.files.saveAs(filePath)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loading'))
    } finally {
      setSavingFile(null)
    }
  }

  const handleOpenInSystem = async (entry?: FileEntry) => {
    const targetPath = entry
      ? (currentPath ? `${currentPath}/${entry.name}` : entry.name)
      : currentPath
    try {
      await window.electronAPI.files.openInSystem(targetPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loading'))
    }
  }

  // 面包屑
  const pathParts = currentPath ? currentPath.split('/') : []
  const breadcrumbs = [
    { label: t('root'), path: '' },
    ...pathParts.map((part, idx) => ({
      label: part,
      path: pathParts.slice(0, idx + 1).join('/'),
    })),
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold text-gray-800">{t('title')}</h1>
        <button
          onClick={() => handleOpenInSystem()}
          className="text-xs px-3 py-1.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          title={`${t('openInSystem')} ${rootDir}`}
        >
          {t('openInSystem')}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        {t('subtitle')}
      </p>

      {/* 面包屑导航 */}
      <div className="flex items-center gap-1 text-sm mb-4 flex-wrap">
        {breadcrumbs.map((crumb, idx) => (
          <span key={crumb.path} className="flex items-center">
            {idx > 0 && <span className="text-gray-300 mx-1">/</span>}
            {idx === breadcrumbs.length - 1 ? (
              <span className="text-gray-700 font-medium">{crumb.label}</span>
            ) : (
              <button
                onClick={() => navigateTo(crumb.path)}
                className="text-sky-600 hover:text-sky-800 hover:underline transition-colors"
              >
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {/* 文件列表 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* 表头 */}
        <div className="grid grid-cols-[1fr_100px_160px_80px] gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs text-gray-500 font-medium">
          <span>{t('table.name')}</span>
          <span className="text-right">{t('table.size')}</span>
          <span>{t('table.modifiedAt')}</span>
          <span className="text-center">{t('table.actions')}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
            <span className="ml-3 text-sm text-gray-500">{t('loading')}</span>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            {t('empty')}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {files.map(entry => (
              <div
                key={entry.name}
                className={`grid grid-cols-[1fr_100px_160px_80px] gap-2 px-4 py-2.5 text-sm items-center hover:bg-gray-50 transition-colors ${
                  entry.isDirectory ? 'cursor-pointer' : ''
                }`}
                onClick={() => handleItemClick(entry)}
              >
                {/* 文件名 */}
                <div className="flex items-center min-w-0">
                  <span className="mr-2 flex-shrink-0">{getFileIcon(entry.name, entry.isDirectory)}</span>
                  <span className={`truncate ${entry.isDirectory ? 'text-sky-700 font-medium' : 'text-gray-700'}`}>
                    {entry.name}
                  </span>
                </div>

                {/* 大小 */}
                <span className="text-right text-gray-400 text-xs">
                  {formatFileSize(entry.size)}
                </span>

                {/* 修改时间 */}
                <span className="text-gray-400 text-xs">
                  {formatDate(entry.modifiedAt)}
                </span>

                {/* 操作按钮 */}
                <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                  {!entry.isDirectory && (
                    <button
                      onClick={() => handleSaveAs(entry)}
                      disabled={savingFile === entry.name}
                      className="text-xs px-2 py-1 rounded text-sky-600 hover:bg-sky-50 transition-colors disabled:opacity-50"
                      title={t('actions.download')}
                    >
                      {savingFile === entry.name ? '...' : t('actions.download')}
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenInSystem(entry)}
                    className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100 transition-colors"
                    title={t('openInSystem')}
                  >
                    {t('actions.open')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <p className="text-xs text-gray-400 mt-3">
        {t('path')}{rootDir || '~/.openclaw'}
        &nbsp;·&nbsp;{t('hint')}
      </p>
    </div>
  )
}
