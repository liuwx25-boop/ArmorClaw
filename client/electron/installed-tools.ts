/**
 * Installed Tools Manager
 *
 * Manages a persistent list of tools installed by skills, enabling automatic
 * reinstallation after container recreation. This provides a fallback when
 * docker commit is not available (e.g., user manually removes container,
 * Docker Desktop upgrade, Colima VM recreation).
 *
 * Storage location: ~/.openclaw/installed-tools.json (inside the volume)
 */

import * as fs from 'fs'
import * as path from 'path'
import { getOpenClawDataDir } from './utils/platform'

export type ToolKind = 'node' | 'go' | 'uv' | 'apt' | 'download'

export interface InstalledTool {
  /** Tool name for display and deduplication */
  name: string
  /** Installation method */
  kind: ToolKind
  /** Package name (npm package, go module, pip package, etc.) */
  package: string
  /** Optional version (if known) */
  version?: string
  /** Installation timestamp (ISO 8601) */
  installedAt: string
  /** Optional: binary paths installed by this tool */
  binaries?: string[]
}

export interface InstalledToolsManifest {
  /** Manifest version for future compatibility */
  version: number
  /** List of installed tools */
  tools: InstalledTool[]
  /** Last updated timestamp */
  updatedAt: string
}

const MANIFEST_VERSION = 1
const MANIFEST_FILE = 'installed-tools.json'

/**
 * Get the path to the installed tools manifest file.
 */
function getManifestPath(): string {
  const dataDir = getOpenClawDataDir()
  return path.join(dataDir, MANIFEST_FILE)
}

/**
 * Read the installed tools manifest from disk.
 * Returns an empty manifest if the file doesn't exist.
 */
export function readInstalledTools(): InstalledToolsManifest {
  const manifestPath = getManifestPath()

  if (!fs.existsSync(manifestPath)) {
    return {
      version: MANIFEST_VERSION,
      tools: [],
      updatedAt: new Date().toISOString(),
    }
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8')
    const manifest = JSON.parse(content) as InstalledToolsManifest

    // Validate version
    if (manifest.version !== MANIFEST_VERSION) {
      console.warn(`[installed-tools] Manifest version mismatch: ${manifest.version}, expected ${MANIFEST_VERSION}. Starting fresh.`)
      return {
        version: MANIFEST_VERSION,
        tools: [],
        updatedAt: new Date().toISOString(),
      }
    }

    return manifest
  } catch (err) {
    console.error('[installed-tools] Failed to read manifest:', err)
    return {
      version: MANIFEST_VERSION,
      tools: [],
      updatedAt: new Date().toISOString(),
    }
  }
}

/**
 * Write the installed tools manifest to disk.
 */
function writeInstalledTools(manifest: InstalledToolsManifest): void {
  const manifestPath = getManifestPath()
  const dataDir = getOpenClawDataDir()

  // Ensure directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  manifest.updatedAt = new Date().toISOString()
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
}

/**
 * Add a tool to the manifest.
 * If a tool with the same name already exists, it will be updated.
 */
export function addInstalledTool(tool: Omit<InstalledTool, 'installedAt'>): void {
  const manifest = readInstalledTools()

  // Check for existing tool with same name
  const existingIndex = manifest.tools.findIndex(t => t.name === tool.name)

  const newTool: InstalledTool = {
    ...tool,
    installedAt: new Date().toISOString(),
  }

  if (existingIndex >= 0) {
    // Update existing entry
    manifest.tools[existingIndex] = newTool
    console.log(`[installed-tools] Updated tool: ${tool.name} (${tool.kind})`)
  } else {
    // Add new entry
    manifest.tools.push(newTool)
    console.log(`[installed-tools] Added tool: ${tool.name} (${tool.kind})`)
  }

  writeInstalledTools(manifest)
}

/**
 * Remove a tool from the manifest by name.
 */
export function removeInstalledTool(name: string): boolean {
  const manifest = readInstalledTools()
  const initialLength = manifest.tools.length

  manifest.tools = manifest.tools.filter(t => t.name !== name)

  if (manifest.tools.length < initialLength) {
    writeInstalledTools(manifest)
    console.log(`[installed-tools] Removed tool: ${name}`)
    return true
  }

  return false
}

/**
 * Get all installed tools.
 */
export function listInstalledTools(): InstalledTool[] {
  const manifest = readInstalledTools()
  return manifest.tools
}

/**
 * Check if there are any installed tools that need reinstallation.
 */
export function hasInstalledTools(): boolean {
  const manifest = readInstalledTools()
  return manifest.tools.length > 0
}

/**
 * Clear all installed tools from the manifest.
 * Use with caution - typically only when doing a full reset.
 */
export function clearInstalledTools(): void {
  const manifest: InstalledToolsManifest = {
    version: MANIFEST_VERSION,
    tools: [],
    updatedAt: new Date().toISOString(),
  }
  writeInstalledTools(manifest)
  console.log('[installed-tools] Cleared all installed tools')
}

/**
 * Generate installation commands for all tools in the manifest.
 * Returns an array of commands suitable for execution in the container.
 */
export function generateReinstallCommands(): string[] {
  const tools = listInstalledTools()
  const commands: string[] = []

  for (const tool of tools) {
    switch (tool.kind) {
      case 'node':
        commands.push(`npm install -g ${tool.package}`)
        break
      case 'go':
        commands.push(`go install ${tool.package}`)
        break
      case 'uv':
        commands.push(`uv tool install ${tool.package}`)
        break
      case 'apt':
        commands.push(`apt-get update && apt-get install -y ${tool.package}`)
        break
      case 'download':
        // Download type tools need custom handling - skip for auto-reinstall
        console.warn(`[installed-tools] Skipping download-type tool: ${tool.name} (requires custom reinstallation)`)
        break
    }
  }

  return commands
}

/**
 * Get a summary of installed tools for logging/display.
 */
export function getToolsSummary(): string {
  const tools = listInstalledTools()
  if (tools.length === 0) {
    return 'No tools installed'
  }

  const byKind: Record<ToolKind, number> = {
    node: 0,
    go: 0,
    uv: 0,
    apt: 0,
    download: 0,
  }

  for (const tool of tools) {
    byKind[tool.kind]++
  }

  return `${tools.length} tools installed: npm=${byKind.node}, go=${byKind.go}, uv=${byKind.uv}, apt=${byKind.apt}, download=${byKind.download}`
}
