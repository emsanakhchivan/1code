/**
 * App settings that need to be read BEFORE app is ready
 * These are stored in a JSON file in userData directory
 * because localStorage is only available in renderer process
 * and some settings (like GPU acceleration) need to be set before app starts
 */
import { app } from "electron"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

const SETTINGS_FILE_NAME = "app-settings.json"

interface AppSettings {
  /**
   * GPU hardware acceleration
   * - false (default): GPU acceleration disabled, more stable on systems with many workspaces
   * - true: GPU acceleration enabled, may cause GPU crashes with many workspaces
   *
   * Changing this setting requires app restart to take effect
   */
  gpuAccelerationEnabled: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  gpuAccelerationEnabled: false, // Default OFF for stability
}

/**
 * Get the path to the settings file
 * Note: This can be called before app is ready (uses app.getPath('userData'))
 */
function getSettingsFilePath(): string {
  // In dev mode, userData path was already set in index.ts before requestSingleInstanceLock
  const userDataPath = app.getPath("userData")
  return join(userDataPath, SETTINGS_FILE_NAME)
}

/**
 * Read app settings from disk
 * Returns default settings if file doesn't exist or is malformed
 */
export function readAppSettings(): AppSettings {
  try {
    const filePath = getSettingsFilePath()

    if (!existsSync(filePath)) {
      return DEFAULT_SETTINGS
    }

    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)

    // Merge with defaults to handle missing keys
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    }
  } catch (error) {
    console.warn("[AppSettings] Failed to read settings file:", error)
    return DEFAULT_SETTINGS
  }
}

/**
 * Write app settings to disk
 * Creates the userData directory if it doesn't exist
 */
export function writeAppSettings(settings: AppSettings): void {
  try {
    const filePath = getSettingsFilePath()
    const userDataPath = app.getPath("userData")

    // Ensure userData directory exists (should already exist, but just in case)
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }

    writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf-8")
    console.log("[AppSettings] Settings saved:", settings)
  } catch (error) {
    console.error("[AppSettings] Failed to write settings file:", error)
  }
}

/**
 * Get GPU acceleration setting
 * This is read BEFORE app is ready to decide whether to disable hardware acceleration
 */
export function getGpuAccelerationEnabled(): boolean {
  const settings = readAppSettings()
  return settings.gpuAccelerationEnabled
}

/**
 * Set GPU acceleration setting
 * Note: This requires app restart to take effect
 */
export function setGpuAccelerationEnabled(enabled: boolean): void {
  const settings = readAppSettings()
  settings.gpuAccelerationEnabled = enabled
  writeAppSettings(settings)
}