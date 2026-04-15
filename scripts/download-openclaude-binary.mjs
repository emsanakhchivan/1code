#!/usr/bin/env node
/**
 * Downloads/copies OpenClaude CLI for bundling with the Electron app.
 *
 * Usage:
 *   node scripts/download-openclaude-binary.mjs                          # Download for current platform
 *   node scripts/download-openclaude-binary.mjs --local-path=/path/to/oclaude  # Copy from local project
 *   node scripts/download-openclaude-binary.mjs --version=1.0.0           # Specific version from releases
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, "..")
const BIN_DIR = path.join(ROOT_DIR, "resources", "bin")
const CLI_ENTRYPOINT = "resources/cli.mjs"

// Default local path for development
const DEFAULT_LOCAL_PATH = "C:/Users/test/Documents/Projects/oclaude"

function parseArgs() {
  const args = process.argv.slice(2)
  const result = {
    localPath: null,
    version: null,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith("--local-path=")) {
      result.localPath = arg.split("=")[1]
    } else if (arg === "--local-path" && args[i + 1]) {
      result.localPath = args[i + 1]
      i++
    } else if (arg.startsWith("--version=")) {
      result.version = arg.split("=")[1]
    } else if (arg === "--version" && args[i + 1]) {
      result.version = args[i + 1]
      i++
    }
  }

  // Default local path if not specified
  if (!result.localPath) {
    result.localPath = DEFAULT_LOCAL_PATH
  }

  return result
}

async function downloadFromReleases(version) {
  // TODO: Implement download from GitHub releases
  // For now, this is a placeholder for production builds
  console.log(`[openclaude] Download from releases not implemented yet. Version: ${version}`)
  console.log("[openclaude] Use --local-path to copy from local project in dev mode.")
  return false
}

async function copyFromLocal(localPath) {
  const sourcePath = path.join(localPath, CLI_ENTRYPOINT)

  if (!fs.existsSync(sourcePath)) {
    console.error(`[openclaude] Source file not found: ${sourcePath}`)
    console.error("[openclaude] Make sure the oclaude project has resources/cli.mjs")
    return false
  }

  const targetDir = path.join(BIN_DIR, `${process.platform}-${process.arch}`)
  const targetPath = path.join(targetDir, "openclaude.mjs")

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true })

  // Copy file
  fs.copyFileSync(sourcePath, targetPath)
  console.log(`[openclaude] ✓ Copied from: ${sourcePath}`)
  console.log(`[openclaude] ✓ Target: ${targetPath}`)

  // Write version file
  const versionPath = path.join(BIN_DIR, "OPENCLAUDE_VERSION")
  fs.writeFileSync(
    versionPath,
    `local-copy\n${new Date().toISOString()}\nSource: ${localPath}\n`
  )
  console.log(`[openclaude] ✓ Version file: ${versionPath}`)

  return true
}

async function main() {
  console.log("OpenClaude CLI Binary Downloader/Copier")
  console.log("========================================\n")

  const options = parseArgs()
  const targetDir = path.join(BIN_DIR, `${process.platform}-${process.arch}`)
  const targetPath = path.join(targetDir, "openclaude.mjs")

  console.log(`Platform: ${process.platform}-${process.arch}`)
  console.log(`Target: ${targetPath}`)
  console.log(`Options: localPath=${options.localPath}, version=${options.version || "none"}`)
  console.log()

  // Try local copy first (for development)
  if (options.localPath) {
    const success = await copyFromLocal(options.localPath)
    if (success) {
      console.log("\n✓ OpenClaude CLI ready!")
      return
    }
  }

  // Fallback to releases download (for production)
  if (options.version) {
    const success = await downloadFromReleases(options.version)
    if (success) {
      console.log("\n✓ OpenClaude CLI downloaded!")
      return
    }
  }

  // Check if file already exists
  if (fs.existsSync(targetPath)) {
    console.log(`\n✓ OpenClaude CLI already exists at: ${targetPath}`)
    console.log("  (No download/copy needed)")
    return
  }

  console.error("\n✗ Could not obtain OpenClaude CLI")
  console.error("  Run with --local-path pointing to your oclaude project")
  process.exit(1)
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})