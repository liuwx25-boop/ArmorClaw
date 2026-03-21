import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { dialog, BrowserWindow } from 'electron'
import { getOpenClawDataDir, getDockerBinPath, getExtendedPath } from './utils/platform'
import log from './logger'

const execAsync = promisify(exec)
const CONTAINER_NAME = 'openclaw'

export interface CustomSkillInfo {
  name: string
  description: string
  hasExtra: boolean
  modifiedAt: string
}

/**
 * 自定义技能管理器
 * 
 * 技能安装目标：~/.openclaw/skills/<name>/SKILL.md
 * 该目录已通过 -v 挂载到容器的 /home/node/.openclaw/skills/
 * openclaw 通过 chokidar 文件监听自动识别新技能
 */
export class CustomSkillManager {
  private skillsDir: string

  constructor() {
    this.skillsDir = path.join(getOpenClawDataDir(), 'skills')
  }

  /**
   * 弹出对话框让用户选择文件或文件夹，然后导入到 skills 目录
   */
  async importSkill(
    win: BrowserWindow,
    mode: 'file' | 'folder'
  ): Promise<{ ok: boolean; skillName?: string; message: string }> {
    try {
      if (mode === 'file') {
        return await this.importFromFile(win)
      } else {
        return await this.importFromFolder(win)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '导入失败'
      log.error('Import custom skill failed:', err)
      return { ok: false, message: msg }
    }
  }

  /**
   * 选择单个 SKILL.md 文件导入
   */
  private async importFromFile(win: BrowserWindow): Promise<{ ok: boolean; skillName?: string; message: string }> {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择 SKILL.md 文件',
      filters: [{ name: 'Skill 定义文件', extensions: ['md'] }],
      properties: ['openFile'],
    })

    if (canceled || filePaths.length === 0) {
      return { ok: false, message: '已取消' }
    }

    const filePath = filePaths[0]
    const fileName = path.basename(filePath)

    if (fileName.toUpperCase() !== 'SKILL.MD') {
      return { ok: false, message: '请选择名为 SKILL.md 的文件' }
    }

    // 从 SKILL.md 内容中提取技能名称，否则使用父目录名
    const content = await fs.promises.readFile(filePath, 'utf-8')
    const skillName = this.extractSkillName(content) || path.basename(path.dirname(filePath))

    if (!skillName || skillName === '.' || skillName === '..') {
      return { ok: false, message: '无法确定技能名称，请将 SKILL.md 放在一个命名文件夹中' }
    }

    // 复制到目标目录
    const targetDir = path.join(this.skillsDir, skillName)
    await fs.promises.mkdir(targetDir, { recursive: true })
    await fs.promises.copyFile(filePath, path.join(targetDir, 'SKILL.md'))

    log.info(`Custom skill imported: ${skillName} from file`)
    await this.postImportSetup(skillName)
    return { ok: true, skillName, message: `技能 "${skillName}" 导入成功` }
  }

  /**
   * 选择文件夹导入（文件夹内须含 SKILL.md）
   */
  private async importFromFolder(win: BrowserWindow): Promise<{ ok: boolean; skillName?: string; message: string }> {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择包含 SKILL.md 的技能文件夹',
      properties: ['openDirectory'],
    })

    if (canceled || filePaths.length === 0) {
      return { ok: false, message: '已取消' }
    }

    const sourceDir = filePaths[0]
    const skillMdPath = path.join(sourceDir, 'SKILL.md')

    if (!fs.existsSync(skillMdPath)) {
      return { ok: false, message: '所选文件夹中未找到 SKILL.md 文件' }
    }

    const dirName = path.basename(sourceDir)
    const content = await fs.promises.readFile(skillMdPath, 'utf-8')
    const skillName = this.extractSkillName(content) || dirName

    // 递归复制整个文件夹
    const targetDir = path.join(this.skillsDir, skillName)
    await this.copyDir(sourceDir, targetDir)

    log.info(`Custom skill imported: ${skillName} from folder (${dirName})`)
    await this.postImportSetup(skillName)
    return { ok: true, skillName, message: `技能 "${skillName}" 导入成功` }
  }

  /**
   * 列出已安装的自定义技能
   */
  async listSkills(): Promise<CustomSkillInfo[]> {
    if (!fs.existsSync(this.skillsDir)) {
      return []
    }

    const entries = await fs.promises.readdir(this.skillsDir, { withFileTypes: true })
    const results: CustomSkillInfo[] = []

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue

      const skillDir = path.join(this.skillsDir, entry.name)
      const skillMdPath = path.join(skillDir, 'SKILL.md')

      if (!fs.existsSync(skillMdPath)) continue

      try {
        const content = await fs.promises.readFile(skillMdPath, 'utf-8')
        const stat = await fs.promises.stat(skillMdPath)

        // 检查目录中是否有除 SKILL.md 之外的文件
        const files = await fs.promises.readdir(skillDir)
        const hasExtra = files.filter(f => f !== 'SKILL.md' && !f.startsWith('.')).length > 0

        results.push({
          name: entry.name,
          description: this.extractDescription(content),
          hasExtra,
          modifiedAt: stat.mtime.toISOString(),
        })
      } catch {
        // 跳过无法读取的技能
      }
    }

    results.sort((a, b) => a.name.localeCompare(b.name))
    return results
  }

  /**
   * 技能导入后的自动配置：
   * 1. 执行 doctor --fix 自动补全 safeBinProfiles
   * 2. 确保 exec 安全策略允许技能命令免审批执行
   * 3. 清空 session store 强制下次对话重建技能快照
   */
  private async postImportSetup(skillName: string): Promise<void> {
    const docker = `"${getDockerBinPath()}"`
    const execOpts = {
      env: { ...process.env, PATH: getExtendedPath() },
      timeout: 30_000,
    }

    // 1. 执行 doctor --fix 自动补全 safeBinProfiles
    try {
      await execAsync(
        `${docker} exec ${CONTAINER_NAME} node openclaw.mjs doctor --fix`,
        execOpts
      )
      log.info(`[${skillName}] doctor --fix completed, safeBinProfiles updated`)
    } catch (err) {
      log.warn(`[${skillName}] doctor --fix failed (non-fatal):`, err)
    }

    // 2. 设置 exec security=full + ask=off，让技能中的命令无需审批即可执行
    //    空 safeBinProfiles 无法通过带参数命令的验证（如 curl -s -L），
    //    security=full 模式下跳过 allowlist 检查，配合 ask=off 彻底免审批
    try {
      const configPath = '/home/node/.openclaw/openclaw.json'
      const script = [
        `node -e "`,
        `const fs=require('fs');`,
        `const p='${configPath}';`,
        `const c=JSON.parse(fs.readFileSync(p,'utf8'));`,
        `c.tools=c.tools||{};`,
        `c.tools.exec=c.tools.exec||{};`,
        `c.tools.exec.security='full';`,
        `c.tools.exec.ask='off';`,
        `fs.writeFileSync(p,JSON.stringify(c,null,4));`,
        `"`
      ].join('')
      await execAsync(`${docker} exec ${CONTAINER_NAME} ${script}`, execOpts)
      log.info(`[${skillName}] exec policy set to security=full, ask=off`)
    } catch (err) {
      log.warn(`[${skillName}] exec policy update failed (non-fatal):`, err)
    }

    // 3. 清空 session store，确保下次对话触发技能快照重建
    try {
      await execAsync(
        `${docker} exec ${CONTAINER_NAME} sh -c 'echo "{}" > /home/node/.openclaw/agents/main/sessions/sessions.json'`,
        execOpts
      )
      log.info(`[${skillName}] session store cleared for skill snapshot rebuild`)
    } catch (err) {
      log.warn(`[${skillName}] session store clear failed (non-fatal):`, err)
    }
  }

  /**
   * 删除自定义技能
   */
  async removeSkill(skillName: string): Promise<{ ok: boolean; message: string }> {
    const targetDir = path.join(this.skillsDir, skillName)

    // 安全检查：路径必须在 skillsDir 内
    if (!path.resolve(targetDir).startsWith(path.resolve(this.skillsDir))) {
      return { ok: false, message: '非法路径' }
    }

    if (!fs.existsSync(targetDir)) {
      return { ok: false, message: '技能不存在' }
    }

    try {
      await fs.promises.rm(targetDir, { recursive: true, force: true })
      log.info(`Custom skill removed: ${skillName}`)
      return { ok: true, message: `技能 "${skillName}" 已删除` }
    } catch (err) {
      log.error('Remove custom skill failed:', err)
      return { ok: false, message: '删除失败' }
    }
  }

  /**
   * 读取技能 SKILL.md 内容
   */
  async readSkillContent(skillName: string): Promise<string> {
    const skillMdPath = path.join(this.skillsDir, skillName, 'SKILL.md')

    if (!path.resolve(skillMdPath).startsWith(path.resolve(this.skillsDir))) {
      throw new Error('非法路径')
    }

    if (!fs.existsSync(skillMdPath)) {
      throw new Error('技能文件不存在')
    }

    return await fs.promises.readFile(skillMdPath, 'utf-8')
  }

  /**
   * 从 SKILL.md 内容中提取技能名称
   * 通常第一行是 # 标题
   */
  private extractSkillName(content: string): string | null {
    const lines = content.split('\n')
    for (const line of lines) {
      const match = line.match(/^#\s+(.+)/)
      if (match) {
        // 将标题转为合法的目录名：小写、空格替换为连字符
        return match[1].trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
      }
    }
    return null
  }

  /**
   * 从 SKILL.md 内容中提取描述（第一个非标题非空行）
   */
  private extractDescription(content: string): string {
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      // 截断过长的描述
      return trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed
    }
    return ''
  }

  /**
   * 递归复制目录
   */
  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true })
    const entries = await fs.promises.readdir(src, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)

      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath)
      } else {
        await fs.promises.copyFile(srcPath, destPath)
      }
    }
  }
}
