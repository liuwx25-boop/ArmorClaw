import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PROVIDER_PRESETS } from '@/config/providers'
import type { ProviderPreset } from '@/config/providers'
import { fetchConfigHash, patchConfig } from '@/api/container/gateway'

interface BYOKListItem {
  providerId: string
  providerName: string
  baseUrl: string
  modelName: string
  apiKeyMasked: string
}

const CUSTOM_ID = '__custom__'

export default function BYOKConfig() {
  const { t } = useTranslation('ai')
  // 表单状态
  const [selectedProviderId, setSelectedProviderId] = useState(PROVIDER_PRESETS[0]?.id || '')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [customProviderId, setCustomProviderId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [modelName, setModelName] = useState('')

  // 操作状态
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)

  // 列表状态
  const [configuredItems, setConfiguredItems] = useState<BYOKListItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editModelName, setEditModelName] = useState('')
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const isCustom = selectedProviderId === CUSTOM_ID
  const selectedPreset: ProviderPreset | undefined = PROVIDER_PRESETS.find(p => p.id === selectedProviderId)
  const activeBaseUrl = isCustom ? customBaseUrl : (selectedPreset?.baseUrl || '')

  // 加载已配置列表
  const loadList = useCallback(async () => {
    const items = await window.electronAPI.byok.list()
    setConfiguredItems(items)
    setListLoading(false)
  }, [])

  useEffect(() => {
    loadList()
  }, [loadList])

  /** 获取最新 hash 后执行 patchConfig，确保不会因 hash 过期而静默失败 */
  const safePatchConfig = async (raw: string): Promise<void> => {
    const latestHash = await fetchConfigHash()
    await patchConfig(raw, latestHash)
  }

  // 测试连接
  const handleTest = async () => {
    if (!apiKey.trim() || !activeBaseUrl.trim() || !modelName.trim()) {
      setTestResult({ ok: false, message: t('byok.form.baseUrlPlaceholder') })
      return
    }
    setTesting(true)
    setTestResult(null)
    const result = await window.electronAPI.byok.test({
      baseUrl: activeBaseUrl,
      apiKey: apiKey.trim(),
      modelName: modelName.trim(),
    })
    setTestResult({ ok: result.success, message: result.message })
    setTesting(false)
  }

  // 保存并应用
  const handleSave = async () => {
    const providerId = isCustom ? customProviderId.trim() : selectedProviderId
    if (!providerId) {
      setSaveResult({ ok: false, message: t('byok.form.providerIdPlaceholder') })
      return
    }
    if (!apiKey.trim()) {
      setSaveResult({ ok: false, message: t('byok.form.apiKeyPlaceholder') })
      return
    }
    if (!activeBaseUrl.trim()) {
      setSaveResult({ ok: false, message: t('byok.form.baseUrlPlaceholder') })
      return
    }
    if (!modelName.trim()) {
      setSaveResult({ ok: false, message: t('byok.form.modelNamePlaceholder') })
      return
    }

    setSaving(true)
    setSaveResult(null)

    // Step 1 + 2: 通过 IPC 保存 API Key（加密）和配置
    await window.electronAPI.byok.save({
      providerId,
      baseUrl: activeBaseUrl.trim(),
      apiKey: apiKey.trim(),
      modelName: modelName.trim(),
    })

    // Step 3: 通过 Gateway patchConfig 写入 OpenClaw（apiKey 为占位符）
    // 先删除旧 provider（如已存在），避免 mergeObjectArraysById 追加旧模型
    const deleteRaw = JSON.stringify({
      models: { providers: { [providerId]: null } },
    })
    try { await safePatchConfig(deleteRaw) } catch { /* provider 可能不存在，忽略 */ }

    const proxyBaseUrl = await window.electronAPI.config.getProxyBaseUrl()
    const proxyUrl = new URL(proxyBaseUrl)
    const byokBaseUrl = `${proxyUrl.protocol}//${proxyUrl.host}/byok/${providerId}`

    const primaryModelName = `${providerId}/${modelName.trim()}`
    const createRaw = JSON.stringify({
      models: {
        providers: {
          [providerId]: {
            apiKey: 'byok-placeholder',
            baseUrl: byokBaseUrl,
            models: [{
              id: modelName.trim(),
              name: modelName.trim(),
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

    await safePatchConfig(createRaw)

    setSaveResult({ ok: true, message: t('apiKeys.config.success') })
    setApiKey('')
    setApiKeyVisible(false)
    setModelName('')
    setSaving(false)

    timerRef.current = setTimeout(() => loadList(), 2000)
  }

  // 删除配置
  const handleDelete = async (item: BYOKListItem) => {
    setDeletingId(item.providerId)

    // 通过 IPC 删除加密 Key + 配置
    await window.electronAPI.byok.delete({ providerId: item.providerId })

    // 通过 Gateway patchConfig 删除 provider（null = JSON Merge Patch 删除）
    const raw = JSON.stringify({ models: { providers: { [item.providerId]: null } } })
    await safePatchConfig(raw)

    // 清理 models.json 中的 provider
    await window.electronAPI.modelsJson.cleanupProvider({ providerId: item.providerId })

    setDeletingId(null)
    timerRef.current = setTimeout(() => loadList(), 2000)
  }

  // 更换模型
  const handleStartEdit = (item: BYOKListItem) => {
    setEditingId(item.providerId)
    setEditModelName(item.modelName)
  }

  const handleConfirmEdit = async (item: BYOKListItem) => {
    if (!editModelName.trim()) return

    // 通过 IPC 更新模型名
    await window.electronAPI.byok.updateModel({
      providerId: item.providerId,
      modelName: editModelName.trim(),
    })

    // Gateway 的 config.patch 使用 mergeObjectArraysById，
    // 新模型会被追加到 models 数组而非替换旧模型。
    // 因此需要先删除整个 provider（null），再重建，确保旧模型被清除。

    // Step 1: 删除旧 provider
    const deleteRaw = JSON.stringify({
      models: { providers: { [item.providerId]: null } },
    })
    await safePatchConfig(deleteRaw)

    // Step 2: 重建 provider + 更新默认模型
    const proxyBaseUrl = await window.electronAPI.config.getProxyBaseUrl()
    const proxyUrl = new URL(proxyBaseUrl)
    const byokBaseUrl = `${proxyUrl.protocol}//${proxyUrl.host}/byok/${item.providerId}`

    const primaryModelName = `${item.providerId}/${editModelName.trim()}`
    const createRaw = JSON.stringify({
      models: {
        providers: {
          [item.providerId]: {
            apiKey: 'byok-placeholder',
            baseUrl: byokBaseUrl,
            models: [{
              id: editModelName.trim(),
              name: editModelName.trim(),
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
    await safePatchConfig(createRaw)

    setEditingId(null)
    timerRef.current = setTimeout(() => loadList(), 2000)
  }

  // 设为默认模型
  const handleSetDefault = async (item: BYOKListItem) => {
    setSettingDefaultId(item.providerId)
    const primaryModelName = `${item.providerId}/${item.modelName}`
    const raw = JSON.stringify({
      agents: {
        defaults: {
          model: {
            primary: primaryModelName,
          },
        },
      },
    })
    await safePatchConfig(raw)
    setSettingDefaultId(null)
  }

  // 按 category 分组
  const codingPlanPresets = PROVIDER_PRESETS.filter(p => p.category === 'coding-plan')
  const standardPresets = PROVIDER_PRESETS.filter(p => p.category === 'standard')

  return (
    <div>
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-1">{t('byok.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('byok.subtitle')}</p>
      </div>

      {/* 安全提示 */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-5 py-4 mb-5 text-sm text-blue-800 dark:text-blue-300">
        <div className="flex items-start">
          <svg className="w-4 h-4 mt-0.5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div>
            <p>{t('byok.securityNote')}</p>
          </div>
        </div>
      </div>

      {/* 新增配置表单 */}
      <div className="bg-white dark:bg-[#1e1e2e] rounded-lg border border-gray-200 dark:border-gray-700 p-5 mb-6">
        <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4">{t('byok.addBtn')}</h2>

        <div className="space-y-4">
          {/* 厂商选择 */}
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">{t('byok.selectProvider')}</label>
            <select
              value={selectedProviderId}
              onChange={(e) => {
                setSelectedProviderId(e.target.value)
                setTestResult(null)
                setSaveResult(null)
              }}
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-[#2a2a3e] text-gray-800 dark:text-gray-200"
            >
              <optgroup label={t('byok.tabs.codingPlan')}>
                {codingPlanPresets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label={t('byok.tabs.standard')}>
                {standardPresets.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label={t('byok.tabs.other')}>
                <option value={CUSTOM_ID}>{t('byok.tabs.custom')}</option>
              </optgroup>
            </select>
          </div>

          {/* 自定义厂商标识 */}
          {isCustom && (
            <div>
              <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">{t('byok.form.providerId')}</label>
              <input
                type="text"
                placeholder={t('byok.form.providerIdPlaceholder')}
                value={customProviderId}
                onChange={(e) => setCustomProviderId(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-[#2a2a3e] text-gray-800 dark:text-gray-200 placeholder-gray-400"
              />
            </div>
          )}

          {/* Base URL */}
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">{t('byok.form.baseUrl')}</label>
            <input
              type="text"
              value={activeBaseUrl}
              onChange={(e) => isCustom && setCustomBaseUrl(e.target.value)}
              readOnly={!isCustom}
              placeholder={isCustom ? t('byok.form.baseUrlPlaceholder') : ''}
              className={`w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 ${
                !isCustom ? 'bg-gray-50 dark:bg-[#252538] cursor-default' : 'bg-white dark:bg-[#2a2a3e]'
              }`}
            />
          </div>

          {/* API Key */}
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">{t('byok.form.apiKey')}</label>
            <div className="relative">
              <input
                type={apiKeyVisible ? 'text' : 'password'}
                placeholder={t('byok.form.apiKeyPlaceholder')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 pr-10 text-sm bg-white dark:bg-[#2a2a3e] text-gray-800 dark:text-gray-200 placeholder-gray-400"
              />
              <button
                type="button"
                onClick={() => setApiKeyVisible(!apiKeyVisible)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
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

          {/* 模型名称 */}
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">{t('byok.form.modelName')}</label>
            <input
              type="text"
              placeholder={t('byok.form.modelNamePlaceholder')}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-[#2a2a3e] text-gray-800 dark:text-gray-200 placeholder-gray-400"
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              onClick={handleTest}
              disabled={testing || !apiKey.trim() || !activeBaseUrl.trim() || !modelName.trim()}
              className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {testing ? t('byok.buttons.testing') : t('byok.buttons.testConnection')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !apiKey.trim() || !activeBaseUrl.trim() || !modelName.trim()}
              className="px-4 py-2 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? t('byok.buttons.saving') : t('byok.buttons.saveAndApply')}
            </button>
          </div>

          {/* 结果提示 */}
          {testResult && (
            <div className={`px-4 py-3 rounded-lg text-sm ${
              testResult.ok
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
            }`}>
              {testResult.message}
            </div>
          )}
          {saveResult && (
            <div className={`px-4 py-3 rounded-lg text-sm ${
              saveResult.ok
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
            }`}>
              {saveResult.message}
            </div>
          )}
        </div>
      </div>

      {/* 已配置列表 */}
      <div className="bg-white dark:bg-[#1e1e2e] rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">{t('byok.list.title')}</h2>
        </div>

        {listLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-500" />
            <span className="ml-3 text-gray-500 dark:text-gray-400 text-sm">{t('common:loading')}</span>
          </div>
        ) : configuredItems.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
            {t('byok.list.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#252538] border-b border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                  <th className="text-left px-4 py-3 font-medium">{t('byok.selectProvider')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('byok.form.modelName')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('byok.form.apiKey')}</th>
                  <th className="text-left px-4 py-3 font-medium">{t('apiKeys.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {configuredItems.map(item => (
                  <tr key={item.providerId} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-[#252538] transition-colors">
                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-medium">{item.providerName}</td>
                    <td className="px-4 py-3">
                      {editingId === item.providerId ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editModelName}
                            onChange={(e) => setEditModelName(e.target.value)}
                            className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-[#2a2a3e] text-gray-800 dark:text-gray-200 w-40"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleConfirmEdit(item)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                          />
                          <button
                            onClick={() => handleConfirmEdit(item)}
                            className="text-xs text-green-600 dark:text-green-400 hover:text-green-700 cursor-pointer"
                          >
                            {t('common:confirm')}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
                          >
                            {t('common:cancel')}
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-700 dark:text-gray-300 font-mono">{item.modelName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">{item.apiKeyMasked}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleStartEdit(item)}
                          disabled={editingId !== null}
                          className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer disabled:opacity-50"
                        >
                          {t('byok.actions.changeModel')}
                        </button>
                        <button
                          onClick={() => handleSetDefault(item)}
                          disabled={settingDefaultId === item.providerId}
                          className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 cursor-pointer disabled:opacity-50"
                        >
                          {settingDefaultId === item.providerId ? t('byok.actions.setting') : t('byok.actions.setDefault')}
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={deletingId === item.providerId}
                          className="text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 cursor-pointer disabled:opacity-50"
                        >
                          {deletingId === item.providerId ? t('apiKeys.deleting') : t('apiKeys.actions.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
