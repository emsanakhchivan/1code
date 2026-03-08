#!/usr/bin/env node
/**
 * Postinstall: rebuild native modules for Electron, then run patch-electron-dev.
 * Set SKIP_NATIVE_REBUILD=1 to skip rebuild (e.g. no Visual Studio on Windows yet).
 */
import { execSync } from "child_process"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

if (!process.env.VERCEL && !process.env.SKIP_NATIVE_REBUILD) {
  try {
    execSync("electron-rebuild -f -w better-sqlite3,node-pty", {
      stdio: "inherit",
      cwd: root,
    })
  } catch (e) {
    console.warn(
      "\n[postinstall] electron-rebuild failed (native modules may not work)."
    )
    if (process.platform === "win32") {
      console.warn(
        "[postinstall] Windows: Install 'Build Tools for Visual Studio' with C++ workload, then run: bun run rebuild"
      )
    }
    console.warn("[postinstall] To skip rebuild next time: set SKIP_NATIVE_REBUILD=1\n")
  }
}

// Patch Electron.app name/icon on macOS (no-op on other platforms)
execSync("node scripts/patch-electron-dev.mjs", {
  stdio: "inherit",
  cwd: root,
})
