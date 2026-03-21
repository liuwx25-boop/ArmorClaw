import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { modelsApi } from '@/api/cloud/models'
import { fetchConfig, fetchConfigHash, patchConfig } from '@/api/container/gateway'
import type { ApiKeyItem, AiModel } from '@/types'

interface ConfiguredModel {
  provider: string
  label: string
}

export default function ConfigApiKeys() {
  const { t } = useTranslation('ai')
  // === API Key 相关状态 ===
  const [keys, setKeys] = useState<ApiKeyItem[]>([])
  const [keysLoading, setKeysLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [viewingPlaintext, setViewingPlaintext] = useState<string | null>(null)
  const [fetchingPlaintext, setFetchingPlaintext] = useState(false)
  const [copied, setCopied] = useState(false)

  // === 配置 API Key 相关状态 ===
  const [selectedModelId, setSelectedModelId] = useState('')
  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModel[]>([])
  const [configLoading, setConfigLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [configDeleting, setConfigDeleting] = useState<string | null>(null)
  const [, setBaseHash] = useState('')
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)

  // === 模型列表 ===
  const [allModels, setAllModels] = useState<AiModel[]>([])

  // === 错误状态 ===
  const [error, setError] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // ==================== 数据加载 ====================

  const loadKeys = useCallback(async () => {
    try {
      setError(null)
      const res = await modelsApi.listApiKeys()
      setKeys(res.data.data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('apiKeys.loading.default'))
    } finally {
      setKeysLoading(false)
    }
  }, [t])

  const loadModels = useCallback(async () => {
    try {
      const res = await modelsApi.getModels()
      const models = res.data.data || []
      setAllModels(models)
      if (models.length > 0 && !selectedModelId) {
        setSelectedModelId(models[0].model_id)
      }
    } catch {
      setAllModels([])
    }
  }, [selectedModelId])

  const loadGatewayConfig = useCallback(async () => {
    try {
      const config = await fetchConfig()
      setBaseHash(config.hash)
      const models: ConfiguredModel[] = []
      const innerConfig = (config as Record<string, unknown>).config as Record<string, unknown> | undefined
      const rawModels = (innerConfig?.models ?? config.models) as Record<string, unknown> | undefined
      const rawProviders = (rawModels?.providers ?? {}) as Record<string, Record<string, unknown>>
      if (rawProviders && typeof rawProviders === 'object') {
        for (const [gwKey, data] of Object.entries(rawProviders)) {
          if (data && typeof data === 'object' && data.apiKey) {
            const baseUrl = (data as Record<string, unknown>).baseUrl as string | undefined
            if (data.apiKey === 'byok-placeholder' || (baseUrl && baseUrl.includes('/byok/'))) continue

            const providerModels = (data as Record<string, unknown>).models as Array<{ id?: string; name?: string }> | undefined
            let label = gwKey
            if (providerModels && Array.isArray(providerModels) && providerModels.length > 0) {
              const modelNames = providerModels
                .map(m => m.name || m.id || '')
                .filter(Boolean)
              if (modelNames.length > 0) {
                label = modelNames.join(', ')
              }
            }
            models.push({ provider: gwKey, label })
          }
        }
      }
      setConfiguredModels(models)
    } catch (err) {
      if (!error) setError(err instanceof Error ? err.message : t('apiKeys.loading.config'))
    } finally {
      setConfigLoading(false)
    }
  }, [error, t])

  useEffect(() => {
    loadKeys()
    loadModels()
    loadGatewayConfig()
  }, [loadKeys, loadModels, loadGatewayConfig])

  /** 获取最新 hash 后执行 patchConfig，确保不会因 hash 过期而静默失败 */
  const safePatchConfig = async (raw: string): Promise<void> => {
    const latestHash = await fetchConfigHash()
    await patchConfig(raw, latestHash)
  }

  // ==================== API Key CRUD ====================

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      await modelsApi.createApiKey()
      await loadKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('apiKeys.createBtn'))
    } finally {
      setCreating(false)
    }
  }

  const handleView = async (keyId: number) => {
    setFetchingPlaintext(true)
    setCopied(false)
    try {
      const res = await modelsApi.getApiKeyPlaintext(keyId)
      setViewingPlaintext(res.data.data.api_key)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('apiKeys.modal.title'))
    } finally {
      setFetchingPlaintext(false)
    }
  }

  const handleCopy = async () => {
    if (!viewingPlaintext) return
    try {
      await navigator.clipboard.writeText(viewingPlaintext)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(t('apiKeys.modal.title'))
    }
  }

  const handleDeleteKey = async (keyId: number) => {
    if (!window.confirm(t('common:confirm') + '?')) return
    setDeleting(keyId)
    try {
      // 先获取要删除的 key 的明文，用于清理 models.json
      let apiKeyToDelete = ''
      try {
        const plaintextRes = await modelsApi.getApiKeyPlaintext(keyId)
        apiKeyToDelete = plaintextRes.data.data.api_key
      } catch {
        // 获取明文失败，继续删除云端 key
      }

      await modelsApi.deleteApiKey(keyId)

      // 清理 models.json 中所有包含该 apiKey 的 provider
      if (apiKeyToDelete) {
        await window.electronAPI.modelsJson.cleanupByApiKey({ apiKey: apiKeyToDelete })
        // 清除本地平台 Key 存储
        await window.electronAPI.byok.clearPlatformKey()
      }

      await loadKeys()
      // 如果删除的是当前选中的key，清除选择
      if (selectedKeyId === keyId) {
        setSelectedKeyId(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('apiKeys.actions.delete'))
    } finally {
      setDeleting(null)
    }
  }

  // ==================== 配置模型 ====================

  const modelIds = allModels.map(m => m.model_id)

  // 过滤出未配置的API Key（status为inactive）
  const availableKeys = keys.filter(k => k.status === 'inactive')

  const handleAddModel = async () => {
    if (!selectedKeyId) {
      setSaveResult({ ok: false, message: t('apiKeys.select.apiKey') })
      return
    }
    if (!selectedModelId) {
      setSaveResult({ ok: false, message: t('apiKeys.select.model') })
      return
    }

    setSaving(true)
    setSaveResult(null)
    try {
      // ====== 阶段 1：并行执行不相互依赖的前置任务 ======
      // - 获取 proxyBaseUrl（IPC，快）
      // - 获取明文 Key（HTTP，~几百ms）
      // 两者互不依赖，可以并行
      const selectedKey = keys.find(k => k.key_id === selectedKeyId)

      const [proxyBaseUrl, plaintextResult] = await Promise.all([
        window.electronAPI.config.getProxyBaseUrl(),
        selectedKey
          ? modelsApi.getApiKeyPlaintext(selectedKey.key_id).then(res => ({
              ok: true as const,
              apiKey: res.data.data.api_key,
            })).catch(err => ({
              ok: false as const,
              apiKey: '',
              error: err,
            }))
          : Promise.resolve({ ok: true as const, apiKey: '' }),
      ])

      if (!proxyBaseUrl) {
        setSaveResult({ ok: false, message: t('modelConfig.error') })
        setSaving(false)
        return
      }

      if (!plaintextResult.ok) {
        console.error('[ConfigApiKeys] Failed to get plaintext key:', (plaintextResult as { error: unknown }).error)
        setSaveResult({ ok: false, message: t('apiKeys.modal.title') })
        setSaving(false)
        return
      }

      const activatedApiKey = plaintextResult.apiKey
      if (activatedApiKey) {
        console.log('[ConfigApiKeys] Got plaintext key:', activatedApiKey.substring(0, 10) + '...')
      }

      // ====== 阶段 2：保存本地 Key（必须在 patchConfig 之前完成，因为 Gateway 重启后会立即用到） ======
      if (activatedApiKey) {
        try {
          await window.electronAPI.byok.savePlatformKey({ apiKey: activatedApiKey })
          console.log('[ConfigApiKeys] Platform key saved to local storage')
        } catch (err) {
          console.error('[ConfigApiKeys] Failed to save platform key:', err)
          setSaveResult({ ok: false, message: t('apiKeys.modal.title') })
          setSaving(false)
          return
        }
      }

      // ====== 阶段 3：并行执行 Gateway 配置推送 + 云端激活 ======
      // - patchConfig 通过 WebSocket 推送到 Gateway（会触发 Gateway 重启，耗时长）
      // - activateModel 通过 HTTP 调用云端（与 Gateway 无关）
      // 两者互不依赖，可以并行
      const gatewayName = 'openclaw'
      const primaryModelName = `${gatewayName}/${selectedModelId}`
      const raw = JSON.stringify({
        models: {
          providers: {
            [gatewayName]: {
              apiKey: 'platform-managed',
              baseUrl: proxyBaseUrl,
              models: [{
                id: selectedModelId,
                name: selectedModelId,
                api: 'openai-completions',
              }],
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

      const tasks: Promise<unknown>[] = [safePatchConfig(raw)]

      if (activatedApiKey) {
        tasks.push(
          modelsApi.activateModel({
            api_key: activatedApiKey,
            model_id: selectedModelId,
          })
            .then(() => {
              console.log('[ConfigApiKeys] Model activated successfully')
              return loadKeys()
            })
            .catch(err => {
              console.error('[ConfigApiKeys] Activation failed (key already saved locally):', err)
              // 激活失败不阻塞，本地 Key 已保存，proxy-server 可以正常工作
            })
        )
      }

      await Promise.all(tasks)

      setSaveResult({ ok: true, message: t('apiKeys.config.success') })
      setSelectedKeyId(null)
      timerRef.current = setTimeout(() => loadGatewayConfig(), 3000)
    } catch (err) {
      setSaveResult({ ok: false, message: err instanceof Error ? err.message : t('apiKeys.buttons.saveAndApply') })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteModel = async (model: ConfiguredModel) => {
    setConfigDeleting(model.provider)
    try {
      const raw = JSON.stringify({ models: { providers: { [model.provider]: null } } })
      await safePatchConfig(raw)

      // 清理 models.json 中的 provider
      await window.electronAPI.modelsJson.cleanupProvider({ providerId: model.provider })

      timerRef.current = setTimeout(() => loadGatewayConfig(), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('apiKeys.actions.delete'))
    } finally {
      setConfigDeleting(null)
    }
  }

  return (
    <div>
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
          <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
          <button onClick={() => setError(null)} className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 ml-4">✕</button>
        </div>
      )}

      {/* ==================== 上部分：API Key 管理 ==================== */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('apiKeys.title')}</h2>
          <button
            onClick={handleCreate}
            disabled={creating}
            className={`px-4 py-2 text-white text-sm rounded transition-colors ${
              creating ? 'bg-gray-400 cursor-wait' : 'bg-[#1e1e2e] hover:bg-[#313244] dark:bg-blue-500 dark:hover:bg-blue-600'
            }`}
          >
            {creating ? t('apiKeys.creatingBtn') : t('apiKeys.createBtn')}
          </button>
        </div>

        {/* 安全提示 */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 mb-4 text-sm text-blue-800 dark:text-blue-300">
          <ul className="list-disc pl-4 space-y-1">
            <li>{t('apiKeys.securityNote')}</li>
            <li>{t('apiKeys.newKeyNote')}</li>
          </ul>
        </div>

        {/* Key 列表 */}
        {keysLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            <span className="ml-3 text-gray-500 text-sm">{t('apiKeys.loading.default')}</span>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">{t('apiKeys.table.key')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('apiKeys.table.status')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('apiKeys.table.createdAt')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('apiKeys.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {keys.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-10 text-gray-400">
                      {t('apiKeys.empty.noKeys')}
                    </td>
                  </tr>
                ) : (
                  keys.map((item) => (
                    <tr key={item.key_id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-mono">{item.api_key}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${
                          item.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1 ${
                            item.status === 'active' ? 'bg-green-500' : 'bg-gray-400'
                          }`} />
                          {item.status === 'active' ? t('apiKeys.status.active') : t('apiKeys.status.inactive')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{item.created_at}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleView(item.key_id)} className="text-blue-500 hover:text-blue-600 cursor-pointer mr-3">
                          {t('apiKeys.actions.view')}
                        </button>
                        <button
                          onClick={() => handleDeleteKey(item.key_id)}
                          disabled={deleting === item.key_id}
                          className="text-red-500 hover:text-red-600 cursor-pointer disabled:opacity-50"
                        >
                          {deleting === item.key_id ? t('apiKeys.deleting') : t('apiKeys.actions.delete')}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== 下部分：配置模型 ==================== */}
      <div>
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">{t('apiKeys.config.title')}</h2>

        {configLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            <span className="ml-3 text-gray-500 text-sm">{t('apiKeys.loading.config')}</span>
          </div>
        ) : (
          <>
            {/* 已配置模型 */}
            {configuredModels.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">{t('modelConfig.configured')}</h3>
                <div className="space-y-2">
                  {configuredModels.map(model => (
                    <div key={model.provider} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{model.label}</span>
                        <span className="flex items-center text-xs">
                          <span className="w-1.5 h-1.5 rounded-full mr-1 bg-green-500" />
                          <span className="text-green-600 dark:text-green-400">{t('modelConfig.configuredBadge')}</span>
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteModel(model)}
                        disabled={configDeleting === model.provider}
                        className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                      >
                        {configDeleting === model.provider ? t('apiKeys.deleting') : t('apiKeys.actions.delete')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 新增模型表单 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">{t('modelConfig.addBtn')}</h3>
                <button
                  onClick={handleAddModel}
                  disabled={saving || modelIds.length === 0 || availableKeys.length === 0}
                  className={`px-5 py-1.5 text-white text-sm rounded transition-colors ${
                    saving || modelIds.length === 0 || availableKeys.length === 0 ? 'bg-blue-400 cursor-wait' : 'bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  {saving ? t('modelConfig.saving') : t('apiKeys.addBtn')}
                </button>
              </div>

              {modelIds.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">{t('apiKeys.empty.noModels')}</p>
              ) : availableKeys.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">{t('apiKeys.empty.noKeys')}</p>
              ) : (
                <>
                  <div className="flex items-start gap-4">
                    {/* 选择模型 */}
                    <div className="flex-shrink-0">
                      <label className="text-sm text-gray-500 dark:text-gray-400 mb-1 block">{t('apiKeys.select.selectModel')}</label>
                      <select
                        value={selectedModelId}
                        onChange={e => { setSelectedModelId(e.target.value); setSaveResult(null) }}
                        disabled={saving}
                        className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-200 min-w-[200px]"
                      >
                        {modelIds.map(id => (
                          <option key={id} value={id}>{id}</option>
                        ))}
                      </select>
                    </div>

                    {/* 选择 API Key */}
                    <div className="flex-1 min-w-0">
                      <label className="text-sm text-gray-500 dark:text-gray-400 mb-1 block">{t('apiKeys.select.selectApiKey')}</label>
                      <select
                        value={selectedKeyId ?? ''}
                        onChange={e => { setSelectedKeyId(e.target.value ? Number(e.target.value) : null); setSaveResult(null) }}
                        disabled={saving}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 dark:text-gray-200"
                      >
                        <option value="">{t('apiKeys.select.apiKey')}</option>
                        {availableKeys.map(key => (
                          <option key={key.key_id} value={key.key_id}>
                            {key.api_key} {t('apiKeys.select.inactive')}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {saveResult && (
                    <div className={`mt-3 px-3 py-2 rounded text-sm ${
                      saveResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      {saveResult.message}
                    </div>
                  )}

                  <p className="text-xs text-gray-400 mt-3">
                    {t('modelConfig.apiKeyNote')}
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* 明文 Key 弹窗 */}
      {(viewingPlaintext !== null || fetchingPlaintext) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-[480px] max-w-[90vw]">
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4">{t('apiKeys.modal.title')}</h3>
            {fetchingPlaintext ? (
              <div className="flex items-center justify-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
                <span className="ml-2 text-gray-500 text-sm">{t('apiKeys.loading.default')}</span>
              </div>
            ) : (
              <>
                <div className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-3 py-2 font-mono text-sm text-gray-800 dark:text-gray-200 break-all select-all">
                  {viewingPlaintext}
                </div>
                <p className="text-xs text-gray-400 mt-2">{t('apiKeys.modal.warning')}</p>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={handleCopy}
                    className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    {copied ? t('common:copied') : t('common:copy')}
                  </button>
                  <button
                    onClick={() => { setViewingPlaintext(null); setCopied(false) }}
                    className="px-4 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                  >
                    {t('common:close')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
