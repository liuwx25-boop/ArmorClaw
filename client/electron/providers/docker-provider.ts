/**
 * Docker 环境管理的平台策略接口
 * 各平台实现此接口，docker-manager.ts 统一调用
 */
export interface InstallProgress {
  step: string
  progress: number
  message: string
}

export interface DockerProvider {
  /** Provider 名称（用于日志和状态展示） */
  readonly name: string

  /** 检测 Docker 运行时是否已安装 */
  checkInstalled(): Promise<boolean>

  /** 安装 Docker 环境，onProgress 报告安装进度 */
  install(onProgress: (progress: InstallProgress) => void): Promise<boolean>

  /** 启动 Docker 运行时 */
  start(): Promise<boolean>

  /** 检测 Docker 是否正在运行（daemon 可用） */
  isRunning(): Promise<boolean>

  /** 获取执行 Docker CLI 的命令前缀。WSL2 场景返回 'wsl -d Ubuntu docker'，其余返回 'docker' */
  getDockerCommand(): string
}
