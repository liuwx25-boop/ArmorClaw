import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface ContainerResourceData {
  limits: { cpus: number; memoryMB: number; pidsLimit: number; nofileLimit: number; diskLimitMB: number }
  usage: { cpuPercent: number; memoryUsageMB: number; memoryPercent: number; pids: number; netIO: string; blockIO: string; diskUsageMB: number }
  security: { capDrop: string[]; capAdd: string[]; securityOpt: string[]; networkMode: string; readOnly: boolean; user: string }
}

interface ResourceSettings {
  cpus: number
  memoryMB: number
  pidsLimit: number
  nofileLimit: number
  diskLimitMB: number
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className={`h-2 rounded-full transition-all duration-500 ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

function getColor(percent: number): string {
  if (percent > 80) return 'bg-red-500'
  if (percent > 50) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${Math.round(mb)} MB`
}

export default function ContainerResources() {
  const { t } = useTranslation('container')
  const [data, setData] = useState<ContainerResourceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [activeTab, setActiveTab] = useState<'usage' | 'limits' | 'settings'>('usage')

  // Settings state
  const [settings, setSettings] = useState<ResourceSettings>({ cpus: 0.5, memoryMB: 2048, pidsLimit: 50, nofileLimit: 256, diskLimitMB: 5120 })
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null)
  const [restarting, setRestarting] = useState(false)

  const isElectron = !!window.electronAPI

  const fetchResources = useCallback(async () => {
    if (!isElectron) {
      setError(t('resources.electronOnly'))
      setLoading(false)
      return
    }
    try {
      const res = await window.electronAPI.docker.getContainerResources()
      setData(res)
      setError(null)
      // Initialize settings from current limits
      if (res.limits.cpus > 0) {
        setSettings(prev => {
          // Only init if settings haven't been manually changed
          if (prev.cpus === 0.5 && prev.memoryMB === 2048 && prev.pidsLimit === 50 && prev.nofileLimit === 256 && prev.diskLimitMB === 5120) {
            return {
              cpus: res.limits.cpus,
              memoryMB: res.limits.memoryMB,
              pidsLimit: res.limits.pidsLimit,
              nofileLimit: res.limits.nofileLimit,
              diskLimitMB: res.limits.diskLimitMB,
            }
          }
          return prev
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('resources.error'))
    } finally {
      setLoading(false)
    }
  }, [isElectron, t])

  useEffect(() => {
    fetchResources()
  }, [fetchResources])

  useEffect(() => {
    if (!autoRefresh || activeTab !== 'usage') return
    const timer = setInterval(fetchResources, 5000)
    return () => clearInterval(timer)
  }, [autoRefresh, fetchResources, activeTab])

  const handleSave = async () => {
    if (!isElectron) return
    setSaving(true)
    setSaveMessage(null)
    try {
      const result = await window.electronAPI.docker.updateContainerResources(settings)
      if (result.success) {
        setSaveMessage({
          type: result.needsRestart ? 'warning' : 'success',
          text: result.message,
        })
        fetchResources()
      } else {
        setSaveMessage({ type: 'error', text: result.message })
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : t('settings.saved') })
    } finally {
      setSaving(false)
    }
  }

  const handleRestart = async () => {
    if (!isElectron) return
    setRestarting(true)
    setSaveMessage(null)
    try {
      const result = await window.electronAPI.docker.restartContainer()
      if (result.success) {
        setSaveMessage({ type: 'success', text: result.message })
        fetchResources()
      } else {
        setSaveMessage({ type: 'error', text: result.message })
      }
    } catch (err) {
      setSaveMessage({ type: 'error', text: err instanceof Error ? err.message : t('settings.saved') })
    } finally {
      setRestarting(false)
    }
  }

  const tabs = useMemo(() => [
    { key: 'usage' as const, label: t('resources.tabs.usage') },
    { key: 'limits' as const, label: t('resources.tabs.limits') },
    { key: 'settings' as const, label: t('resources.tabs.settings') },
  ], [t])

  const presets = useMemo(() => [
    { label: t('presets.light.name'), desc: t('presets.light.desc'), cpus: 0.5, memoryMB: 1024, pidsLimit: 30, nofileLimit: 256, diskLimitMB: 2048 },
    { label: t('presets.standard.name'), desc: t('presets.standard.desc'), cpus: 1, memoryMB: 2048, pidsLimit: 50, nofileLimit: 256, diskLimitMB: 5120 },
    { label: t('presets.high.name'), desc: t('presets.high.desc'), cpus: 2, memoryMB: 4096, pidsLimit: 200, nofileLimit: 1024, diskLimitMB: 10240 },
  ], [t])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
        <span className="ml-3 text-gray-500">{t('resources.loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">{t('resources.title')}</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      </div>
    )
  }

  if (!data) return null

  const { limits, usage, security } = data
  const cpuPercent = usage.cpuPercent
  const memPercent = limits.memoryMB > 0 ? (usage.memoryUsageMB / limits.memoryMB) * 100 : usage.memoryPercent
  const pidsPercent = limits.pidsLimit > 0 ? (usage.pids / limits.pidsLimit) * 100 : 0
  const diskPercent = limits.diskLimitMB > 0 ? (usage.diskUsageMB / limits.diskLimitMB) * 100 : 0

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800 mb-1">{t('resources.title')}</h1>
          <p className="text-sm text-gray-500">{t('resources.subtitle')}</p>
        </div>
        {activeTab === 'usage' && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded border-gray-300 text-sky-500 focus:ring-sky-500"
              />
              {t('resources.autoRefresh')}
            </label>
            <button
              onClick={() => { setLoading(true); fetchResources() }}
              className="text-xs px-3 py-1.5 rounded bg-sky-500 text-white hover:bg-sky-600 transition-colors"
            >
              {t('resources.refresh')}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-sky-500 text-sky-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: 实际利用率 */}
      {activeTab === 'usage' && (
        <div className="space-y-6">
          {/* CPU / 内存 / 进程数 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* CPU */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">{t('metrics.cpu')}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${cpuPercent > 80 ? 'bg-red-100 text-red-600' : cpuPercent > 50 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                  {cpuPercent.toFixed(1)}%
                </span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-3">{cpuPercent.toFixed(1)}%</div>
              <ProgressBar percent={cpuPercent} color={getColor(cpuPercent)} />
              <p className="text-xs text-gray-400 mt-2">{limits.cpus} cores</p>
            </div>

            {/* Memory */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">{t('metrics.memory')}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${memPercent > 80 ? 'bg-red-100 text-red-600' : memPercent > 50 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                  {memPercent.toFixed(1)}%
                </span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-3">{formatMB(usage.memoryUsageMB)}</div>
              <ProgressBar percent={memPercent} color={getColor(memPercent)} />
              <p className="text-xs text-gray-400 mt-2">{formatMB(limits.memoryMB)}</p>
            </div>

            {/* PIDs */}
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">{t('metrics.processes')}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${pidsPercent > 80 ? 'bg-red-100 text-red-600' : pidsPercent > 50 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                  {pidsPercent.toFixed(0)}%
                </span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-3">{usage.pids}</div>
              <ProgressBar percent={pidsPercent} color={getColor(pidsPercent)} />
              <p className="text-xs text-gray-400 mt-2">{limits.pidsLimit}</p>
            </div>
          </div>

          {/* Disk / Network / Block I/O */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-600">{t('metrics.disk')}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${diskPercent > 80 ? 'bg-red-100 text-red-600' : diskPercent > 50 ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                  {diskPercent.toFixed(0)}%
                </span>
              </div>
              <div className="text-2xl font-bold text-gray-900 mb-3">{formatMB(usage.diskUsageMB)}</div>
              <ProgressBar percent={diskPercent} color={getColor(diskPercent)} />
              <p className="text-xs text-gray-400 mt-2">{formatMB(limits.diskLimitMB)}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <span className="text-sm font-medium text-gray-600">{t('metrics.networkIO')}</span>
              <div className="text-lg font-bold text-gray-900 mt-3">{usage.netIO}</div>
              <p className="text-xs text-gray-400 mt-2">{t('metrics.inboundOutbound')}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <span className="text-sm font-medium text-gray-600">{t('metrics.diskIO')}</span>
              <div className="text-lg font-bold text-gray-900 mt-3">{usage.blockIO}</div>
              <p className="text-xs text-gray-400 mt-2">{t('metrics.readWrite')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: 资源限制 */}
      {activeTab === 'limits' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Resource limits */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-5">CPU / Memory</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-500">CPU</span>
                  <span className="text-sm font-semibold text-gray-800">{limits.cpus} cores</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-500">{t('metrics.memory')}</span>
                  <span className="text-sm font-semibold text-gray-800">{formatMB(limits.memoryMB)}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-500">{t('metrics.processes')}</span>
                  <span className="text-sm font-semibold text-gray-800">{limits.pidsLimit}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-500">File Descriptors</span>
                  <span className="text-sm font-semibold text-gray-800">{limits.nofileLimit}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">{t('metrics.disk')}</span>
                  <span className="text-sm font-semibold text-gray-800">{formatMB(limits.diskLimitMB)}</span>
                </div>
              </div>
            </div>

            {/* Security config */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-5">Security</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-500">User</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    security.user === 'root' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {security.user || 'node'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm text-gray-500">Network</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    security.networkMode === 'host' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {security.networkMode}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Privileges</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    security.securityOpt.includes('no-new-privileges') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {security.securityOpt.includes('no-new-privileges') ? 'no-new-privileges' : 'unrestricted'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: 资源设置 */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('settings.title')}</h3>
            <p className="text-xs text-gray-400 mb-6">{t('settings.restartRequired')}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* CPU */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CPU
                  <span className="ml-2 text-xs text-gray-400">{limits.cpus} cores</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0.25"
                    max="8"
                    step="0.25"
                    value={settings.cpus}
                    onChange={(e) => setSettings(s => ({ ...s, cpus: parseFloat(e.target.value) }))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-500"
                  />
                  <span className="text-sm font-semibold text-gray-800 w-16 text-right">{settings.cpus} cores</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0.25</span>
                  <span>8</span>
                </div>
              </div>

              {/* Memory */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('metrics.memory')}
                  <span className="ml-2 text-xs text-gray-400">{formatMB(limits.memoryMB)}</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="512"
                    max="16384"
                    step="512"
                    value={settings.memoryMB}
                    onChange={(e) => setSettings(s => ({ ...s, memoryMB: parseInt(e.target.value) }))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-500"
                  />
                  <span className="text-sm font-semibold text-gray-800 w-16 text-right">{formatMB(settings.memoryMB)}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>512 MB</span>
                  <span>16 GB</span>
                </div>
              </div>

              {/* PIDs */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('metrics.processes')}
                  <span className="ml-2 text-xs text-gray-400">{limits.pidsLimit}</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="20"
                    max="500"
                    step="10"
                    value={settings.pidsLimit}
                    onChange={(e) => setSettings(s => ({ ...s, pidsLimit: parseInt(e.target.value) }))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-500"
                  />
                  <span className="text-sm font-semibold text-gray-800 w-16 text-right">{settings.pidsLimit}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>20</span>
                  <span>500</span>
                </div>
              </div>

              {/* nofile */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  File Descriptors
                  <span className="ml-2 text-xs text-gray-400">{limits.nofileLimit}</span>
                  {settings.nofileLimit !== limits.nofileLimit && <span className="ml-1 text-xs text-amber-500">({t('settings.restartRequired')})</span>}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="128"
                    max="4096"
                    step="128"
                    value={settings.nofileLimit}
                    onChange={(e) => setSettings(s => ({ ...s, nofileLimit: parseInt(e.target.value) }))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-500"
                  />
                  <span className="text-sm font-semibold text-gray-800 w-16 text-right">{settings.nofileLimit}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>128</span>
                  <span>4096</span>
                </div>
              </div>

              {/* Disk */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('metrics.disk')}
                  <span className="ml-2 text-xs text-gray-400">{formatMB(limits.diskLimitMB)}</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1024"
                    max="51200"
                    step="1024"
                    value={settings.diskLimitMB}
                    onChange={(e) => setSettings(s => ({ ...s, diskLimitMB: parseInt(e.target.value) }))}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-500"
                  />
                  <span className="text-sm font-semibold text-gray-800 w-16 text-right">{formatMB(settings.diskLimitMB)}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>1 GB</span>
                  <span>50 GB</span>
                </div>
              </div>
            </div>

            {/* Save button */}
            <div className="mt-8 flex items-center gap-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 rounded-md bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? t('settings.saving') : t('settings.saveAndApply')}
              </button>
              <button
                onClick={() => setSettings({
                  cpus: limits.cpus,
                  memoryMB: limits.memoryMB,
                  pidsLimit: limits.pidsLimit,
                  nofileLimit: limits.nofileLimit,
                  diskLimitMB: limits.diskLimitMB,
                })}
                className="px-5 py-2 rounded-md border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                {t('settings.reset')}
              </button>
            </div>

            {/* Save message */}
            {saveMessage && (
              <div className={`mt-4 px-4 py-3 rounded-md text-sm flex items-center justify-between ${
                saveMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                saveMessage.type === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                'bg-red-50 text-red-700 border border-red-200'
              }`}>
                <span>{saveMessage.text}</span>
                {saveMessage.type === 'warning' && (
                  <button
                    onClick={handleRestart}
                    disabled={restarting}
                    className="ml-4 px-4 py-1.5 rounded-md bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    {restarting ? '...' : t('settings.restartNow')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Quick presets */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Presets</h3>
            <p className="text-xs text-gray-400 mb-4">{t('settings.restartRequired')}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setSettings({ cpus: preset.cpus, memoryMB: preset.memoryMB, pidsLimit: preset.pidsLimit, nofileLimit: preset.nofileLimit, diskLimitMB: preset.diskLimitMB })}
                  className="text-left p-4 rounded-lg border border-gray-200 hover:border-sky-300 hover:bg-sky-50 transition-colors"
                >
                  <div className="text-sm font-medium text-gray-800">{preset.label}</div>
                  <div className="text-xs text-gray-400 mt-1">{preset.desc}</div>
                  <div className="text-xs text-gray-500 mt-2">
                    {preset.cpus} cores / {formatMB(preset.memoryMB)} / {formatMB(preset.diskLimitMB)} disk / {preset.pidsLimit} processes
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
