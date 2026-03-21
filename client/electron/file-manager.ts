import * as fs from 'fs'
import * as path from 'path'
import { shell, dialog, BrowserWindow } from 'electron'
import { getOpenClawDataDir } from './utils/platform'
import log from './logger'

export interface FileEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: string
}

/**
 * 文件管理器 — 提供对 ~/.openclaw 目录的只读浏览和下载能力
 */
export class FileManager {
  /** 根目录：用户的 OpenClaw 数据目录 */
  private rootDir: string

  /** 根目录下仅展示给用户的白名单目录 */
  private static ROOT_VISIBLE_DIRS = new Set([
    'workspace',
    'media',
    'sandboxes',
  ])

  /** workspace 目录下需要隐藏的 openclaw 系统文件和目录 */
  private static WORKSPACE_HIDDEN = new Set([
    'AGENTS.md',
    'SOUL.md',
    'TOOLS.md',
    'IDENTITY.md',
    'USER.md',
    'HEARTBEAT.md',
    'BOOTSTRAP.md',
    'MEMORY.md',
    'memory',
    'skills',
    'canvas',
  ])

  constructor() {
    this.rootDir = getOpenClawDataDir()
  }

  /** 获取根目录路径 */
  getRootDir(): string {
    return this.rootDir
  }

  /**
   * 列出指定目录下的文件和文件夹
   * @param relativePath 相对于 rootDir 的路径，空字符串表示根目录
   */
  async listDirectory(relativePath: string): Promise<FileEntry[]> {
    const targetDir = this.resolveSafePath(relativePath)
    if (!targetDir) {
      throw new Error('非法路径')
    }

    try {
      const entries = await fs.promises.readdir(targetDir, { withFileTypes: true })
      const result: FileEntry[] = []

      // 判断是否在根目录
      const isRoot = path.resolve(targetDir) === path.resolve(this.rootDir)
      // 判断是否在 workspace 目录
      const isWorkspace = path.resolve(targetDir) === path.resolve(path.join(this.rootDir, 'workspace'))

      for (const entry of entries) {
        // 跳过隐藏文件
        if (entry.name.startsWith('.')) {
          continue
        }
        // 根目录下只展示白名单中的用户目录
        if (isRoot && !FileManager.ROOT_VISIBLE_DIRS.has(entry.name)) {
          continue
        }
        // workspace 目录下隐藏 openclaw 系统文件
        if (isWorkspace && FileManager.WORKSPACE_HIDDEN.has(entry.name)) {
          continue
        }
        try {
          const fullPath = path.join(targetDir, entry.name)
          const stat = await fs.promises.stat(fullPath)
          result.push({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size: entry.isDirectory() ? 0 : stat.size,
            modifiedAt: stat.mtime.toISOString(),
          })
        } catch {
          // 跳过无法读取的文件
        }
      }

      // 排序：文件夹在前，同类按名称排序
      result.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return result
    } catch (err) {
      log.error('listDirectory failed:', err)
      throw new Error('无法读取目录')
    }
  }

  /**
   * 另存为：将文件复制到用户选择的位置
   * @param relativePath 相对于 rootDir 的文件路径
   * @param win 当前 BrowserWindow（用于显示对话框）
   */
  async saveFileAs(relativePath: string, win: BrowserWindow): Promise<boolean> {
    const sourcePath = this.resolveSafePath(relativePath)
    if (!sourcePath) {
      throw new Error('非法路径')
    }

    const stat = await fs.promises.stat(sourcePath)
    if (stat.isDirectory()) {
      throw new Error('不支持保存文件夹，请选择具体文件')
    }

    const fileName = path.basename(sourcePath)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '另存为',
      defaultPath: fileName,
    })

    if (canceled || !filePath) return false

    try {
      await fs.promises.copyFile(sourcePath, filePath)
      return true
    } catch (err) {
      log.error('saveFileAs failed:', err)
      throw new Error('文件保存失败')
    }
  }

  /**
   * 在系统文件管理器中打开（Finder / 资源管理器）
   * @param relativePath 相对于 rootDir 的路径
   */
  async openInSystem(relativePath: string): Promise<void> {
    const targetPath = this.resolveSafePath(relativePath)
    if (!targetPath) {
      throw new Error('非法路径')
    }

    const stat = await fs.promises.stat(targetPath)
    if (stat.isDirectory()) {
      await shell.openPath(targetPath)
    } else {
      shell.showItemInFolder(targetPath)
    }
  }

  /**
   * 安全路径解析：确保解析后的路径仍在 rootDir 内，防止路径穿越
   */
  private resolveSafePath(relativePath: string): string | null {
    // 清理输入
    const cleaned = (relativePath || '').replace(/\.\./g, '')
    const resolved = path.resolve(this.rootDir, cleaned)

    // 确保不超出根目录
    if (!resolved.startsWith(this.rootDir)) {
      return null
    }

    if (!fs.existsSync(resolved)) {
      return null
    }

    return resolved
  }
}
