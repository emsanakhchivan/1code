import * as fs from "fs/promises"
import type { Dirent } from "fs"
import * as path from "path"
import * as os from "os"
import { execFile } from "child_process"
import { promisify } from "util"
import type { McpServerConfig } from "../claude-config"
import { isDirentDirectory } from "../fs/dirent"

const execFileAsync = promisify(execFile)

export interface PluginInfo {
  name: string
  version: string
  description?: string
  path: string
  source: string // e.g., "marketplace:plugin-name"
  marketplace: string // e.g., "claude-plugins-official"
  category?: string
  homepage?: string
  tags?: string[]
  /** Whether this plugin needs to be fetched (git clone) before use */
  needsFetch?: boolean
}

interface MarketplacePlugin {
  name: string
  version?: string
  description?: string
  source: string | PluginSourceInfo
  category?: string
  homepage?: string
  tags?: string[]
}

interface PluginSourceInfo {
  source: string // "git-subdir" | "url" | "github"
  url?: string
  repo?: string // for "github" type
  path?: string // for "git-subdir" type
  ref?: string
  sha?: string
  commit?: string
}

interface MarketplaceJson {
  name: string
  plugins: MarketplacePlugin[]
}

export interface PluginMcpConfig {
  pluginSource: string // e.g., "ccsetup:ccsetup"
  mcpServers: Record<string, McpServerConfig>
}

// Cache for plugin discovery results
let pluginCache: { plugins: PluginInfo[]; timestamp: number } | null = null
let mcpCache: { configs: PluginMcpConfig[]; timestamp: number } | null = null
const CACHE_TTL_MS = 30000 // 30 seconds

// Track which repos have been cloned to avoid re-cloning
const clonedRepos = new Map<string, string>() // url -> local path

/**
 * Clear plugin caches (for testing/manual invalidation)
 */
export function clearPluginCache() {
  pluginCache = null
  mcpCache = null
}

/**
 * Get the cache directory for cloned external plugins.
 */
function getPluginCacheDir(): string {
  return path.join(os.homedir(), ".claude", "plugins", ".cache")
}

/**
 * Compute the expected clone directory for a repo URL (without actually cloning).
 */
function getCloneDir(repoUrl: string): string {
  const cacheDir = getPluginCacheDir()
  const urlHash = Buffer.from(repoUrl).toString("base64url").replace(/[/+=]/g, "_").substring(0, 48)
  return path.join(cacheDir, urlHash)
}

/**
 * Check if a cached clone exists and optionally verify its SHA.
 */
async function getCachedClone(cloneDir: string, expectedSha?: string): Promise<string | null> {
  try {
    await fs.access(path.join(cloneDir, ".git"))
    if (expectedSha) {
      try {
        const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: cloneDir })
        if (stdout.trim() === expectedSha) return cloneDir
      } catch {
        // Can't read SHA, use what we have
      }
    }
    return cloneDir
  } catch {
    return null
  }
}

/**
 * Clone a git repo to the cache directory (async, non-blocking).
 * Returns the local path to the cloned repo.
 */
async function cloneRepo(repoUrl: string, sha?: string): Promise<string> {
  const cloneDir = getCloneDir(repoUrl)

  // Check if already cloned and up to date
  const cached = await getCachedClone(cloneDir, sha)
  if (cached) return cached

  // Check memory cache to avoid duplicate concurrent clones
  if (clonedRepos.has(repoUrl)) return clonedRepos.get(repoUrl)!

  // Clone the repo asynchronously
  const cacheDir = getPluginCacheDir()
  await fs.mkdir(cacheDir, { recursive: true })

  try {
    await execFileAsync("git", ["clone", "--depth", "50", repoUrl, cloneDir], {
      cwd: cacheDir,
    })
  } catch {
    // Clone failed — try without depth
    try {
      await fs.rm(cloneDir, { recursive: true, force: true })
    } catch { /* ignore */ }
    await execFileAsync("git", ["clone", repoUrl, cloneDir], {
      cwd: cacheDir,
    })
  }

  if (sha) {
    try {
      await execFileAsync("git", ["fetch", "origin", sha], { cwd: cloneDir })
      await execFileAsync("git", ["checkout", sha], { cwd: cloneDir })
    } catch {
      try {
        await execFileAsync("git", ["fetch", "--unshallow"], { cwd: cloneDir })
        await execFileAsync("git", ["checkout", sha], { cwd: cloneDir })
      } catch {
        // Best effort
      }
    }
  }

  clonedRepos.set(repoUrl, cloneDir)
  return cloneDir
}

/**
 * Resolve an object source to a local plugin path (async, non-blocking).
 * Returns null if the plugin hasn't been fetched yet and autoFetch is false.
 */
async function resolveObjectSource(
  sourceInfo: PluginSourceInfo,
  autoFetch: boolean
): Promise<string | null> {
  const sourceType = sourceInfo.source

  if (sourceType === "url") {
    if (!sourceInfo.url) return null
    const cloneDir = getCloneDir(sourceInfo.url)
    // Fast check: is it already cached?
    const cached = await getCachedClone(cloneDir, sourceInfo.sha)
    if (cached) return cached
    // Not cached — return null unless autoFetch
    if (!autoFetch) return null
    try {
      return await cloneRepo(sourceInfo.url, sourceInfo.sha)
    } catch {
      return null
    }
  }

  if (sourceType === "github") {
    const repo = sourceInfo.repo
    if (!repo) return null
    const repoUrl = `https://github.com/${repo}.git`
    const cloneDir = getCloneDir(repoUrl)
    const cached = await getCachedClone(cloneDir, sourceInfo.sha || sourceInfo.commit)
    if (cached) return cached
    if (!autoFetch) return null
    try {
      return await cloneRepo(repoUrl, sourceInfo.sha || sourceInfo.commit)
    } catch {
      return null
    }
  }

  if (sourceType === "git-subdir") {
    if (!sourceInfo.url || !sourceInfo.path) return null
    const cloneDir = getCloneDir(sourceInfo.url)
    const cached = await getCachedClone(cloneDir, sourceInfo.sha)
    if (cached) {
      const subDir = path.join(cached, sourceInfo.path)
      try {
        const stat = await fs.stat(subDir)
        if (stat.isDirectory()) return subDir
      } catch { /* not found */ }
    }
    if (!autoFetch) return null
    try {
      const repoPath = await cloneRepo(sourceInfo.url, sourceInfo.sha)
      const subDir = path.join(repoPath, sourceInfo.path)
      try {
        const stat = await fs.stat(subDir)
        if (stat.isDirectory()) return subDir
      } catch { /* not found */ }
      return null
    } catch {
      return null
    }
  }

  return null
}

/**
 * Discover all plugins from ~/.claude/plugins/marketplaces/
 * This is FAST — it reads marketplace.json and lists all plugins.
 * Object source plugins that aren't cached locally get needsFetch=true.
 * Use fetchPlugin() to download individual plugins on demand.
 */
export async function discoverInstalledPlugins(): Promise<PluginInfo[]> {
  if (pluginCache && Date.now() - pluginCache.timestamp < CACHE_TTL_MS) {
    return pluginCache.plugins
  }

  const plugins: PluginInfo[] = []
  const marketplacesDir = path.join(os.homedir(), ".claude", "plugins", "marketplaces")

  try {
    await fs.access(marketplacesDir)
  } catch {
    pluginCache = { plugins, timestamp: Date.now() }
    return plugins
  }

  let marketplaces: Dirent[]
  try {
    marketplaces = await fs.readdir(marketplacesDir, { withFileTypes: true })
  } catch {
    pluginCache = { plugins, timestamp: Date.now() }
    return plugins
  }

  for (const marketplace of marketplaces) {
    if (marketplace.name.startsWith(".")) continue

    const isMarketplaceDir = await isDirentDirectory(marketplacesDir, marketplace)
    if (!isMarketplaceDir) continue

    const marketplacePath = path.join(marketplacesDir, marketplace.name)
    const marketplaceJsonPath = path.join(marketplacePath, ".claude-plugin", "marketplace.json")

    try {
      const content = await fs.readFile(marketplaceJsonPath, "utf-8")
      let marketplaceJson: MarketplaceJson
      try {
        marketplaceJson = JSON.parse(content)
      } catch {
        continue
      }
      if (!Array.isArray(marketplaceJson.plugins)) continue

      for (const plugin of marketplaceJson.plugins) {
        if (!plugin.source) continue

        let pluginPath: string | null = null
        let needsFetch = false

        if (typeof plugin.source === "string") {
          pluginPath = path.resolve(marketplacePath, plugin.source)
          try {
            const pluginStat = await fs.stat(pluginPath)
            if (!pluginStat.isDirectory()) continue
          } catch {
            continue
          }
        } else if (typeof plugin.source === "object") {
          // Check if already cached locally — DO NOT clone here
          const resolved = await resolveObjectSource(plugin.source as PluginSourceInfo, false)
          if (resolved) {
            pluginPath = resolved
          } else {
            // Not cached — list it but mark as needing fetch
            needsFetch = true
            pluginPath = "" // no local path yet
          }
        } else {
          continue
        }

        plugins.push({
          name: plugin.name,
          version: plugin.version || "0.0.0",
          description: plugin.description,
          path: pluginPath,
          source: `${marketplaceJson.name}:${plugin.name}`,
          marketplace: marketplaceJson.name,
          category: plugin.category,
          homepage: plugin.homepage,
          tags: plugin.tags,
          needsFetch,
        })
      }
    } catch {
      // No marketplace.json
    }
  }

  pluginCache = { plugins, timestamp: Date.now() }
  return plugins
}

/**
 * Fetch (clone) a single plugin that has needsFetch=true.
 * Returns updated PluginInfo with the local path.
 * This is async and non-blocking.
 */
export async function fetchPlugin(pluginSource: string): Promise<PluginInfo | null> {
  // Find the plugin in marketplace data
  const marketplacesDir = path.join(os.homedir(), ".claude", "plugins", "marketplaces")

  let targetPlugin: { plugin: MarketplacePlugin; marketplaceName: string } | null = null

  try {
    const marketplaces = await fs.readdir(marketplacesDir, { withFileTypes: true })
    for (const marketplace of marketplaces) {
      if (marketplace.name.startsWith(".")) continue
      const marketplacePath = path.join(marketplacesDir, marketplace.name)
      const marketplaceJsonPath = path.join(marketplacePath, ".claude-plugin", "marketplace.json")

      try {
        const content = await fs.readFile(marketplaceJsonPath, "utf-8")
        const marketplaceJson: MarketplaceJson = JSON.parse(content)
        if (!Array.isArray(marketplaceJson.plugins)) continue

        for (const plugin of marketplaceJson.plugins) {
          const source = `${marketplaceJson.name}:${plugin.name}`
          if (source === pluginSource && typeof plugin.source === "object") {
            targetPlugin = { plugin, marketplaceName: marketplaceJson.name }
            break
          }
        }
      } catch { /* skip */ }
      if (targetPlugin) break
    }
  } catch {
    return null
  }

  if (!targetPlugin) return null

  const pluginPath = await resolveObjectSource(targetPlugin.plugin.source as PluginSourceInfo, true)
  if (!pluginPath) return null

  // Invalidate cache so next discovery picks up the new path
  clearPluginCache()

  return {
    name: targetPlugin.plugin.name,
    version: targetPlugin.plugin.version || "0.0.0",
    description: targetPlugin.plugin.description,
    path: pluginPath,
    source: `${targetPlugin.marketplaceName}:${targetPlugin.plugin.name}`,
    marketplace: targetPlugin.marketplaceName,
    category: targetPlugin.plugin.category,
    homepage: targetPlugin.plugin.homepage,
    tags: targetPlugin.plugin.tags,
    needsFetch: false,
  }
}

/**
 * Get component paths for a plugin (commands, skills, agents directories)
 */
export function getPluginComponentPaths(plugin: PluginInfo) {
  return {
    commands: path.join(plugin.path, "commands"),
    skills: path.join(plugin.path, "skills"),
    agents: path.join(plugin.path, "agents"),
  }
}

/**
 * Discover MCP server configs from all installed plugins
 * Only reads from plugins that have a local path (already fetched).
 */
export async function discoverPluginMcpServers(): Promise<PluginMcpConfig[]> {
  if (mcpCache && Date.now() - mcpCache.timestamp < CACHE_TTL_MS) {
    return mcpCache.configs
  }

  const plugins = await discoverInstalledPlugins()
  const configs: PluginMcpConfig[] = []

  for (const plugin of plugins) {
    if (plugin.needsFetch || !plugin.path) continue

    const mcpJsonPath = path.join(plugin.path, ".mcp.json")
    try {
      const content = await fs.readFile(mcpJsonPath, "utf-8")
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(content)
      } catch {
        continue
      }

      const serversObj =
        parsed.mcpServers &&
        typeof parsed.mcpServers === "object" &&
        !Array.isArray(parsed.mcpServers)
          ? (parsed.mcpServers as Record<string, unknown>)
          : parsed

      const validServers: Record<string, McpServerConfig> = {}
      for (const [name, config] of Object.entries(serversObj)) {
        if (config && typeof config === "object" && !Array.isArray(config)) {
          validServers[name] = config as McpServerConfig
        }
      }

      if (Object.keys(validServers).length > 0) {
        configs.push({
          pluginSource: plugin.source,
          mcpServers: validServers,
        })
      }
    } catch {
      // No .mcp.json
    }
  }

  mcpCache = { configs, timestamp: Date.now() }
  return configs
}
