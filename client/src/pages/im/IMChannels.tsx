import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchConfig, patchConfig } from '@/api/container/gateway'

interface IMChannel {
  provider: string
  label: string
  enabled: boolean
}

interface ProviderConfig {
  labelKey: string
  descriptionKey: string
  helpUrl: string
  fields: { key: string; labelKey: string; secret?: boolean }[]
}

const providerConfigDefs: Record<string, ProviderConfig> = {
  feishu: {
    labelKey: 'providers.feishu.label',
    descriptionKey: 'providers.feishu.description',
    helpUrl: 'https://open.feishu.cn/',
    fields: [
      { key: 'appId', labelKey: 'providers.feishu.appId' },
      { key: 'appSecret', labelKey: 'providers.feishu.appSecret', secret: true },
    ],
  },
  dingtalk: {
    labelKey: 'providers.dingtalk.label',
    descriptionKey: 'providers.dingtalk.description',
    helpUrl: 'https://open-dev.dingtalk.com/',
    fields: [
      { key: 'appKey', labelKey: 'providers.dingtalk.appKey' },
      { key: 'appSecret', labelKey: 'providers.dingtalk.appSecret', secret: true },
    ],
  },
  qqbot: {
    labelKey: 'providers.qqbot.label',
    descriptionKey: 'providers.qqbot.description',
    helpUrl: 'https://q.qq.com/',
    fields: [
      { key: 'appId', labelKey: 'providers.qqbot.appId' },
      { key: 'appSecret', labelKey: 'providers.qqbot.appSecret', secret: true },
    ],
  },
  wecom: {
    labelKey: 'providers.wecom.label',
    descriptionKey: 'providers.wecom.description',
    helpUrl: 'https://developer.work.weixin.qq.com/',
    fields: [
      { key: 'corpId', labelKey: 'providers.wecom.corpId' },
      { key: 'agentId', labelKey: 'providers.wecom.agentId' },
      { key: 'secret', labelKey: 'providers.wecom.secret', secret: true },
    ],
  },
}

export default function IMChannels() {
  const { t } = useTranslation('im')
  const [configuredChannels, setConfiguredChannels] = useState<IMChannel[]>([])
  const [selectedProvider, setSelectedProvider] = useState('dingtalk')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({})

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [baseHash, setBaseHash] = useState('')
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 配对相关状态
  const [pairingProvider, setPairingProvider] = useState('feishu')
  const [pairingCode, setPairingCode] = useState('')
  const [pairingLoading, setPairingLoading] = useState(false)
  const [pairingResult, setPairingResult] = useState<{ ok: boolean; message: string } | null>(null)

  // 动态生成带翻译的 providerConfigs
  const providerConfigs = useMemo(() => {
    const result: Record<string, { label: string; description: string; helpUrl: string; fields: { key: string; label: string; secret?: boolean }[] }> = {}
    for (const [key, config] of Object.entries(providerConfigDefs)) {
      result[key] = {
        label: t(config.labelKey),
        description: t(config.descriptionKey),
        helpUrl: config.helpUrl,
        fields: config.fields.map(f => ({
          key: f.key,
          label: t(f.labelKey),
          secret: f.secret,
        })),
      }
    }
    return result
  }, [t])

  const currentConfig = providerConfigs[selectedProvider]

  // Timer ref for cleanup on unmount
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  /** 检查一个 channel 配置对象是否包含有效的认证字段 */
  function hasAuthFields(provider: string, channelData: Record<string, unknown>): boolean {
    const config = providerConfigDefs[provider]
    if (!config) return false
    return config.fields.some(f => {
      const val = channelData[f.key]
      return val !== undefined && val !== null && val !== ''
    })
  }

  const loadConfig = useCallback(async () => {
    try {
      setError(null)
      const config = await fetchConfig()
      setBaseHash(config.hash)

      // 从 channels 解析已配置的通道
      const channels: IMChannel[] = []
      const innerConfig = (config as Record<string, unknown>).config as Record<string, unknown> | undefined
      const rawChannels = (innerConfig?.channels ?? config.channels) as Record<string, Record<string, unknown>> | undefined
      if (rawChannels && typeof rawChannels === 'object') {
        for (const [key, data] of Object.entries(rawChannels)) {
          if (key in providerConfigDefs && data && typeof data === 'object') {
            if (hasAuthFields(key, data as Record<string, unknown>)) {
              const channelData = data as Record<string, unknown>
              channels.push({
                provider: key,
                label: providerConfigs[key]?.label || key,
                enabled: channelData.enabled !== false,
              })
            }
          }
        }
      }
      setConfiguredChannels(channels)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('config.missing'))
    } finally {
      setLoading(false)
    }
  }, [t, providerConfigs])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider)
    setFieldValues({})
    setVisibleSecrets({})
    setSaveResult(null)
  }

  const toggleSecretVisibility = (key: string) => {
    setVisibleSecrets(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleApply = async () => {
    // 校验必填字段
    const emptyFields = currentConfig.fields.filter(f => !fieldValues[f.key]?.trim())
    if (emptyFields.length > 0) {
      setSaveResult({ ok: false, message: `${t('config.missing')}: ${emptyFields.map(f => f.label).join(', ')}` })
      return
    }

    setSaving(true)
    setSaveResult(null)
    try {
      // 构建 channel 配置
      const channelConfig: Record<string, unknown> = { enabled: true }
      for (const field of currentConfig.fields) {
        const val = fieldValues[field.key]?.trim()
        if (val) channelConfig[field.key] = val
      }

      const raw = JSON.stringify({ channels: { [selectedProvider]: channelConfig } })

      // 尝试 patch，如果 baseHash 过期则自动刷新后重试一次
      let currentHash = baseHash
      try {
        await patchConfig(raw, currentHash)
      } catch (firstErr) {
        const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr)
        if (errMsg.includes('config changed since last load') || errMsg.includes('re-run config.get')) {
          // baseHash 过期，重新获取最新配置后重试
          const freshConfig = await fetchConfig()
          currentHash = freshConfig.hash
          setBaseHash(currentHash)
          await patchConfig(raw, currentHash)
        } else {
          throw firstErr
        }
      }

      setSaveResult({ ok: true, message: t('apiKeys.config.success') })
      setFieldValues({})
      setVisibleSecrets({})

      // 延迟刷新配置（等 Gateway 重启）
      timerRef.current = setTimeout(() => loadConfig(), 3000)
    } catch (err) {
      setSaveResult({ ok: false, message: err instanceof Error ? err.message : t('saving') })
    } finally {
      setSaving(false)
    }
  }

  const handlePairing = async () => {
    const code = pairingCode.trim()
    if (!code) {
      setPairingResult({ ok: false, message: t('pairing.codePlaceholder') })
      return
    }
    setPairingLoading(true)
    setPairingResult(null)
    try {
      const result = await window.electronAPI.docker.approvePairing(pairingProvider, code)
      setPairingResult({ ok: result.success, message: result.success ? t('pairing.success') : t('pairing.failed') })
      if (result.success) setPairingCode('')
    } catch (err) {
      setPairingResult({ ok: false, message: err instanceof Error ? err.message : t('pairing.failed') })
    } finally {
      setPairingLoading(false)
    }
  }

  const handleDelete = async (provider: string) => {
    setDeleting(provider)
    try {
      // JSON Merge Patch: null 删除键
      const raw = JSON.stringify({ channels: { [provider]: null } })

      let currentHash = baseHash
      try {
        await patchConfig(raw, currentHash)
      } catch (firstErr) {
        const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr)
        if (errMsg.includes('config changed since last load') || errMsg.includes('re-run config.get')) {
          const freshConfig = await fetchConfig()
          currentHash = freshConfig.hash
          setBaseHash(currentHash)
          await patchConfig(raw, currentHash)
        } else {
          throw firstErr
        }
      }

      timerRef.current = setTimeout(() => loadConfig(), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('apiKeys.actions.delete'))
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">{t('title')}</h1>
        <p className="text-sm text-gray-500 mb-6">{t('subtitle')}</p>
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-500 text-sm">{t('common:loading')}</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-2">{t('title')}</h1>
      <p className="text-sm text-gray-500 mb-6">{t('subtitle')}</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{error}</span>
          <button
            onClick={() => { setLoading(true); loadConfig() }}
            className="text-sm text-red-600 hover:text-red-800 underline ml-4"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {/* 已配置的通道列表 */}
      {configuredChannels.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-gray-600 mb-2">{t('configured')}</h2>
          <div className="space-y-2">
            {configuredChannels.map(channel => (
              <div
                key={channel.provider}
                className="bg-white rounded-lg border border-gray-200 px-5 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-800">{channel.label}</span>
                  <span className="flex items-center text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full mr-1 ${
                      channel.enabled ? 'bg-green-500' : 'bg-gray-400'
                    }`} />
                    <span className={channel.enabled ? 'text-green-600' : 'text-gray-500'}>
                      {channel.enabled ? t('status.enabled') : t('status.disabled')}
                    </span>
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(channel.provider)}
                  disabled={deleting === channel.provider}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                >
                  {deleting === channel.provider ? t('apiKeys.deleting') : t('apiKeys.actions.delete')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 新增通道 */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">{t('addChannel')}</h2>
          <button
            onClick={handleApply}
            disabled={saving}
            className={`px-5 py-1.5 text-white text-sm rounded transition-colors ${
              saving ? 'bg-blue-400 cursor-wait' : 'bg-blue-500 hover:bg-blue-600'
            }`}
          >
            {saving ? t('saving') : t('applyBtn')}
          </button>
        </div>

        {/* 通道选择 + 凭证输入 */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <label className="text-sm text-gray-500 mb-1 block">{t('config.title')}</label>
            <select
              value={selectedProvider}
              onChange={e => handleProviderChange(e.target.value)}
              disabled={saving}
              className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[120px]"
            >
              {Object.entries(providerConfigs).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
          </div>

          {currentConfig.fields.map(field => (
            <div key={field.key} className="flex-1 min-w-0">
              <label className="text-sm text-gray-500 mb-1 block">&nbsp;</label>
              <div className="relative">
                <input
                  type={field.secret && !visibleSecrets[field.key] ? 'password' : 'text'}
                  placeholder={field.label}
                  value={fieldValues[field.key] || ''}
                  onChange={e => setFieldValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  disabled={saving}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm placeholder-gray-400 disabled:bg-gray-50"
                />
                {field.secret && (
                  <button
                    type="button"
                    onClick={() => toggleSecretVisibility(field.key)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {visibleSecrets[field.key] ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 保存结果反馈 */}
        {saveResult && (
          <div className={`mt-3 px-3 py-2 rounded text-sm ${
            saveResult.ok
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {saveResult.message}
          </div>
        )}

        {/* 平台描述 + 帮助链接 */}
        <p className="text-xs text-gray-400 mt-3">
          {currentConfig.description}
          {' '}
          <a
            href={currentConfig.helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-600"
          >
            {t('common:confirm')} &#8599;
          </a>
        </p>
      </div>

      {/* 用户配对 */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mt-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">{t('pairing.title')}</h2>
        <p className="text-xs text-gray-400 mb-4">
          {t('pairing.description')}
        </p>

        <div className="flex items-end gap-3">
          <div className="flex-shrink-0">
            <label className="text-sm text-gray-500 mb-1 block">{t('pairing.platform')}</label>
            <select
              value={pairingProvider}
              onChange={e => { setPairingProvider(e.target.value); setPairingResult(null) }}
              disabled={pairingLoading}
              className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[120px]"
            >
              {Object.entries(providerConfigs).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-0">
            <label className="text-sm text-gray-500 mb-1 block">{t('pairing.code')}</label>
            <input
              type="text"
              placeholder={t('pairing.codePlaceholder')}
              value={pairingCode}
              onChange={e => setPairingCode(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter' && !pairingLoading) handlePairing() }}
              disabled={pairingLoading}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm placeholder-gray-400 disabled:bg-gray-50 font-mono tracking-wider"
            />
          </div>

          <button
            onClick={handlePairing}
            disabled={pairingLoading || !pairingCode.trim()}
            className={`px-5 py-2 text-white text-sm rounded transition-colors flex-shrink-0 ${
              pairingLoading || !pairingCode.trim()
                ? 'bg-green-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            {pairingLoading ? t('pairing.approving') : t('pairing.approveBtn')}
          </button>
        </div>

        {pairingResult && (
          <div className={`mt-3 px-3 py-2 rounded text-sm ${
            pairingResult.ok
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {pairingResult.message}
          </div>
        )}
      </div>
    </div>
  )
}
