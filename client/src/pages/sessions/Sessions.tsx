import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchSessions,
  deleteSession,
  resetSession,
  compactSession,
  fetchSessionPreview,
  GatewaySessionRow,
  SessionPreviewItem,
} from '@/api/container/gateway'
import { formatRelativeTime, formatDateTime, formatTokens as formatTokensUtil } from '@/i18n/formatters'

const kindColors: Record<string, string> = {
  direct: 'bg-green-50 text-green-700',
  group: 'bg-purple-50 text-purple-700',
  global: 'bg-yellow-50 text-yellow-700',
  unknown: 'bg-gray-100 text-gray-500',
}

// Token 使用量颜色等级
function tokenLevelColor(total?: number): string {
  if (!total) return 'text-gray-400'
  if (total > 50000) return 'text-red-600 font-semibold'
  if (total > 20000) return 'text-orange-500 font-medium'
  if (total > 5000) return 'text-yellow-600'
  return 'text-gray-600'
}

type ModalType = 'delete' | 'reset' | 'compact' | 'preview' | null

export default function Sessions() {
  const { t } = useTranslation('sessions')
  const [sessions, setSessions] = useState<GatewaySessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 展开的会话详情
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  // 弹窗状态
  const [modalType, setModalType] = useState<ModalType>(null)
  const [modalTarget, setModalTarget] = useState<string | null>(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalSuccess, setModalSuccess] = useState<string | null>(null)

  // 预览数据
  const [previewItems, setPreviewItems] = useState<SessionPreviewItem[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  // 压缩参数
  const [compactLines, setCompactLines] = useState(50)

  // Timer ref for cleanup on unmount
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // 动态生成带翻译的标签
  const kindLabels = useMemo(() => ({
    direct: t('kinds.direct'),
    group: t('kinds.group'),
    global: t('kinds.global'),
    unknown: t('kinds.unknown'),
  }), [t])

  const channelLabels = useMemo((): Record<string, string> => ({
    wecom: t('channels.wecom'),
    feishu: t('channels.feishu'),
    dingtalk: t('channels.dingtalk'),
    qqbot: t('channels.qqbot'),
    telegram: t('channels.telegram'),
    discord: t('channels.discord'),
  }), [t])

  const loadSessions = useCallback(async (isRefresh = false) => {
    try {
      setError(null)
      if (isRefresh) setRefreshing(true)
      const list = await fetchSessions()
      setSessions(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.delete'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [t])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  const openModal = (type: ModalType, key: string) => {
    setModalType(type)
    setModalTarget(key)
    setModalError(null)
    setModalSuccess(null)
    setModalLoading(false)
  }

  const closeModal = () => {
    setModalType(null)
    setModalTarget(null)
    setModalError(null)
    setModalSuccess(null)
    setPreviewItems([])
  }

  const handleDelete = async () => {
    if (!modalTarget) return
    setModalLoading(true)
    setModalError(null)
    try {
      await deleteSession(modalTarget)
      setModalSuccess(t('success.delete'))
      timerRef.current = setTimeout(() => {
        closeModal()
        loadSessions()
      }, 800)
    } catch (err) {
      setModalError(err instanceof Error ? err.message : t('error.delete'))
    } finally {
      setModalLoading(false)
    }
  }

  const handleReset = async () => {
    if (!modalTarget) return
    setModalLoading(true)
    setModalError(null)
    try {
      await resetSession(modalTarget)
      setModalSuccess(t('success.reset'))
      timerRef.current = setTimeout(() => {
        closeModal()
        loadSessions()
      }, 1000)
    } catch (err) {
      setModalError(err instanceof Error ? err.message : t('error.reset'))
    } finally {
      setModalLoading(false)
    }
  }

  const handleCompact = async () => {
    if (!modalTarget) return
    setModalLoading(true)
    setModalError(null)
    try {
      const result = await compactSession(modalTarget, compactLines)
      if (result.compacted) {
        setModalSuccess(t('success.compact'))
      } else {
        setModalSuccess(result.reason === 'no transcript'
          ? t('modal.compact.description')
          : `${t('modal.compact.keepRecent')} ${compactLines}`)
      }
      timerRef.current = setTimeout(() => {
        closeModal()
        loadSessions()
      }, 1200)
    } catch (err) {
      setModalError(err instanceof Error ? err.message : t('error.compact'))
    } finally {
      setModalLoading(false)
    }
  }

  const loadPreview = async (key: string) => {
    setPreviewLoading(true)
    setPreviewItems([])
    openModal('preview', key)
    try {
      const result = await fetchSessionPreview(key, 30)
      if (result && result.items && result.items.length > 0) {
        setPreviewItems(result.items)
      } else {
        setPreviewItems([])
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : t('error.delete'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const toggleExpand = (key: string) => {
    setExpandedKey(expandedKey === key ? null : key)
  }

  const getSessionTitle = (s: GatewaySessionRow): string => {
    return s.displayName || s.label || s.derivedTitle || s.key
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">{t('title')}</h1>
        <p className="text-sm text-gray-500 mb-6">{t('subtitle')}</p>
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-500 text-sm">{t('loading')}</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* 页头 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800 mb-1">{t('title')}</h1>
          <p className="text-sm text-gray-500">
            {t('totalSessions', { count: sessions.length })}
            {sessions.length > 0 && (
              <span className="ml-2">
                · {t('totalTokens', { tokens: formatTokensUtil(sessions.reduce((sum, s) => sum + (s.totalTokens || 0), 0)) })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => loadSessions(true)}
          disabled={refreshing}
          className={`px-4 py-1.5 text-sm border border-gray-300 rounded transition-colors ${
            refreshing ? 'text-gray-400 cursor-wait' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{error}</span>
          <button
            onClick={() => { setLoading(true); loadSessions() }}
            className="text-sm text-red-600 hover:text-red-800 underline ml-4"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {/* 会话列表 */}
      {sessions.length === 0 && !error ? (
        <div className="bg-white rounded-lg border border-gray-200 px-5 py-16 text-center">
          <p className="text-gray-400 text-sm">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(session => (
            <div key={session.key} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {/* 会话卡片主体 */}
              <div
                className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50/50 transition-colors"
                onClick={() => toggleExpand(session.key)}
              >
                <div className="flex-1 min-w-0">
                  {/* 第一行：标题 + 标签 */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="text-sm font-medium text-gray-800 truncate max-w-[280px]"
                      title={getSessionTitle(session)}
                    >
                      {getSessionTitle(session)}
                    </span>
                    <span className={`flex-shrink-0 px-1.5 py-0.5 text-xs rounded ${kindColors[session.kind] || 'bg-gray-100 text-gray-500'}`}>
                      {kindLabels[session.kind] || session.kind}
                    </span>
                    {session.channel && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 text-xs rounded bg-blue-50 text-blue-600">
                        {channelLabels[session.channel] || session.channel}
                      </span>
                    )}
                  </div>
                  {/* 第二行：key + 更新时间 + token */}
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="truncate max-w-[200px]" title={session.key}>{session.key}</span>
                    <span className="flex-shrink-0">{formatRelativeTime(session.updatedAt)}</span>
                    {session.model && (
                      <span className="flex-shrink-0 text-gray-500">{session.model}</span>
                    )}
                    {(session.totalTokens !== undefined && session.totalTokens > 0) && (
                      <span className={`flex-shrink-0 ${tokenLevelColor(session.totalTokens)}`}>
                        {formatTokensUtil(session.totalTokens)} tokens
                      </span>
                    )}
                  </div>
                  {/* 最后一条消息预览 */}
                  {session.lastMessagePreview && (
                    <p className="mt-1 text-xs text-gray-400 truncate max-w-[500px]" title={session.lastMessagePreview}>
                      {session.lastMessagePreview}
                    </p>
                  )}
                </div>
                {/* 展开指示器 */}
                <svg
                  className={`flex-shrink-0 w-4 h-4 text-gray-400 transition-transform ${expandedKey === session.key ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* 展开的详情面板 */}
              {expandedKey === session.key && (
                <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/30">
                  {/* 详情信息网格 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <DetailItem label={t('table.session')} value={session.key} mono />
                    {session.sessionId && (
                      <DetailItem label="Session ID" value={session.sessionId} mono />
                    )}
                    <DetailItem label={t('table.time')} value={session.updatedAt ? formatDateTime(session.updatedAt) : '-'} />
                    <DetailItem label={t('table.type')} value={kindLabels[session.kind] || session.kind} />
                    {session.channel && (
                      <DetailItem label={t('table.channel')} value={channelLabels[session.channel] || session.channel} />
                    )}
                    {session.model && (
                      <DetailItem label={t('table.model')} value={`${session.modelProvider ? session.modelProvider + '/' : ''}${session.model}`} />
                    )}
                    {session.contextTokens && (
                      <DetailItem label="Context" value={`${formatTokensUtil(session.contextTokens)} tokens`} />
                    )}
                  </div>

                  {/* Token 使用详情 */}
                  {(session.totalTokens !== undefined && session.totalTokens > 0) && (
                    <div className="mb-4">
                      <h4 className="text-xs font-medium text-gray-500 mb-2">Token</h4>
                      <div className="flex items-center gap-6">
                        <TokenBar label="Input" value={session.inputTokens} total={session.totalTokens} color="bg-blue-400" />
                        <TokenBar label="Output" value={session.outputTokens} total={session.totalTokens} color="bg-green-400" />
                        <div className="text-xs">
                          <span className="text-gray-400">Total:</span>
                          <span className={tokenLevelColor(session.totalTokens)}>
                            {formatTokensUtil(session.totalTokens)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                    <ActionButton
                      label={t('actions.viewMessages')}
                      icon={
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      }
                      onClick={() => loadPreview(session.key)}
                      variant="default"
                    />
                    <ActionButton
                      label={t('actions.reset')}
                      icon={
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      }
                      onClick={() => openModal('reset', session.key)}
                      variant="warning"
                    />
                    <ActionButton
                      label={t('actions.compact')}
                      icon={
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      }
                      onClick={() => { setCompactLines(50); openModal('compact', session.key) }}
                      variant="default"
                    />
                    <ActionButton
                      label={t('actions.delete')}
                      icon={
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      }
                      onClick={() => openModal('delete', session.key)}
                      variant="danger"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ========== 弹窗 ========== */}
      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeModal}>
          <div className="bg-white rounded-lg shadow-lg w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* 弹窗头部 */}
            <div className="px-6 pt-5 pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-800">
                {modalType === 'delete' && t('modal.delete.title')}
                {modalType === 'reset' && t('modal.reset.title')}
                {modalType === 'compact' && t('modal.compact.title')}
                {modalType === 'preview' && t('modal.preview.title')}
              </h3>
              <p className="text-xs text-gray-400 mt-1 font-mono break-all">{modalTarget}</p>
            </div>

            {/* 弹窗内容 */}
            <div className="px-6 py-4 flex-1 overflow-y-auto">
              {modalType === 'delete' && (
                <div>
                  <p className="text-sm text-gray-600 mb-2">{t('modal.delete.description')}</p>
                </div>
              )}

              {modalType === 'reset' && (
                <div>
                  <p className="text-sm text-gray-600 mb-3">{t('modal.reset.title')}</p>
                  <ul className="text-sm text-gray-600 space-y-1.5 list-disc list-inside">
                    <li>{t('modal.reset.generating')}</li>
                    <li>{t('modal.reset.tokenReset')}</li>
                    <li>{t('modal.reset.keepConfig')}</li>
                    <li>{t('modal.reset.keepHistory')}</li>
                  </ul>
                </div>
              )}

              {modalType === 'compact' && (
                <div>
                  <p className="text-sm text-gray-600 mb-3">
                    {t('modal.compact.description')}
                  </p>
                  <div className="flex items-center gap-3 mb-3">
                    <label className="text-sm text-gray-600 flex-shrink-0">{t('modal.compact.keepRecent')}</label>
                    <input
                      type="number"
                      min={10}
                      max={500}
                      value={compactLines}
                      onChange={e => setCompactLines(Math.max(10, parseInt(e.target.value) || 50))}
                      className="w-24 px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <span className="text-sm text-gray-500">{t('modal.compact.messages')}</span>
                  </div>
                  <div className="bg-yellow-50 rounded px-3 py-2 text-xs text-yellow-700">
                    {t('modal.compact.suggestion')}
                  </div>
                </div>
              )}

              {modalType === 'preview' && (
                <div>
                  {previewLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                      <span className="ml-2 text-sm text-gray-500">{t('loading')}</span>
                    </div>
                  ) : previewItems.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">{t('empty')}</p>
                  ) : (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {previewItems.map((item, idx) => (
                        <div
                          key={idx}
                          className={`px-3 py-2 rounded text-sm ${
                            item.role === 'user'
                              ? 'bg-blue-50 text-blue-800'
                              : item.role === 'assistant'
                              ? 'bg-gray-50 text-gray-700'
                              : 'bg-yellow-50 text-yellow-700'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-medium opacity-60">
                              {item.role === 'user' ? t('roles.user') : item.role === 'assistant' ? t('roles.assistant') : item.role}
                            </span>
                            {item.timestamp && (
                              <span className="text-xs opacity-40">{formatDateTime(item.timestamp)}</span>
                            )}
                          </div>
                          <p className="text-sm whitespace-pre-wrap break-words">{item.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 成功/错误提示 */}
              {modalSuccess && (
                <div className="mt-3 bg-green-50 border border-green-200 rounded px-3 py-2 text-sm text-green-700">
                  {modalSuccess}
                </div>
              )}
              {modalError && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
                  {modalError}
                </div>
              )}
            </div>

            {/* 弹窗底部按钮 */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={closeModal}
                disabled={modalLoading}
                className="px-4 py-1.5 text-sm border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {modalType === 'preview' ? t('common:close') : t('common:cancel')}
              </button>
              {modalType === 'delete' && !modalSuccess && (
                <button
                  onClick={handleDelete}
                  disabled={modalLoading}
                  className={`px-4 py-1.5 text-sm text-white rounded transition-colors ${
                    modalLoading ? 'bg-red-400 cursor-wait' : 'bg-red-500 hover:bg-red-600'
                  }`}
                >
                  {modalLoading ? t('apiKeys.deleting') : t('buttons.confirmDelete')}
                </button>
              )}
              {modalType === 'reset' && !modalSuccess && (
                <button
                  onClick={handleReset}
                  disabled={modalLoading}
                  className={`px-4 py-1.5 text-sm text-white rounded transition-colors ${
                    modalLoading ? 'bg-orange-400 cursor-wait' : 'bg-orange-500 hover:bg-orange-600'
                  }`}
                >
                  {modalLoading ? t('apiKeys.deleting') : t('buttons.confirmReset')}
                </button>
              )}
              {modalType === 'compact' && !modalSuccess && (
                <button
                  onClick={handleCompact}
                  disabled={modalLoading}
                  className={`px-4 py-1.5 text-sm text-white rounded transition-colors ${
                    modalLoading ? 'bg-blue-400 cursor-wait' : 'bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  {modalLoading ? t('apiKeys.deleting') : t('buttons.confirmCompact')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ========== 子组件 ========== */

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className={`text-xs text-gray-700 truncate ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </div>
    </div>
  )
}

function TokenBar({ label, value, total, color }: { label: string; value?: number; total?: number; color: string }) {
  const pct = value && total ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-12">{label}</span>
      <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600">{formatTokensUtil(value)} ({pct}%)</span>
    </div>
  )
}

function ActionButton({
  label,
  icon,
  onClick,
  variant,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  variant: 'default' | 'warning' | 'danger'
}) {
  const colors = {
    default: 'text-gray-600 hover:bg-gray-100 border-gray-200',
    warning: 'text-orange-600 hover:bg-orange-50 border-orange-200',
    danger: 'text-red-500 hover:bg-red-50 border-red-200',
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded transition-colors ${colors[variant]}`}
    >
      {icon}
      {label}
    </button>
  )
}
