import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  fetchSkillsList,
  patchSkillEnabled,
  updateSkillApiKey,
  updateSkillEnv,
  installSkill,
  type SkillInfo,
  type SkillInstallResult,
} from '@/api/container/gateway'

/** 技能可用性分类 */
type SkillCategory = 'available' | 'needs-credentials' | 'needs-tools' | 'needs-config' | 'macos-only'

/** 判断技能的可用性类别 */
function categorizeSkill(skill: SkillInfo): SkillCategory {
  if (skill.eligible) return 'available'
  if (skill.missing.os.length > 0) return 'macos-only'
  // 仅缺 bins/anyBins → 需安装工具
  if (skill.missing.bins.length > 0 || skill.missing.anyBins.length > 0) {
    return 'needs-tools'
  }
  // 缺环境变量 → 需配置凭证
  if (skill.missing.env.length > 0) {
    return 'needs-credentials'
  }
  // 仅缺 config → 需配置
  if (skill.missing.config.length > 0) {
    return 'needs-config'
  }
  return 'needs-tools'
}

/** 根据 missing 字段生成缺失说明 */
function describeMissing(skill: SkillInfo, t: (key: string, options?: Record<string, unknown>) => string): string[] {
  const items: string[] = []
  const m = skill.missing
  if (m.bins.length > 0) items.push(t('error.missingBins', { bins: m.bins.join(', ') }))
  if (m.anyBins.length > 0) items.push(t('error.missingAnyBins', { bins: m.anyBins.join(', ') }))
  if (m.env.length > 0) items.push(t('error.missingEnv', { env: m.env.join(', ') }))
  if (m.config.length > 0) items.push(t('error.missingConfig', { config: m.config.join(', ') }))
  return items
}

/** 根据 dot-separated 路径自动生成嵌套 JSON 示例 */
function buildJsonFromPath(dotPath: string): string {
  const parts = dotPath.split('.')
  // 从最内层开始构建
  let inner = 'true'
  for (let i = parts.length - 1; i >= 0; i--) {
    const key = parts[i]
    const indent = '  '.repeat(i + 1)
    inner = `{\n${indent}"${key}": ${inner}\n${'  '.repeat(i)}}`
  }
  return inner
}

/** 根据 config 路径生成配置指引 */
function getConfigGuide(configPath: string): { description: string; example: string; writeCommand?: string; steps: string[] } {
  // 常见 config 路径的配置指引
  const CONFIG_GUIDES: Record<string, { description: string; example: string; fields: string[] }> = {
    'channels.bluebubbles': {
      description: 'BlueBubbles (iMessage) 集成配置',
      fields: ['serverUrl - BlueBubbles 服务地址', 'password - API 密码', 'webhookPath - Webhook 路径'],
      example: `{
  "channels": {
    "bluebubbles": {
      "enabled": true,
      "serverUrl": "http://192.168.1.100:1234",
      "password": "your-password",
      "webhookPath": "/bluebubbles-webhook"
    }
  }
}`,
    },
    'channels.telegram': {
      description: 'Telegram Bot 集成配置',
      fields: ['token - Bot Token (从 @BotFather 获取)'],
      example: `{
  "channels": {
    "telegram": {
      "token": "your-bot-token"
    }
  }
}`,
    },
    'channels.discord': {
      description: 'Discord Bot 集成配置',
      fields: ['token - Bot Token (从 Discord Developer Portal 获取)'],
      example: `{
  "channels": {
    "discord": {
      "token": "your-bot-token"
    }
  }
}`,
    },
    'channels.slack': {
      description: 'Slack Bot 集成配置',
      fields: ['botToken - Bot Token (xoxb-...)', 'appToken - App Token (xapp-...)'],
      example: `{
  "channels": {
    "slack": {
      "botToken": "xoxb-your-token",
      "appToken": "xapp-your-token"
    }
  }
}`,
    },
    'plugins.entries.voice-call': {
      description: 'Voice Call 语音通话插件配置',
      fields: [
        'enabled - 是否启用 (true)',
        'config.provider - 服务商: "twilio" / "telnyx" / "plivo" / "mock"',
        'config.fromNumber - 发起呼叫的号码',
      ],
      example: `{
  "plugins": {
    "entries": {
      "voice-call": {
        "enabled": true,
        "config": {
          "provider": "twilio",
          "fromNumber": "+1234567890",
          "twilio": {
            "accountSid": "your-account-sid",
            "authToken": "your-auth-token"
          }
        }
      }
    }
  }
}`,
    },
  }

  const CONFIG_FILE = '~/.openclaw/openclaw.json'

  // 尝试匹配已知的配置
  for (const [prefix, guide] of Object.entries(CONFIG_GUIDES)) {
    if (configPath === prefix || configPath.startsWith(prefix + '.')) {
      return {
        description: guide.description,
        example: guide.example,
        writeCommand: guide.example
          ? `mkdir -p ~/.openclaw && cat > ${CONFIG_FILE} << 'EOF'\n${guide.example}\nEOF`
          : undefined,
        steps: [
          '1. 打开终端，进入容器',
          '2. 复制下方命令粘贴到终端执行（请先修改为实际值）',
          '3. 保存后重启 Gateway 或刷新此页面',
        ],
      }
    }
  }

  // 通用配置指引：根据 configPath 自动生成 JSON 结构
  const autoExample = buildJsonFromPath(configPath)
  return {
    description: `需要在 openclaw.json 中配置 "${configPath}"`,
    example: autoExample,
    writeCommand: `mkdir -p ~/.openclaw && cat > ${CONFIG_FILE} << 'EOF'\n${autoExample}\nEOF`,
    steps: [
      '1. 打开终端，进入容器',
      '2. 复制下方命令粘贴到终端执行（请先修改为实际值）',
      '3. 保存后重启 Gateway 或刷新此页面',
    ],
  }
}

/** 根据安装方式 kind 和错误信息，给出前置工具的安装指引 */
function getInstallRemediation(kind: string, message: string, stderr?: string): { hint: string; command?: string; steps?: string[] } | null {
  const msg = message.toLowerCase()

  if (msg.includes('apt 源中未找到') || msg.includes('unable to locate package')) {
    const pkgMatch = (stderr || '').match(/Unable to locate package (\S+)/i)
    const pkgName = pkgMatch?.[1] || '未知'
    return {
      hint: `apt 和 npm 均无法自动安装 "${pkgName}"。请参考下方官网文档，在终端中手动安装:`,
      steps: [
        '1. 打开终端，进入容器 (以 root 身份: su -)',
        '2. 参考下方官网链接，查找该工具的 Linux/Debian 安装方式',
        '3. 安装完成后回到此页面刷新状态',
      ],
    }
  }
  if (kind === 'brew' || msg.includes('brew not installed') || msg.includes('brew: not found')) {
    return {
      hint: 'Homebrew (brew) 不适用于当前容器环境。建议通过以下方式手动安装此工具:',
      steps: [
        '1. 打开终端，进入容器',
        '2. 参考下方官网链接，查找该工具的 Linux/Debian 安装方式（通常是 apt 或直接下载二进制）',
        '3. 安装完成后回到此页面刷新状态',
      ],
    }
  }
  if (msg.includes('pip not found') || msg.includes('pip: not found') || msg.includes('pip3: not found')) {
    return {
      hint: '容器内未安装 pip。请先在终端中切换到 root 并执行以下命令:',
      command: "su -c 'apt-get update && apt-get install -y python3-pip'",
    }
  }
  if (msg.includes('go: not found') || msg.includes('go not installed')) {
    return {
      hint: '容器内未安装 Go 工具链。请在终端中以 root 身份执行以下命令安装:',
      command: 'arch=$(uname -m) && goarch=$([ "$arch" = "aarch64" ] && echo arm64 || echo amd64) && curl -fsSL "https://go.dev/dl/go1.23.6.linux-${goarch}.tar.gz" | tar -C /usr/local -xz && ln -sf /usr/local/go/bin/go /usr/local/bin/go && go env -w GOPROXY=https://goproxy.cn,direct',
    }
  }
  if (msg.includes('npm: not found') || msg.includes('npm not installed')) {
    return {
      hint: '容器内未找到 npm。请先在终端中切换到 root 并执行以下命令:',
      command: "su -c 'apt-get update && apt-get install -y nodejs npm'",
    }
  }
  return null
}

export default function Skills() {
  const navigate = useNavigate()
  const { t } = useTranslation('skills')
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  // Tab 状态
  const [activeTab, setActiveTab] = useState<'builtin' | 'custom'>('builtin')

  // API Key 输入状态
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({})
  const [savingApiKey, setSavingApiKey] = useState<string | null>(null)
  const [apiKeySaveResult, setApiKeySaveResult] = useState<Record<string, { ok: boolean; message: string }>>({})

  // 依赖安装状态
  const [installingKey, setInstallingKey] = useState<string | null>(null)
  const [installResults, setInstallResults] = useState<Record<string, SkillInstallResult>>({})

  // 自定义技能状态
  const [customSkills, setCustomSkills] = useState<{ name: string; description: string; hasExtra: boolean; modifiedAt: string }[]>([])
  const [customLoading, setCustomLoading] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [removingSkill, setRemovingSkill] = useState<string | null>(null)
  const [previewSkill, setPreviewSkill] = useState<{ name: string; content: string } | null>(null)

  const loadSkills = useCallback(async () => {
    try {
      setError(null)
      const list = await fetchSkillsList()
      setSkills(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.fetchFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // 自定义技能相关函数
  const loadCustomSkills = useCallback(async () => {
    const electronApi = (window as any).electronAPI
    if (!electronApi?.customSkill) return
    try {
      setCustomError(null)
      setCustomLoading(true)
      const list = await electronApi.customSkill.list()
      setCustomSkills(list)
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : t('error.fetchCustomFailed'))
    } finally {
      setCustomLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (activeTab === 'custom') {
      loadCustomSkills()
    }
  }, [activeTab, loadCustomSkills])

  const handleImportSkill = async (mode: 'file' | 'folder') => {
    const electronApi = (window as any).electronAPI
    if (!electronApi?.customSkill) return
    setImporting(true)
    try {
      const result = await electronApi.customSkill.selectAndImport(mode)
      if (result.ok) {
        await loadCustomSkills()
        // 同时刷新内置技能列表，因为新导入的自定义技能会出现在 gateway 的技能列表中
        await loadSkills()
      } else if (result.message !== '已取消') {
        setCustomError(result.message)
      }
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : t('error.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  const handleRemoveSkill = async (skillName: string) => {
    const electronApi = (window as any).electronAPI
    if (!electronApi?.customSkill) return
    setRemovingSkill(skillName)
    try {
      const result = await electronApi.customSkill.remove(skillName)
      if (result.ok) {
        await loadCustomSkills()
        await loadSkills()
      } else {
        setCustomError(result.message)
      }
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : t('error.removeFailed'))
    } finally {
      setRemovingSkill(null)
    }
  }

  const handlePreviewSkill = async (skillName: string) => {
    if (previewSkill?.name === skillName) {
      setPreviewSkill(null)
      return
    }
    const electronApi = (window as any).electronAPI
    if (!electronApi?.customSkill) return
    try {
      const content = await electronApi.customSkill.read(skillName)
      setPreviewSkill({ name: skillName, content })
    } catch {
      setPreviewSkill({ name: skillName, content: t('custom.previewError') })
    }
  }

  const handleToggle = async (skill: SkillInfo) => {
    if (skill.eligible) {
      // skill 已 eligible，toggle 切换 disabled 状态
      const newEnabled = skill.disabled // disabled → 启用, 非 disabled → 禁用
      setTogglingSkill(skill.name)
      try {
        await patchSkillEnabled(skill.skillKey, newEnabled)
        await loadSkills()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('error.updateFailed'))
      } finally {
        setTogglingSkill(null)
      }
    } else {
      // skill 不 eligible（缺工具/凭证/配置），展开详情提示用户
      setExpandedSkill(prev => prev === skill.name ? null : skill.name)
    }
  }

  const handleSaveApiKey = async (skill: SkillInfo, envName: string, value: string) => {
    const key = `${skill.skillKey}-${envName}`
    setSavingApiKey(key)
    setApiKeySaveResult(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    try {
      if (skill.primaryEnv === envName) {
        await updateSkillApiKey(skill.skillKey, value)
      } else {
        await updateSkillEnv(skill.skillKey, { [envName]: value })
      }
      setApiKeySaveResult(prev => ({
        ...prev,
        [key]: { ok: true, message: t('config.saved') },
      }))
      await loadSkills()
    } catch (err) {
      setApiKeySaveResult(prev => ({
        ...prev,
        [key]: { ok: false, message: err instanceof Error ? err.message : t('config.saveFailed') },
      }))
    } finally {
      setSavingApiKey(null)
    }
  }

  const handleInstall = async (skill: SkillInfo, installId: string) => {
    const key = `${skill.name}-${installId}`
    setInstallingKey(key)
    setInstallResults(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    try {
      let result: SkillInstallResult

      // Electron 环境：使用客户端代理安装（支持 Docker root 权限提升）
      const electronApi = (window as any).electronAPI
      if (electronApi?.skillInstall) {
        const spec = skill.install.find(o => o.id === installId)
        result = await electronApi.skillInstall.execute({
          skillName: skill.name,
          installId,
          installSpec: spec,
          homepage: skill.homepage,
          timeoutMs: 300000,
        })
      } else {
        // 浏览器环境：走 Gateway RPC
        result = await installSkill(skill.name, installId)
      }

      setInstallResults(prev => ({ ...prev, [key]: result }))
      // 无论成功失败都刷新列表（工具可能已通过降级链部分安装成功）
      await loadSkills()
    } catch (err) {
      setInstallResults(prev => ({
        ...prev,
        [key]: {
          ok: false,
          message: err instanceof Error ? err.message : t('install.failed', { error: '' }),
          stdout: '',
          stderr: '',
          code: null,
        },
      }))
    } finally {
      setInstallingKey(null)
    }
  }

  // 状态标签翻译
  const statusLabels = useMemo((): Record<SkillCategory, string> => ({
    available: '',
    'needs-credentials': t('status.needsApiKey'),
    'needs-tools': t('status.missingDeps'),
    'needs-config': t('status.needsConfig'),
    'macos-only': t('status.macosOnly'),
  }), [t])

  // 按四组分类

  const availableSkills = skills.filter(s => categorizeSkill(s) === 'available')
  const needsCredsSkills = skills.filter(s => categorizeSkill(s) === 'needs-credentials')
  const needsToolsSkills = skills.filter(s => categorizeSkill(s) === 'needs-tools')
  const needsConfigSkills = skills.filter(s => categorizeSkill(s) === 'needs-config')
  const macosOnlySkills = skills.filter(s => categorizeSkill(s) === 'macos-only')

  /** 渲染凭证配置区域 */
  const renderCredentialsSection = (skill: SkillInfo) => {
    const envVars = skill.missing.env
    if (envVars.length === 0) return null

    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-amber-700">{t('config.needsCredentials')}</p>
        {envVars.map(envName => {
          const inputKey = `${skill.skillKey}-${envName}`
          const inputValue = apiKeyInputs[inputKey] ?? ''
          const isSaving = savingApiKey === inputKey
          const saveResult = apiKeySaveResult[inputKey]
          const isPrimary = skill.primaryEnv === envName

          return (
            <div key={envName} className="space-y-1">
              <label className="text-xs text-gray-600">
                {isPrimary ? t('config.apiKey') : envName}
                <span className="text-gray-400 ml-1">({envName})</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  placeholder={t('config.enterEnv', { name: envName })}
                  value={inputValue}
                  onChange={e => setApiKeyInputs(prev => ({ ...prev, [inputKey]: e.target.value }))}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono focus:outline-none focus:border-blue-400"
                />
                <button
                  onClick={() => handleSaveApiKey(skill, envName, inputValue)}
                  disabled={isSaving || !inputValue.trim()}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    isSaving || !inputValue.trim()
                      ? 'bg-gray-200 text-gray-400'
                      : 'bg-green-500 text-white hover:bg-green-600'
                  }`}
                >
                  {isSaving ? t('config.saving') : t('config.save')}
                </button>
              </div>
              {saveResult && (
                <p className={`text-xs ${saveResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {saveResult.message}
                </p>
              )}
            </div>
          )
        })}
        {skill.homepage && (
          <p className="text-xs text-gray-500">
            {t('config.getApiKey')}
            <a
              href={skill.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-blue-500 hover:text-blue-600 underline"
            >
              {skill.homepage}
            </a>
          </p>
        )}
      </div>
    )
  }

  /** 渲染展开区域内容（根据分类不同展示不同内容） */
  const renderExpandedContent = (skill: SkillInfo) => {
    const category = categorizeSkill(skill)
    const missingItems = describeMissing(skill, t)

    if (category === 'needs-credentials') {
      return renderCredentialsSection(skill)
    }

    if (category === 'needs-config') {
      const configPaths = skill.missing.config
      const guide = configPaths.length > 0 ? getConfigGuide(configPaths[0]) : null

      return (
        <div className="space-y-3">
          <ul className="space-y-1 text-xs text-amber-800">
            {missingItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>

          {guide && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-700">{guide.description}</p>

              {/* 配置步骤 */}
              <div className="p-2 bg-blue-50 border border-blue-200 rounded text-blue-800">
                <p className="text-xs font-medium mb-1">{t('config.configSteps')}</p>
                <ol className="space-y-0.5 text-xs text-blue-700 list-decimal list-inside">
                  <li>{t('config.step1')}</li>
                  <li>{t('config.step2')}</li>
                  <li>{t('config.step3')}</li>
                </ol>
              </div>

              {/* 一键写入命令 */}
              {guide.writeCommand && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-600">{t('config.writeCommand')}</p>
                  <div className="relative">
                    <pre className="text-[10px] bg-gray-800 text-green-300 rounded px-3 py-2 overflow-x-auto select-all font-mono whitespace-pre">
                      {guide.writeCommand}
                    </pre>
                    <button
                      onClick={() => navigator.clipboard.writeText(guide.writeCommand!)}
                      className="absolute top-1 right-1 px-2 py-0.5 text-[10px] bg-gray-600 text-gray-200 rounded hover:bg-gray-500 transition-colors"
                      title={t('actions.copy')}
                    >
                      {t('actions.copy')}
                    </button>
                  </div>
                  <p className="text-[10px] text-amber-600">
                    {t('config.overwriteWarning')} <code className="bg-gray-100 px-1 rounded">cat ~/.openclaw/openclaw.json</code> {t('config.viewExisting')}
                  </p>
                </div>
              )}

              {/* 配置示例（当没有 writeCommand 时作为参考） */}
              {guide.example && !guide.writeCommand && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-600">{t('config.configExample')}</p>
                  <div className="relative">
                    <pre className="text-[10px] bg-gray-800 text-green-300 rounded px-3 py-2 overflow-x-auto select-all font-mono whitespace-pre">
                      {guide.example}
                    </pre>
                    <button
                      onClick={() => navigator.clipboard.writeText(guide.example)}
                      className="absolute top-1 right-1 px-2 py-0.5 text-[10px] bg-gray-600 text-gray-200 rounded hover:bg-gray-500 transition-colors"
                      title={t('actions.copy')}
                    >
                      {t('actions.copy')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/app/terminal')}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 border border-gray-300 rounded hover:bg-gray-200 transition-colors"
            >
              {t('install.openTerminal')}
              <span>&rarr;</span>
            </button>
          </div>

          {skill.homepage && (
            <p className="text-xs text-gray-500">
              {t('info.docs')}
              <a
                href={skill.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-blue-500 hover:text-blue-600 underline"
              >
                {skill.homepage}
              </a>
            </p>
          )}
        </div>
      )
    }

    if (category === 'macos-only') {
      return (
        <p className="text-xs text-gray-600">
          {t('macosOnly.message', { os: skill.missing.os.join(', ') })}
        </p>
      )
    }

    // needs-tools
    const hasInstallOptions = skill.install.length > 0

    return (
      <div className="space-y-3">
        {missingItems.length > 0 && (
          <ul className="space-y-1 text-xs text-amber-800">
            {missingItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}

        {/* 一键安装选项 */}
        {hasInstallOptions ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-600 font-medium">{t('install.installMethod')}</p>
            {skill.install.map(option => {
              const key = `${skill.name}-${option.id}`
              const isInstalling = installingKey === key
              const result = installResults[key]
              return (
                <div key={option.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleInstall(skill, option.id)}
                      disabled={isInstalling || installingKey !== null}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
                        isInstalling
                          ? 'bg-blue-400 text-white cursor-wait'
                          : installingKey !== null
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      {isInstalling && (
                        <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      )}
                      {isInstalling ? t('install.installing') : t('install.oneClick', { label: option.label })}
                    </button>
                    <span className="text-xs text-gray-400">
                      {option.bins.length > 0 && t('install.providesCommands', { bins: option.bins.join(', ') })}
                    </span>
                  </div>
                  {result && (
                    <div className={`text-xs px-2 py-1.5 rounded ${
                      result.ok
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      <p>{result.ok ? t('install.success') : t('install.failed', { error: result.message })}</p>
                      {!result.ok && result.stderr && (
                        <pre className="mt-1 text-[10px] text-red-600 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                          {result.stderr}
                        </pre>
                      )}
                      {!result.ok && (() => {
                        const remediation = getInstallRemediation(option.kind, result.message, result.stderr)
                        if (!remediation) return null
                        return (
                          <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-blue-800">
                            <p className="text-xs">{remediation.hint}</p>
                            {remediation.steps && (
                              <ul className="mt-1.5 space-y-1 text-xs text-blue-700">
                                {remediation.steps.map((step, i) => (
                                  <li key={i}>{step}</li>
                                ))}
                              </ul>
                            )}
                            {remediation.command && (
                              <div className="mt-1.5 flex items-start gap-2">
                                <code className="flex-1 block text-[10px] bg-white border border-blue-100 rounded px-2 py-1 font-mono whitespace-pre-wrap break-all select-all">
                                  {remediation.command}
                                </code>
                                <button
                                  onClick={() => navigator.clipboard.writeText(remediation.command!)}
                                  className="flex-shrink-0 px-2 py-1 text-[10px] bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                                  title={t('actions.copy')}
                                >
                                  {t('actions.copy')}
                                </button>
                              </div>
                            )}
                            <p className="mt-1.5 text-[10px] text-blue-600">
                              {remediation.command
                                ? t('install.afterInstall')
                                : t('install.afterSteps')}
                            </p>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            {t('install.manualInstallHint')}
          </p>
        )}

        {/* 终端手动安装入口 */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/app/terminal')}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 border border-gray-300 rounded hover:bg-gray-200 transition-colors"
          >
            {t('install.manualInstall')}
            <span>&rarr;</span>
          </button>
        </div>

        {/* 如果同时也缺凭证，显示凭证配置 */}
        {skill.missing.env.length > 0 && (
          <>
            <div className="border-t border-amber-200"></div>
            {renderCredentialsSection(skill)}
          </>
        )}

        {skill.homepage && (
          <p className="text-xs text-gray-500">
            {t('info.website')}
            <a
              href={skill.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 text-blue-500 hover:text-blue-600 underline"
            >
              {skill.homepage}
            </a>
          </p>
        )}
      </div>
    )
  }

  /** 渲染单行 Skill */
  const renderSkillRow = (skill: SkillInfo, category: SkillCategory) => {
    // 只有 eligible 且未被用户禁用才算"启用"
    const isEnabled = !skill.disabled && skill.eligible
    const isToggling = togglingSkill === skill.name
    const isUnavailable = !skill.eligible
    const isExpanded = expandedSkill === skill.name

    return (
      <div key={skill.name} className={`px-5 py-4 ${isUnavailable ? 'opacity-75' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {skill.emoji && <span className="text-lg flex-shrink-0">{skill.emoji}</span>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-800">{skill.name}</p>
                {skill.homepage && category === 'available' && (
                  <a
                    href={skill.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-blue-500"
                    title={t('info.visitWebsite')}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{skill.description}</p>
              {isUnavailable && (
                <button
                  onClick={() => setExpandedSkill(isExpanded ? null : skill.name)}
                  className="text-xs text-amber-600 mt-1 hover:text-amber-700 flex items-center gap-1"
                >
                  <span>{isExpanded ? '▼' : '▶'}</span>
                  <span>{statusLabels[category]}</span>
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => handleToggle(skill)}
            disabled={isToggling}
            className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
              isToggling ? 'opacity-50 cursor-wait' :
              isEnabled ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                isEnabled ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {/* 展开的详情 */}
        {isExpanded && isUnavailable && (
          <div className="mt-3 ml-8 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs space-y-3">
            {renderExpandedContent(skill)}
          </div>
        )}
      </div>
    )
  }

  /** 渲染自定义技能 Tab 内容 */
  const renderCustomSkillsTab = () => {
    const electronApi = (window as any).electronAPI
    const hasElectron = !!electronApi?.customSkill

    if (!hasElectron) {
      return (
        <div className="text-center py-16 text-gray-400 text-sm">
          {t('custom.desktopOnly')}
        </div>
      )
    }

    return (
      <div>
        {/* 导入按钮区域 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative group">
            <button
              onClick={() => handleImportSkill('file')}
              disabled={importing}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                importing
                  ? 'bg-blue-400 text-white cursor-wait'
                  : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {importing && (
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {importing ? t('custom.importing') : t('custom.import')}
            </button>
          </div>
          <button
            onClick={() => handleImportSkill('folder')}
            disabled={importing}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${
              importing
                ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                : 'border-gray-300 text-gray-600 hover:border-blue-300 hover:text-blue-600'
            }`}
            title={t('custom.importFromFolder')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {t('custom.importFromFolder')}
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-4">
          {t('custom.importHint')}
        </p>

        {customError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
            <span className="text-sm text-red-700">{customError}</span>
            <button onClick={() => setCustomError(null)} className="text-red-400 hover:text-red-600 ml-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {customLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-500 text-sm">{t('custom.loading')}</span>
          </div>
        ) : customSkills.length === 0 ? (
          <div className="text-center py-16">
            <svg className="mx-auto w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-gray-400 text-sm">{t('custom.empty')}</p>
            <p className="text-gray-300 text-xs mt-1">{t('custom.emptyHint')}</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {customSkills.map(skill => (
              <div key={skill.name} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-lg flex-shrink-0">📦</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800">{skill.name}</p>
                        {skill.hasExtra && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{t('custom.hasAttachments')}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{skill.description || t('custom.noDescription')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handlePreviewSkill(skill.name)}
                      className="px-2 py-1 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 rounded hover:border-blue-300 transition-colors"
                      title={t('custom.preview')}
                    >
                      {previewSkill?.name === skill.name ? t('custom.collapse') : t('custom.preview')}
                    </button>
                    <button
                      onClick={() => handleRemoveSkill(skill.name)}
                      disabled={removingSkill === skill.name}
                      className={`px-2 py-1 text-xs rounded transition-colors ${
                        removingSkill === skill.name
                          ? 'text-gray-400 border border-gray-200 cursor-wait'
                          : 'text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 hover:bg-red-50'
                      }`}
                      title={t('custom.delete')}
                    >
                      {removingSkill === skill.name ? t('custom.deleting') : t('custom.delete')}
                    </button>
                  </div>
                </div>

                {/* SKILL.md 预览 */}
                {previewSkill?.name === skill.name && (
                  <div className="mt-3 ml-8">
                    <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-gray-700">
                      {previewSkill.content}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold text-gray-800">{t('title')}</h1>
        <button
          onClick={() => {
            if (activeTab === 'builtin') {
              setLoading(true); loadSkills()
            } else {
              loadCustomSkills()
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 hover:text-blue-600 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
          title={t('actions.refresh')}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {t('actions.refresh')}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">{t('subtitle')}</p>

      {/* Tab 切换 */}
      <div className="flex border-b border-gray-200 mb-4">
        <button
          onClick={() => setActiveTab('builtin')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'builtin'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {t('tabs.builtin')}
        </button>
        <button
          onClick={() => setActiveTab('custom')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'custom'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {t('tabs.custom')}
          {customSkills.length > 0 && (
            <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
              {customSkills.length}
            </span>
          )}
        </button>
      </div>

      {/* 内置技能 Tab */}
      {activeTab === 'builtin' && (
        <>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
              <span className="text-sm text-red-700">{error}</span>
              <button
                onClick={() => { setLoading(true); loadSkills() }}
                className="text-sm text-red-600 hover:text-red-800 underline ml-4"
              >
                {t('actions.retry')}
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-500 text-sm">{t('loading')}</span>
            </div>
          ) : skills.length === 0 && !error ? (
            <div className="text-center py-16 text-gray-400 text-sm">{t('empty')}</div>
          ) : (
            <>
              {availableSkills.length > 0 && (
                <div className="mb-4">
                  <h2 className="text-sm font-medium text-gray-600 mb-2">{t('categories.available')} ({availableSkills.length})</h2>
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {availableSkills.map(s => renderSkillRow(s, 'available'))}
                  </div>
                </div>
              )}

              {needsCredsSkills.length > 0 && (
                <div className="mb-4">
                  <h2 className="text-sm font-medium text-gray-600 mb-2">{t('categories.needsApiKey')} ({needsCredsSkills.length})</h2>
                  <div className="bg-white rounded-lg border border-amber-200 divide-y divide-gray-100">
                    {needsCredsSkills.map(s => renderSkillRow(s, 'needs-credentials'))}
                  </div>
                </div>
              )}

              {needsToolsSkills.length > 0 && (
                <div className="mb-4">
                  <h2 className="text-sm font-medium text-gray-600 mb-2">{t('categories.needsDeps')} ({needsToolsSkills.length})</h2>
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {needsToolsSkills.map(s => renderSkillRow(s, 'needs-tools'))}
                  </div>
                </div>
              )}

              {needsConfigSkills.length > 0 && (
                <div className="mb-4">
                  <h2 className="text-sm font-medium text-gray-600 mb-2">{t('categories.needsConfig')} ({needsConfigSkills.length})</h2>
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                    {needsConfigSkills.map(s => renderSkillRow(s, 'needs-config'))}
                  </div>
                </div>
              )}

              {macosOnlySkills.length > 0 && (
                <div className="mb-4">
                  <h2 className="text-sm font-medium text-gray-500 mb-2">{t('categories.macosOnly')} ({macosOnlySkills.length})</h2>
                  <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 opacity-60">
                    {macosOnlySkills.map(s => renderSkillRow(s, 'macos-only'))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* 自定义技能 Tab */}
      {activeTab === 'custom' && renderCustomSkillsTab()}
    </div>
  )
}
