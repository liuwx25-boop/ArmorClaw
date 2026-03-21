import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchConfig, patchConfig } from '@/api/container/gateway'
import { modelsApi } from '@/api/cloud/models'
import type { AiModel } from '@/types'

interface ConfiguredModel {
  provider: string      // Gateway config key
  label: string         // display label
}

export default function ModelConfig() {
  // Server model data
  const [models, setModels] = useState<AiModel[]>([])

  // Form state
  const [selectedModelId, setSelectedModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyVisible, setApiKeyVisible] = useState(false)

  // Configured models from Gateway
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModel[]>([])

  // UI state
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [baseHash, setBaseHash] = useState('')
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Timer ref for cleanup on unmount
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  /** Fetch available models from server (already deduplicated by model_id) */
  const loadModels = useCallback(async () => {
    try {
      const res = await modelsApi.getModels()
      const list = res.data.data || []
      setModels(list)
      if (list.length > 0 && !selectedModelId) {
        setSelectedModelId(list[0].model_id)
      }
    } catch {
      setModels([])
    }
  }, [])

  /** Load Gateway config to find already-configured providers */
  const loadGatewayConfig = useCallback(async () => {
    try {
      setError(null)
      const config = await fetchConfig()
      setBaseHash(config.hash)

      const items: ConfiguredModel[] = []
      const innerConfig = (config as Record<string, unknown>).config as Record<string, unknown> | undefined
      const rawModels = (innerConfig?.models ?? config.models) as Record<string, unknown> | undefined
      const rawProviders = (rawModels?.providers ?? {}) as Record<string, Record<string, unknown>>
      if (rawProviders && typeof rawProviders === 'object') {
        for (const [gwKey, data] of Object.entries(rawProviders)) {
          if (data && typeof data === 'object' && data.apiKey) {
            const providerModels = (data as Record<string, unknown>).models as Array<{ id?: string; name?: string }> | undefined
            let label = gwKey
            if (providerModels && Array.isArray(providerModels) && providerModels.length > 0) {
              const modelNames = providerModels.map(m => m.name || m.id || '').filter(Boolean)
              if (modelNames.length > 0) label = modelNames.join(', ')
            }
            items.push({ provider: gwKey, label })
          }
        }
      }
      setConfiguredModels(items)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取配置失败')
    }
  }, [])

  /** Load both server models and gateway config */
  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([loadModels(), loadGatewayConfig()])
    setLoading(false)
  }, [loadModels, loadGatewayConfig])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const handleAdd = async () => {
    if (!apiKey.trim()) {
      setSaveResult({ ok: false, message: '请输入大模型 API Key' })
      return
    }
    if (!selectedModelId) {
      setSaveResult({ ok: false, message: '请选择模型' })
      return
    }

    setSaving(true)
    setSaveResult(null)
    try {
      // 从 Electron 主进程获取本地代理地址（容器内访问宿主机 :19090）
      const proxyBaseUrl = await window.electronAPI.config.getProxyBaseUrl()
      if (!proxyBaseUrl) {
        setSaveResult({ ok: false, message: '无法获取本地代理地址' })
        setSaving(false)
        return
      }

      const gatewayName = 'openclaw'
      const primaryModelName = `${gatewayName}/${selectedModelId}`
      const raw = JSON.stringify({
        models: {
          providers: {
            [gatewayName]: {
              apiKey: apiKey.trim(),
              baseUrl: proxyBaseUrl,
              models: [{ id: selectedModelId, name: selectedModelId, api: 'openai-completions' }],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: primaryModelName,
            },
          },
        },
      })
      await patchConfig(raw, baseHash)

      setSaveResult({ ok: true, message: '配置已保存，Gateway 正在重启应用新配置...' })
      setApiKey('')
      setApiKeyVisible(false)

      // Delay refresh (wait for Gateway restart)
      timerRef.current = setTimeout(() => loadGatewayConfig(), 3000)
    } catch (err) {
      setSaveResult({ ok: false, message: err instanceof Error ? err.message : '保存配置失败' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (model: ConfiguredModel) => {
    setDeleting(model.provider)
    try {
      const raw = JSON.stringify({
        models: {
          providers: {
            [model.provider]: null,
          },
        },
      })
      await patchConfig(raw, baseHash)
      timerRef.current = setTimeout(() => loadGatewayConfig(), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除模型配置失败')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">大模型配置</h1>
        <p className="text-sm text-gray-500 mb-6">给 ArmorClaw 配置大模型 API Key</p>
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-500 text-sm">加载配置...</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-2">大模型配置</h1>
      <p className="text-sm text-gray-500 mb-6">给 ArmorClaw 配置大模型 API Key</p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-red-700">{error}</span>
          <button
            onClick={() => loadAll()}
            className="text-sm text-red-600 hover:text-red-800 underline ml-4"
          >
            重试
          </button>
        </div>
      )}

      {/* Configured models from Gateway */}
      {configuredModels.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-gray-600 mb-2">已配置模型</h2>
          <div className="space-y-2">
            {configuredModels.map(model => (
              <div
                key={model.provider}
                className="bg-white rounded-lg border border-gray-200 px-5 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-800">{model.label}</span>
                  <span className="flex items-center text-xs">
                    <span className="w-1.5 h-1.5 rounded-full mr-1 bg-green-500" />
                    <span className="text-green-600">已配置</span>
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(model)}
                  disabled={deleting === model.provider}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                >
                  {deleting === model.provider ? '删除中...' : '删除'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add model form */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">新增模型</h2>
          <button
            onClick={handleAdd}
            disabled={saving || models.length === 0}
            className={`px-5 py-1.5 text-white text-sm rounded transition-colors ${
              saving || models.length === 0 ? 'bg-blue-400 cursor-wait' : 'bg-blue-500 hover:bg-blue-600'
            }`}
          >
            {saving ? '保存中...' : '添加'}
          </button>
        </div>

        {models.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">暂无可用模型，请联系管理员配置</p>
        ) : (
          <>
            {/* Model + API Key */}
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <label className="text-sm text-gray-500 mb-1 block">模型</label>
                <select
                  value={selectedModelId}
                  onChange={e => { setSelectedModelId(e.target.value); setSaveResult(null) }}
                  disabled={saving}
                  className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[200px]"
                >
                  {models.map(m => (
                    <option key={m.model_id} value={m.model_id}>{m.model_name}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-w-0">
                <label className="text-sm text-gray-500 mb-1 block">大模型 API Key</label>
                <div className="relative">
                  <input
                    type={apiKeyVisible ? 'text' : 'password'}
                    placeholder="输入大模型 API Key"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    disabled={saving}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm placeholder-gray-400 disabled:bg-gray-50"
                  />
                  <button
                    type="button"
                    onClick={() => setApiKeyVisible(!apiKeyVisible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {apiKeyVisible ? (
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
                </div>
              </div>
            </div>

            {/* Save result feedback */}
            {saveResult && (
              <div className={`mt-3 px-3 py-2 rounded text-sm ${
                saveResult.ok
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {saveResult.message}
              </div>
            )}

            <p className="text-xs text-gray-400 mt-3">
              请输入大模型服务商提供的 API Key，配置后 ArmorClaw 将使用该 Key 调用对应的大模型服务。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
