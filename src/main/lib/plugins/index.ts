import * as fs from "fs/promises"
import type { Dirent } from "fs"
import * as path from "path"
import * as os from "os"
import * as cp from "child_process"
import type { McpServerConfig } from "../claude-config"
import { isDirentDirectory } from "../fs/dirent"

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
const CACHE_TTL_MS = 30000 // 30 seconds - plugins don't change often during a session

/**
 * Clear plugin caches (for testing/manual invalidation)
 */
export function clearPluginCache() {
  pluginCache = null
  mcpCache = null
}

/**
 * Get the cache directory for cloned external plugins.
 * Located at ~/.claude/plugins/.cache/
 */
function getPluginCacheDir(): string {
  return path.join(os.homedir(), ".claude", "plugins", ".cache")
}

/**
 * Ensure a git repo is cloned (or updated) at the cache location.
 * Returns the local path to the cloned repo.
 */
async function ensureCloned(repoUrl: string, sha?: string): Promise<string> {
  const cacheDir = getPluginCacheDir()

  // Create a stable directory name from the URL
  const urlHash = Buffer.from(repoUrl).toString("base64url").replace(/[/+=]/g, "_").substring(0, 48)
  const cloneDir = path.join(cacheDir, urlHash)

  try {
    await fs.access(cloneDir)
    // Directory exists — if we need a specific SHA and it matches, we're done
    if (sha) {
      try {
        const currentSha = cp.execSync("git rev-parse HEAD", {
          cwd: cloneDir,
          encoding: "utf-8",
        }).trim()
        if (currentSha === sha) return cloneDir
      } catch {
        // Can't check current SHA, fall through to re-clone
      }
    }

    // Try to fetch and checkout
    try {
      if (sha) {
        cp.execSync("git fetch origin", { cwd: cloneDir, stdio: "pipe" })
        cp.execSync(`git checkout ${sha}`, { cwd: cloneDir, stdio: "pipe" })
        return cloneDir
      }
      // No specific SHA — just pull
      cp.execSync("git pull --ff-only", { cwd: cloneDir, stdio: "pipe" })
      return cloneDir
    } catch {
      // Pull failed, remove and re-clone below
    }
  } catch {
    // Directory doesn't exist, proceed to clone
  }

  // Clone the repo
  await fs.mkdir(cacheDir, { recursive: true })
  cp.execSync(`git clone --depth 50 ${sha ? "" : "--single-branch "}"${repoUrl}" "${cloneDir}"`, {
    stdio: "pipe",
    cwd: cacheDir,
  })

  if (sha) {
    try {
      cp.execSync(`git fetch origin ${sha}`, { cwd: cloneDir, stdio: "pipe" })
      cp.execSync(`git checkout ${sha}`, { cwd: cloneDir, stdio: "pipe" })
    } catch {
      // If SHA fetch fails, try full fetch
      try {
        cp.execSync("git fetch --unshallow", { cwd: cloneDir, stdio: "pipe" })
        cp.execSync(`git checkout ${sha}`, { cwd: cloneDir, stdio: "pipe" })
      } catch {
        // Best effort — continue with whatever we have
      }
    }
  }

  return cloneDir
}

/**
 * Resolve an object source to a local plugin path.
 * Handles "url", "github", and "git-subdir" source types.
 */
async function resolveObjectSource(
  marketplacePath: string,
  pluginName: string,
  sourceInfo: PluginSourceInfo
): Promise<string | null> {
  const sourceType = sourceInfo.source

  if (sourceType === "url") {
    // Clone the full repo as the plugin
    if (!sourceInfo.url) return null
    try {
      const clonePath = await ensureCloned(sourceInfo.url, sourceInfo.sha)
      return clonePath
    } catch {
      return null
    }
  }

  if (sourceType === "github") {
    // Clone from a GitHub repo
    const repo = sourceInfo.repo
    if (!repo) return null
    const repoUrl = `https://github.com/${repo}.git`
    try {
      const clonePath = await ensureCloned(repoUrl, sourceInfo.sha || sourceInfo.commit)
      return clonePath
    } catch {
      return null
    }
  }

  if (sourceType === "git-subdir") {
    // Clone the parent repo and point to a subdirectory
    if (!sourceInfo.url || !sourceInfo.path) return null
    try {
      const clonePath = await ensureCloned(sourceInfo.url, sourceInfo.sha)
      const subDir = path.join(clonePath, sourceInfo.path)
      try {
        const stat = await fs.stat(subDir)
        if (stat.isDirectory()) return subDir
      } catch {
        // Subdirectory doesn't exist in the clone
      }
      return null
    } catch {
      return null
    }
  }

  return null
}

/**
 * Discover all installed plugins from ~/.claude/plugins/marketplaces/
 * Returns array of plugin info with paths to their component directories.
 * Results are cached for 30 seconds to avoid repeated filesystem scans.
 *
 * Supports three source formats:
 * - String: relative path within marketplace directory
 * - { source: "url", url, sha }: full git repo URL
 * - { source: "github", repo, sha }: GitHub repo
 * - { source: "git-subdir", url, path, sha }: git repo with plugin in subdirectory
 */
export async function discoverInstalledPlugins(): Promise<PluginInfo[]> {
  // Return cached result if still valid
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

    const isMarketplaceDir = await isDirentDirectory(
      marketplacesDir,
      marketplace,
    )
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

      if (!Array.isArray(marketplaceJson.plugins)) {
        continue
      }

      for (const plugin of marketplaceJson.plugins) {
        // Validate plugin.source exists
        if (!plugin.source) continue

        let pluginPath: string | null = null

        if (typeof plugin.source === "string") {
          // String source: relative path within marketplace directory
          pluginPath = path.resolve(marketplacePath, plugin.source)
          try {
            const pluginStat = await fs.stat(pluginPath)
            if (!pluginStat.isDirectory()) continue
          } catch {
            // Directory not found, skip
            continue
          }
        } else if (typeof plugin.source === "object") {
          // Object source: url, github, or git-subdir
          pluginPath = await resolveObjectSource(
            marketplacePath,
            plugin.name,
            plugin.source as PluginSourceInfo,
          )
          if (!pluginPath) continue
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
        })
      }
    } catch {
      // No marketplace.json, skip silently (expected for non-plugin directories)
    }
  }

  pluginCache = { plugins, timestamp: Date.now() }
  return plugins
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
 * Reads .mcp.json from each plugin directory
 * Results are cached for 30 seconds to avoid repeated filesystem scans
 */
export async function discoverPluginMcpServers(): Promise<PluginMcpConfig[]> {
  // Return cached result if still valid
  if (mcpCache && Date.now() - mcpCache.timestamp < CACHE_TTL_MS) {
    return mcpCache.configs
  }

  const plugins = await discoverInstalledPlugins()
  const configs: PluginMcpConfig[] = []

  for (const plugin of plugins) {
    const mcpJsonPath = path.join(plugin.path, ".mcp.json")
    try {
      const content = await fs.readFile(mcpJsonPath, "utf-8")
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(content)
      } catch {
        continue
      }

      // Support two formats:
      // Format A (flat): { "server-name": { "command": "...", ... } }
      // Format B (nested): { "mcpServers": { "server-name": { ... } } }
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
      // No .mcp.json file, skip silently (this is expected for most plugins)
    }
  }

  // Cache the result
  mcpCache = { configs, timestamp: Date.now() }
  return configs
}
