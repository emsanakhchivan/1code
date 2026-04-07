import { Provider as JotaiProvider, useAtomValue, useSetAtom } from "jotai"
import { ThemeProvider, useTheme } from "next-themes"
import { Component, useEffect, useMemo } from "react"
import { Toaster } from "sonner"
import { TooltipProvider } from "./components/ui/tooltip"
import { TRPCProvider } from "./contexts/TRPCProvider"
import { WindowProvider, getInitialWindowParams } from "./contexts/WindowContext"
import { selectedProjectAtom, selectedAgentChatIdAtom } from "./features/agents/atoms"
import { useAgentSubChatStore } from "./features/agents/stores/sub-chat-store"
import { AgentsLayout } from "./features/layout/agents-layout"
import {
  AnthropicOnboardingPage,
  ApiKeyOnboardingPage,
  BillingMethodPage,
  CodexOnboardingPage,
  SelectRepoPage,
} from "./features/onboarding"
import { identify, initAnalytics, shutdown } from "./lib/analytics"
import {
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  billingMethodAtom,
  codexOnboardingCompletedAtom,
  localModeAtom,
} from "./lib/atoms"
import { appStore } from "./lib/jotai-store"
import { VSCodeThemeProvider } from "./lib/themes/theme-provider"
import { trpc } from "./lib/trpc"

/**
 * Custom Toaster that adapts to theme
 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme()

  return (
    <Toaster
      position="bottom-right"
      theme={resolvedTheme as "light" | "dark" | "system"}
      closeButton
    />
  )
}

/**
 * Main content router - decides which page to show based on onboarding state
 */
function AppContent() {
  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const localMode = useAtomValue(localModeAtom)
  const anthropicOnboardingCompleted = useAtomValue(
    anthropicOnboardingCompletedAtom
  )
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const apiKeyOnboardingCompleted = useAtomValue(apiKeyOnboardingCompletedAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)
  const codexOnboardingCompleted = useAtomValue(codexOnboardingCompletedAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const { setActiveSubChat, addToOpenSubChats, setChatId } = useAgentSubChatStore()

  // Apply initial window params (chatId/subChatId) when opening via "Open in new window"
  useEffect(() => {
    const params = getInitialWindowParams()
    if (params.chatId) {
      console.log("[App] Opening chat from window params:", params.chatId, params.subChatId)
      setSelectedChatId(params.chatId)
      setChatId(params.chatId)
      if (params.subChatId) {
        addToOpenSubChats(params.subChatId)
        setActiveSubChat(params.subChatId)
      }
    }
  }, [setSelectedChatId, setChatId, addToOpenSubChats, setActiveSubChat])

  // Claim the initially selected chat to prevent duplicate windows.
  // For new windows opened via "Open in new window", the chat is pre-claimed by main process.
  // For restored windows (persisted localStorage), we need to claim here.
  // Read atom directly from store to avoid stale closure with empty deps.
  useEffect(() => {
    if (!window.desktopApi?.claimChat) return
    const currentChatId = appStore.get(selectedAgentChatIdAtom)
    if (!currentChatId) return
    window.desktopApi.claimChat(currentChatId).then((result) => {
      if (!result.ok) {
        // Another window already has this chat — clear our selection
        setSelectedChatId(null)
      }
    })
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Check if user has existing CLI config (API key or proxy)
  // Based on PR #29 by @sa4hnd
  const { data: cliConfig, isLoading: isLoadingCliConfig } =
    trpc.claudeCode.hasExistingCliConfig.useQuery()

  // Migration: If user already completed Anthropic onboarding but has no billing method set,
  // automatically set it to "claude-subscription" (legacy users before billing method was added)
  useEffect(() => {
    if (!billingMethod && anthropicOnboardingCompleted) {
      setBillingMethod("claude-subscription")
    }
  }, [billingMethod, anthropicOnboardingCompleted, setBillingMethod])

  // Auto-skip onboarding if user has existing CLI config (API key or proxy)
  // This allows users with ANTHROPIC_API_KEY to use the app without OAuth
  useEffect(() => {
    if (cliConfig?.hasConfig && !billingMethod) {
      console.log("[App] Detected existing CLI config, auto-completing onboarding")
      setBillingMethod("api-key")
      setApiKeyOnboardingCompleted(true)
    }
  }, [cliConfig?.hasConfig, billingMethod, setBillingMethod, setApiKeyOnboardingCompleted])

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Validated project - only valid if exists in DB
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading, trust localStorage value to prevent flicker
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects])

  // Determine which page to show:
  // 1. No billing method selected -> BillingMethodPage
  // 2. Local mode selected -> Skip all auth onboarding, go to project selection or main app
  // 3. Claude subscription selected but not completed -> AnthropicOnboardingPage
  // 4. Codex selected but not completed -> CodexOnboardingPage
  // 5. API key or custom model selected but not completed -> ApiKeyOnboardingPage
  // 6. No valid project selected -> SelectRepoPage
  // 7. Otherwise -> AgentsLayout
  if (!billingMethod) {
    return <BillingMethodPage />
  }

  // Local mode: skip all auth onboarding
  if (billingMethod === "local-mode") {
    if (!validatedProject && !isLoadingProjects) {
      return <SelectRepoPage />
    }
    return <AgentsLayout />
  }

  if (billingMethod === "claude-subscription" && !anthropicOnboardingCompleted) {
    return <AnthropicOnboardingPage />
  }

  if (
    (billingMethod === "codex-subscription" ||
      billingMethod === "codex-api-key") &&
    !codexOnboardingCompleted
  ) {
    return <CodexOnboardingPage />
  }

  if (
    (billingMethod === "api-key" || billingMethod === "custom-model") &&
    !apiKeyOnboardingCompleted
  ) {
    return <ApiKeyOnboardingPage />
  }

  if (!validatedProject && !isLoadingProjects) {
    return <SelectRepoPage />
  }

  return <AgentsLayout />
}

// ============================================================================
// ERROR BOUNDARY - Catches renderer crashes and shows recovery UI
// ============================================================================
interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class AppErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[AppErrorBoundary] Renderer error caught:", error)
    console.error("[AppErrorBoundary] Component stack:", errorInfo.componentStack)

    // Notify main process about the crash (if available)
    try {
      window.desktopApi?.showNotification?.({
        title: "1Code encountered an error",
        body: error.message.slice(0, 100),
      })
    } catch {
      // Ignore notification errors
    }
  }

  handleReload = () => {
    window.location.reload()
  }

  handleRestart = () => {
    window.desktopApi?.windowClose?.()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          padding: "40px",
          textAlign: "center",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          backgroundColor: "#09090b",
          color: "#fafafa",
        }}>
          <svg width="48" height="48" viewBox="0 0 400 400" fill="none" style={{ marginBottom: "24px", opacity: 0.5 }}>
            <path fillRule="evenodd" clipRule="evenodd" d="M358.333 0C381.345 0 400 18.6548 400 41.6667V295.833C400 298.135 398.134 300 395.833 300H270.833C268.532 300 266.667 301.865 266.667 304.167V395.833C266.667 398.134 264.801 400 262.5 400H41.6667C18.6548 400 0 381.345 0 358.333V304.72C0 301.793 1.54269 299.081 4.05273 297.575L153.76 207.747C157.159 205.708 156.02 200.679 152.376 200.065L151.628 200H4.16667C1.86548 200 6.71103e-08 198.135 0 195.833V104.167C1.07376e-06 101.865 1.86548 100 4.16667 100H162.5C164.801 100 166.667 98.1345 166.667 95.8333V4.16667C166.667 1.86548 168.532 1.00666e-07 170.833 0H358.333ZM170.833 100C168.532 100 166.667 101.865 166.667 104.167V295.833C166.667 298.135 168.532 300 170.833 300H262.5C264.801 300 266.667 298.135 266.667 295.833V104.167C266.667 101.865 264.801 100 262.5 100H170.833Z" fill="#71717a"/>
          </svg>
          <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "8px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "14px", color: "#a1a1aa", marginBottom: "24px", maxWidth: "400px" }}>
            The application encountered an unexpected error. Your agents are still running in the background.
          </p>
          {this.state.error && (
            <div style={{
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "8px",
              padding: "12px 16px",
              marginBottom: "24px",
              maxWidth: "500px",
              overflow: "auto",
              fontSize: "12px",
              color: "#f87171",
              fontFamily: "monospace",
            }}>
              {this.state.error.message}
            </div>
          )}
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 500,
                backgroundColor: "#0033ff",
                color: "white",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Reload App
            </button>
            <button
              onClick={this.handleRestart}
              style={{
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 500,
                backgroundColor: "#27272a",
                color: "#fafafa",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Close Window
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export function App() {
  // Initialize analytics on mount
  useEffect(() => {
    initAnalytics()

    // Sync analytics opt-out status to main process
    const syncOptOutStatus = async () => {
      try {
        const optOut =
          localStorage.getItem("preferences:analytics-opt-out") === "true"
        await window.desktopApi?.setAnalyticsOptOut(optOut)
      } catch (error) {
        console.warn("[Analytics] Failed to sync opt-out status:", error)
      }
    }
    syncOptOutStatus()

    // Identify user if already authenticated
    const identifyUser = async () => {
      try {
        const user = await window.desktopApi?.getUser()
        if (user?.id) {
          identify(user.id, { email: user.email, name: user.name })
        }
      } catch (error) {
        console.warn("[Analytics] Failed to identify user:", error)
      }
    }
    identifyUser()

    // Cleanup on unmount
    return () => {
      shutdown()
    }
  }, [])

  return (
    <AppErrorBoundary>
      <WindowProvider>
        <JotaiProvider store={appStore}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <VSCodeThemeProvider>
              <TooltipProvider delayDuration={100}>
                <TRPCProvider>
                  <div
                    data-agents-page
                    className="h-screen w-screen bg-background text-foreground overflow-hidden"
                  >
                    <AppContent />
                  </div>
                  <ThemedToaster />
                </TRPCProvider>
              </TooltipProvider>
            </VSCodeThemeProvider>
          </ThemeProvider>
        </JotaiProvider>
      </WindowProvider>
    </AppErrorBoundary>
  )
}
