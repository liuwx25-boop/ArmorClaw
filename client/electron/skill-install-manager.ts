import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import https from 'https'
import http from 'http'
import { getExtendedPath, getDockerBinPath } from './utils/platform'

const execAsync = promisify(exec)

const PATH_ENV = getExtendedPath()
const CONTAINER_NAME = 'openclaw'
const DEFAULT_TIMEOUT = 300_000 // 5 minutes

const execOptions = {
  env: { ...process.env, PATH: PATH_ENV },
  timeout: 10_000,
}

// ============ Types ============

export interface SkillInstallOption {
  id: string
  kind: string
  label: string
  bins: string[]
  package?: string
  formula?: string
  module?: string
  url?: string
  os?: string[]
}

export interface SkillInstallParams {
  skillName: string
  installId: string
  installSpec: SkillInstallOption
  homepage?: string
  timeoutMs?: number
}

export interface SkillInstallResult {
  ok: boolean
  message: string
  stdout: string
  stderr: string
  code: number | null
}

// ============ Brew → APT 安装脚本映射 ============
// 用于 Docker 容器内将 brew 包自动转为 Debian apt 安装。
// key: brew formula 名 或 bin 名，value: 完整的 shell 安装脚本。
// 仅收录需要第三方 apt 源的包；默认 apt 源有的包无需在此列出。

const BREW_APT_RECIPES: Record<string, string> = {
  // 1Password CLI (brew formula: 1password-cli, bin: op)
  'op': [
    'curl -sS https://downloads.1password.com/linux/keys/1password.asc | gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg',
    'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" > /etc/apt/sources.list.d/1password.list',
    'apt-get update -qq && apt-get install -y 1password-cli',
  ].join(' && '),
  '1password-cli': [
    'curl -sS https://downloads.1password.com/linux/keys/1password.asc | gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg',
    'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" > /etc/apt/sources.list.d/1password.list',
    'apt-get update -qq && apt-get install -y 1password-cli',
  ].join(' && '),

  // GitHub CLI (brew formula: gh, bin: gh)
  'gh': [
    'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg',
    'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list',
    'apt-get update -qq && apt-get install -y gh',
  ].join(' && '),

  // spogo (brew tap: steipete/tap, bin: spogo) — 从 GitHub releases 下载预编译二进制
  'spogo': [
    'arch=$(uname -m)',
    'goarch=$([ "$arch" = "aarch64" ] && echo arm64 || echo amd64)',
    'curl -fsSL "https://github.com/steipete/spogo/releases/download/v0.1.0/spogo_0.1.0_linux_${goarch}.tar.gz" | tar -xz -C /tmp',
    'mv /tmp/spogo /usr/local/bin/spogo',
    'chmod +x /usr/local/bin/spogo',
  ].join(' && '),

  // spotify_player (brew formula: spotify_player, bin: spotify_player) — 从 GitHub releases 下载预编译二进制
  'spotify_player': [
    'SPOT_VER="v0.22.1"',
    'arch=$(uname -m)',
    'spotarch=$([ "$arch" = "aarch64" ] && echo aarch64 || echo x86_64)',
    'curl -fsSL "https://github.com/aome510/spotify-player/releases/download/${SPOT_VER}/spotify_player_${spotarch}-unknown-linux-gnu.tar.gz" -o /tmp/spotify_player.tar.gz',
    'tar -xzf /tmp/spotify_player.tar.gz -C /tmp',
    'mv /tmp/spotify_player /usr/local/bin/spotify_player',
    'chmod +x /usr/local/bin/spotify_player',
    'rm -f /tmp/spotify_player.tar.gz',
  ].join(' && '),
}

// ============ Brew → NPM 包名映射 ============
// 部分 brew formula 在 npm 中有不同的包名，需要手动映射。
// key: brew formula 名或 bins[0]，value: 正确的 npm 包名。

const BREW_NPM_MAP: Record<string, string> = {
  'gemini-cli': '@google/gemini-cli',
  'gemini': '@google/gemini-cli',
}

const GO_VERSION = '1.23.6'

// Docker 容器内自动安装 Go 的内联脚本
const GO_AUTO_INSTALL_SCRIPT = [
  'arch=$(uname -m)',
  'goarch=$([ "$arch" = "aarch64" ] && echo arm64 || echo amd64)',
  `curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-\${goarch}.tar.gz" | tar -C /usr/local -xz`,
  'ln -sf /usr/local/go/bin/go /usr/local/bin/go',
  'ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt',
  'go env -w GOPROXY=https://goproxy.cn,direct',
].join(' && ')

// ============ SkillInstallManager ============

export class SkillInstallManager {
  /**
   * Resolve a URL by following redirects to find the final GitHub URL.
   * Returns the final URL or the original if resolution fails.
   */
  private resolveHomepage(url: string): Promise<string> {
    return new Promise((resolve) => {
      if (!url || url.includes('github.com')) {
        resolve(url)
        return
      }
      const client = url.startsWith('https') ? https : http
      const req = client.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
        const location = res.headers.location
        if (location && location.includes('github.com')) {
          resolve(location)
        } else {
          resolve(url)
        }
      })
      req.on('error', () => resolve(url))
      req.on('timeout', () => { req.destroy(); resolve(url) })
      req.end()
    })
  }
  /**
   * Detect whether OpenClaw is running in Docker or Sandbox mode.
   */
  async detectRunMode(): Promise<'docker' | 'sandbox'> {
    try {
      const { stdout } = await execAsync(
        `"${getDockerBinPath()}" ps --filter "name=^${CONTAINER_NAME}$" --filter status=running --format "{{.Names}}"`,
        execOptions
      )
      return stdout.trim() === CONTAINER_NAME ? 'docker' : 'sandbox'
    } catch {
      return 'sandbox'
    }
  }

  /**
   * Build the command argv for the given install spec and run mode.
   * Returns null with an error message if the kind is unsupported in this mode.
   */
  async buildCommand(
    spec: SkillInstallOption,
    mode: 'docker' | 'sandbox',
    params?: SkillInstallParams
  ): Promise<{ argv: string[] } | { error: string }> {
    const baseCmd = await this.buildBaseCommand(spec, mode, params)
    if ('error' in baseCmd) return baseCmd

    if (mode === 'docker') {
      return {
        argv: ['docker', 'exec', '-u', 'root', CONTAINER_NAME, ...baseCmd.argv],
      }
    }
    return baseCmd
  }

  private async buildBaseCommand(
    spec: SkillInstallOption,
    mode: 'docker' | 'sandbox',
    params?: SkillInstallParams
  ): Promise<{ argv: string[] } | { error: string }> {
    switch (spec.kind) {
      case 'node': {
        const pkg = spec.package || spec.bins?.[0]
        if (!pkg) return { error: '缺少 package 名称' }
        return { argv: ['npm', 'install', '-g', '--force', pkg] }
      }

      case 'go': {
        // module > package > 从 homepage 推导 (github.com/user/repo)
        let mod = spec.module || spec.package
        if (!mod && params?.homepage) {
          // 如果 homepage 不是 GitHub URL，尝试解析重定向
          const resolvedUrl = await this.resolveHomepage(params.homepage)
          const m = resolvedUrl.match(/github\.com\/[^/]+\/[^/]+/)
          if (m) {
            const repo = m[0].replace(/\/$/, '')
            const bin = spec.bins?.[0]
            // 大多数 Go CLI 工具的 main 包在 cmd/<bin>/ 子目录
            if (bin) {
              mod = `${repo}/cmd/${bin}@latest`
            } else {
              mod = `${repo}@latest`
            }
          }
        }
        if (!mod) return { error: '缺少 Go module 路径' }
        if (!mod.includes('@')) mod += '@latest'
        if (mode === 'docker') {
          const envSetup = 'export GOPROXY=https://goproxy.cn,direct && export GOPATH=/home/node/go && export PATH=$GOPATH/bin:/usr/local/go/bin:$PATH'
          // 安装后将 GOPATH/bin 下的新二进制 symlink 到 /usr/local/bin，确保默认 PATH 可见
          const bins = (spec.bins || []).map(b => `ln -sf /home/node/go/bin/${b} /usr/local/bin/${b} 2>/dev/null`).join('; ')
          const symlinkStep = bins || 'for f in /home/node/go/bin/*; do ln -sf "$f" /usr/local/bin/ 2>/dev/null; done'
          // 先尝试 cmd/<bin> 子路径，失败则回退到仓库根路径
          if (mod.includes('/cmd/')) {
            const rootMod = mod.replace(/\/cmd\/[^@]+/, '')
            return { argv: ['sh', '-c', `${envSetup} && (go install ${mod} 2>/dev/null || go install ${rootMod}) && ${symlinkStep}`] }
          }
          return { argv: ['sh', '-c', `${envSetup} && go install ${mod} && ${symlinkStep}`] }
        }
        return { argv: ['go', 'install', mod] }
      }

      case 'uv': {
        const pkg = spec.package || spec.bins?.[0]
        if (!pkg) return { error: '缺少 uv 包名' }
        if (mode === 'docker') {
          // uv tool install 默认装到 /root/.local/bin，需 symlink 到 /usr/local/bin
          const bins = (spec.bins || []).map(b => `ln -sf /root/.local/bin/${b} /usr/local/bin/${b} 2>/dev/null`).join('; ')
          const symlinkStep = bins || `for f in /root/.local/bin/*; do ln -sf "$f" /usr/local/bin/ 2>/dev/null; done`
          return { argv: ['sh', '-c', `uv tool install ${pkg} && ${symlinkStep}`] }
        }
        return { argv: ['uv', 'tool', 'install', pkg] }
      }

      case 'brew': {
        const formula = spec.formula || spec.package || spec.bins?.[0]
        if (!formula) return { error: '缺少 brew formula' }
        if (mode === 'docker') {
          // 优先查找已知的第三方源安装脚本（需要特殊 apt 源的包）
          const recipe = BREW_APT_RECIPES[formula]
          if (recipe) {
            return { argv: ['sh', '-c', recipe] }
          }

          const binName = spec.bins?.[0] || formula.split('/').pop() || formula
          // 查找 npm 映射：formula → 正确 npm 包名，或 bins[0] → 正确 npm 包名
          const npmPkg = BREW_NPM_MAP[formula] || BREW_NPM_MAP[binName]

          // 尝试从 homepage 推导 Go module 安装路径
          let goFallback = ''
          if (params?.homepage) {
            const resolvedUrl = await this.resolveHomepage(params.homepage)
            const m = resolvedUrl.match(/github\.com\/[^/]+\/[^/]+/)
            if (m) {
              const repo = m[0].replace(/\/$/, '')
              const bin = spec.bins?.[0]
              const goMod = bin ? `${repo}/cmd/${bin}@latest` : `${repo}@latest`
              const envSetup = 'export GOPROXY=https://goproxy.cn,direct && export GOPATH=/home/node/go && export PATH=$GOPATH/bin:/usr/local/go/bin:$PATH'
              const symlinkStep = bin
                ? `ln -sf /home/node/go/bin/${bin} /usr/local/bin/${bin} 2>/dev/null`
                : 'for f in /home/node/go/bin/*; do ln -sf "$f" /usr/local/bin/ 2>/dev/null; done'
              const goInstall = bin
                ? `(go install ${goMod} 2>/dev/null || go install ${repo.replace(/\/cmd\/[^@]+/, '')}@latest) && ${symlinkStep}`
                : `go install ${goMod} && ${symlinkStep}`
              goFallback = ` || (${envSetup} && ${goInstall})`
            }
          }

          // 构建降级链: apt-get → npm (仅当有映射时) → go install (如果有)
          const fallbackSteps: string[] = []
          // 第一步: 尝试 apt-get
          fallbackSteps.push(`apt-get update -qq && apt-get install -y ${binName} 2>/dev/null`)
          // 第二步: 仅当有 npm 映射时才尝试 npm（避免盲目 npm install 不存在的包）
          if (npmPkg) {
            fallbackSteps.push(`npm install -g --force ${npmPkg} 2>/dev/null`)
          }

          if (goFallback) {
            // go install 已经包含了 || 前缀，去掉
            const goCmd = goFallback.replace(/^ \|\| /, '')
            fallbackSteps.push(goCmd)
          }

          if (fallbackSteps.length === 1 && !npmPkg && !goFallback) {
            // 只有 apt-get，没有其他降级方式，大概率会失败
            // 返回 apt-get 尝试，但失败时给出有用的提示
            return {
              argv: ['sh', '-c', `${fallbackSteps[0]} || (echo "\\n[ERROR] Homebrew (brew) 不适用于当前容器环境，且无法通过 apt/npm 自动安装 ${binName}。请打开终端手动安装。" && exit 1)`],
            }
          }

          return {
            argv: ['sh', '-c', fallbackSteps.join(' || ')],
          }
        }
        return { argv: ['brew', 'install', formula] }
      }

      case 'download': {
        if (!spec.url) return { error: '缺少下载 URL' }
        // Download kind: curl + install to /usr/local/bin
        const binName = spec.bins?.[0] || 'tool'
        const targetPath = `/usr/local/bin/${binName}`
        return {
          argv: ['sh', '-c', `curl -fsSL "${spec.url}" -o "${targetPath}" && chmod +x "${targetPath}"`],
        }
      }

      default:
        return { error: `不支持的安装类型: ${spec.kind}` }
    }
  }

  /**
   * Execute a command with timeout, collecting stdout/stderr.
   */
  private executeCommand(
    argv: string[],
    timeoutMs: number
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let killed = false

      const proc = spawn(argv[0], argv.slice(1), {
        env: { ...process.env, PATH: PATH_ENV },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
        // Cap output at 64KB to avoid memory issues
        if (stdout.length > 65536) {
          stdout = stdout.slice(-65536)
        }
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
        if (stderr.length > 65536) {
          stderr = stderr.slice(-65536)
        }
      })

      const timer = setTimeout(() => {
        killed = true
        proc.kill('SIGTERM')
        setTimeout(() => proc.kill('SIGKILL'), 5000)
      }, timeoutMs)

      proc.on('close', (code) => {
        clearTimeout(timer)
        if (killed) {
          resolve({ code: null, stdout, stderr: stderr + '\n安装超时，已终止进程。' })
        } else {
          resolve({ code, stdout, stderr })
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        resolve({ code: null, stdout, stderr: err.message })
      })
    })
  }

  /**
   * Main entry: detect mode → build command → execute → return result.
   */
  async install(params: SkillInstallParams): Promise<SkillInstallResult> {
    const { installSpec: spec, timeoutMs = DEFAULT_TIMEOUT } = params

    if (!spec) {
      return {
        ok: false,
        message: '安装配置信息缺失',
        stdout: '',
        stderr: '',
        code: null,
      }
    }

    const mode = await this.detectRunMode()
    const cmd = await this.buildCommand(spec, mode, params)

    if ('error' in cmd) {
      return {
        ok: false,
        message: cmd.error,
        stdout: '',
        stderr: '',
        code: null,
      }
    }

    const { code, stdout, stderr } = await this.executeCommand(cmd.argv, timeoutMs)
    const ok = code === 0

    let message: string
    if (ok) {
      message = `${params.skillName} 安装成功`
    } else if (code === null) {
      message = stderr.includes('超时') ? '安装超时' : '安装失败'
    } else {
      message = this.formatErrorMessage(stderr, code)
    }

    return { ok, message, stdout, stderr, code }
  }

  private formatErrorMessage(stderr: string, code: number): string {
    const lower = stderr.toLowerCase()
    if (lower.includes('unable to locate package')) {
      return 'apt 源中未找到该包，需手动安装或添加第三方源'
    }
    if (lower.includes('eacces') || lower.includes('permission denied')) {
      return '权限不足，安装失败'
    }
    if (lower.includes('etimedout') || lower.includes('network')) {
      return '网络超时，请检查网络连接'
    }
    if (lower.includes('not found') || lower.includes('command not found')) {
      return '缺少前置工具，请先安装相关依赖'
    }
    return `安装失败 (exit ${code})`
  }
}
