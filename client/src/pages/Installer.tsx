import { useThemeStore } from '@/stores/themeStore'
import { getLogoByTheme } from '@/config/logo'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDockerStore } from '@/stores/dockerStore'

const HOMEBREW_INSTALL_CMD = '/bin/bash -c "$(curl -fsSL https://gitee.com/cunkai/HomebrewCN/raw/master/Homebrew.sh)"'
const HOMEBREW_INSTALL_STEPS = [
  '1. 打开「终端」（按 Command+空格，输入 Terminal）',
  '2. 粘贴下方命令并回车执行',
  '3. 脚本会提示选择下载源，输入 2（Gitee）后回车',
  '4. 按提示完成安装，结束后关闭终端重新打开',
  '5. 回到 ArmorClaw 点击「重新检测」'
]

const IMAGE_EXPORT_CMD = 'docker save armorclaw:full | gzip > armorclaw.tar.gz'
const IMAGE_LOAD_CMD = 'docker load -i armorclaw.tar.gz'

export default function Installer() {
  const navigate = useNavigate()
  const theme = useThemeStore((s) => s.theme)
  const logo = getLogoByTheme(theme)
  const { 
    platform,
    dockerDesktopInstalled,
    colimaInstalled,
    wsl2Installed,
    dockerRunning,
    containerRunning,
    isInstalling,
    installProgress,
    error,
    installDocker,
    checkStatus
  } = useDockerStore()
  const [copied, setCopied] = useState(false)

  const dockerInstalled = dockerDesktopInstalled || colimaInstalled || (platform === 'windows' && wsl2Installed)
  const isHomebrewError = error?.includes('Homebrew') || error?.includes('brew.sh')
  const isImageError = error?.includes('镜像') || error?.includes('image')
  const needsManualAction = isHomebrewError || isImageError

  // Auto-navigate to dashboard when container is running
  useEffect(() => {
    if (containerRunning && !isInstalling) {
      navigate('/app', { replace: true })
    }
  }, [containerRunning, isInstalling, navigate])

  const getStatusIcon = (ok: boolean) => ok ? '✅' : '❌'

  const copyCommand = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-gray-50 to-gray-100">
      {/* Drag region — only needed for macOS hiddenInset titlebar */}
      {platform === 'macos' && <div className="drag-region h-8 flex-shrink-0" />}
      
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <img src={logo} alt="ArmorClaw" className="w-20 h-20 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-800">ArmorClaw</h1>
            <p className="text-gray-500 mt-2">AI 智能助手</p>
          </div>

          {/* Status Card */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-4">环境检测</h2>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-600">操作系统</span>
                <span className="text-gray-800 font-medium">
                  {platform === 'macos' ? 'macOS' : platform === 'windows' ? 'Windows' : platform}
                </span>
              </div>
              
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-gray-600">Docker 环境</span>
                <span>{getStatusIcon(dockerInstalled)} {dockerInstalled ? '已安装' : '未安装'}</span>
              </div>
              
              <div className="flex justify-between items-center py-2">
                <span className="text-gray-600">Docker 运行状态</span>
                <span>{getStatusIcon(dockerRunning)} {dockerRunning ? '运行中' : '未运行'}</span>
              </div>
            </div>
          </div>

          {/* Progress */}
          {isInstalling && installProgress && (
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600">{installProgress.message}</span>
                <span className="text-blue-600 font-medium">{installProgress.progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${installProgress.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <p className="text-red-600 text-sm">{error}</p>
              {/* Homebrew 未安装时的引导 */}
              {isHomebrewError && platform === 'macos' && (
                <div className="mt-3 pt-3 border-t border-red-200">
                  <p className="text-gray-700 text-sm font-medium mb-2">请先安装 Homebrew（国内镜像，无需翻墙）：</p>
                  <div className="relative">
                    <pre className="bg-gray-800 text-green-400 text-xs p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
                      {HOMEBREW_INSTALL_CMD}
                    </pre>
                    <button
                      onClick={() => copyCommand(HOMEBREW_INSTALL_CMD)}
                      className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                    >
                      {copied ? '已复制' : '复制'}
                    </button>
                  </div>
                  <ol className="text-gray-500 text-xs mt-3 space-y-1 list-none pl-0">
                    {HOMEBREW_INSTALL_STEPS.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
              {/* 镜像未找到时的引导 */}
              {isImageError && (
                <div className="mt-3 pt-3 border-t border-red-200">
                  <p className="text-gray-700 text-sm font-medium mb-2">请按以下步骤手动加载镜像：</p>
                  <p className="text-gray-500 text-xs mb-1">1. 在已有镜像的电脑上导出：</p>
                  <div className="relative mb-2">
                    <pre className="bg-gray-800 text-green-400 text-xs p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
                      {IMAGE_EXPORT_CMD}
                    </pre>
                    <button
                      onClick={() => copyCommand(IMAGE_EXPORT_CMD)}
                      className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                    >
                      {copied ? '已复制' : '复制'}
                    </button>
                  </div>
                  <p className="text-gray-500 text-xs mb-1">2. 将 armorclaw.tar.gz 拷贝到本机（U盘/网盘等）</p>
                  <p className="text-gray-500 text-xs mb-1">3. 在本机终端执行加载：</p>
                  <div className="relative">
                    <pre className="bg-gray-800 text-green-400 text-xs p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
                      {IMAGE_LOAD_CMD}
                    </pre>
                    <button
                      onClick={() => copyCommand(IMAGE_LOAD_CMD)}
                      className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                    >
                      {copied ? '已复制' : '复制'}
                    </button>
                  </div>
                  <p className="text-gray-500 text-xs mt-2">4. 加载完成后点击下方「重新安装」</p>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          {needsManualAction ? (
            <button
              onClick={isImageError ? installDocker : checkStatus}
              className="w-full py-3 px-6 rounded-xl font-medium text-white bg-green-600 hover:bg-green-700 active:scale-[0.98] transition-all"
            >
              {isImageError ? '重新安装' : '重新检测'}
            </button>
          ) : (
            <button
              onClick={installDocker}
              disabled={isInstalling}
              className={`w-full py-3 px-6 rounded-xl font-medium text-white transition-all
                ${isInstalling 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'
                }`}
            >
              {isInstalling ? '安装中...' : '开始安装'}
            </button>
          )}

          {/* Tips */}
          <p className="text-center text-gray-400 text-sm mt-6">
            {isImageError
              ? '加载镜像后点击「重新安装」继续'
              : isHomebrewError
                ? '安装 Homebrew 后重新检测即可继续'
                : !dockerInstalled 
                  ? '将自动安装 Docker 运行环境'
                  : dockerRunning
                    ? 'Docker 环境就绪，点击开始安装 ArmorClaw'
                    : '检测到 Docker 环境，将自动启动'
            }
          </p>
        </div>
      </div>
    </div>
  )
}
