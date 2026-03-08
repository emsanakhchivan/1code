/**
 * Terminal shell type identifiers used for user preference and API.
 * Platform-specific: Windows supports cmd, powershell, bash; macOS/Linux support bash, zsh.
 */
export const TERMINAL_SHELL_TYPES = [
	"bash",
	"powershell",
	"cmd",
	"zsh",
] as const

export type TerminalShellType = (typeof TERMINAL_SHELL_TYPES)[number]

/** Shell types available on Windows */
export const WINDOWS_SHELL_TYPES = ["powershell", "cmd", "bash"] as const
export type WindowsShellType = (typeof WINDOWS_SHELL_TYPES)[number]

/** Shell types available on macOS/Linux */
export const UNIX_SHELL_TYPES = ["bash", "zsh"] as const
export type UnixShellType = (typeof UNIX_SHELL_TYPES)[number]
