"use client"

import { useSetAtom } from "jotai"
import { Check, Laptop } from "lucide-react"
import { useMemo, useState } from "react"

import {
  ClaudeCodeIcon,
  CodexIcon,
  KeyFilledIcon,
  SettingsFilledIcon,
} from "../../components/ui/icons"
import {
  billingMethodAtom,
  codexOnboardingCompletedAtom,
  localModeAtom,
  type BillingMethod,
} from "../../lib/atoms"
import { cn } from "../../lib/utils"

type BillingOptionGroup = "claude-code" | "codex"

type BillingOption = {
  id: string
  method: Exclude<BillingMethod, null>
  group: BillingOptionGroup
  title: string
  subtitle: string
  recommended?: boolean
  icon: React.ReactNode
}

const billingOptions: BillingOption[] = [
  {
    id: "claude-subscription",
    method: "claude-subscription",
    group: "claude-code",
    title: "Claude Pro/Max",
    subtitle: "Use your Claude subscription for unlimited access.",
    recommended: true,
    icon: <ClaudeCodeIcon className="w-5 h-5" />,
  },
  {
    id: "api-key",
    method: "api-key",
    group: "claude-code",
    title: "Anthropic API Key",
    subtitle: "Pay-as-you-go with your own API key.",
    icon: <KeyFilledIcon className="w-5 h-5" />,
  },
  {
    id: "custom-model",
    method: "custom-model",
    group: "claude-code",
    title: "Custom Model",
    subtitle: "Use a custom base URL and model.",
    icon: <SettingsFilledIcon className="w-5 h-5" />,
  },
  {
    id: "codex-subscription",
    method: "codex-subscription",
    group: "codex",
    title: "Codex Subscription",
    subtitle: "Use your Codex ChatGPT login.",
    recommended: true,
    icon: <CodexIcon className="w-5 h-5" />,
  },
  {
    id: "codex-api-key",
    method: "codex-api-key",
    group: "codex",
    title: "API Key",
    subtitle: "Use an app-managed OpenAI API key for Codex.",
    icon: <KeyFilledIcon className="w-5 h-5" />,
  },
]

export function BillingMethodPage() {
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const setLocalMode = useSetAtom(localModeAtom)
  const setCodexOnboardingCompleted = useSetAtom(codexOnboardingCompletedAtom)
  const [selectedGroup, setSelectedGroup] =
    useState<BillingOptionGroup>("claude-code")
  const [selectedOptionId, setSelectedOptionId] =
    useState<string>("claude-subscription")

  // Track if "Use Locally" is selected (separate from billing options)
  const [useLocallySelected, setUseLocallySelected] = useState(false)

  const visibleOptions = useMemo(
    () => billingOptions.filter((option) => option.group === selectedGroup),
    [selectedGroup],
  )

  const selectedOption = useMemo(() => {
    const found = billingOptions.find((option) => option.id === selectedOptionId)
    return found || billingOptions[0]
  }, [selectedOptionId])

  const handleContinue = () => {
    // Handle "Use Locally" selection
    if (useLocallySelected) {
      setLocalMode(true)
      setBillingMethod("local-mode")
      return
    }

    if (
      selectedOption.method === "codex-subscription" ||
      selectedOption.method === "codex-api-key"
    ) {
      // Force Codex onboarding step when user explicitly chooses a Codex auth mode.
      setCodexOnboardingCompleted(false)
    }

    setBillingMethod(selectedOption.method)
  }

  const handleUseLocally = () => {
    setUseLocallySelected(true)
    // Unselect any billing option
    setSelectedOptionId("")
  }

  const handleBillingOptionSelect = (optionId: string) => {
    setSelectedOptionId(optionId)
    setUseLocallySelected(false)
  }

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
      {/* Draggable title bar area */}
      <div
        className="fixed top-0 left-0 right-0 h-10"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      <div className="w-full max-w-[440px] min-h-[520px] space-y-6 px-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-base font-semibold tracking-tight">
            Connect AI Provider
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose how you'd like to connect your provider.
          </p>
        </div>

        {/* Use Locally - Quick Start Option */}
        <button
          onClick={handleUseLocally}
          className={cn(
            "relative w-full p-4 rounded-xl text-left transition-[transform,box-shadow] duration-150 ease-out",
            "shadow-[0_0_0_0.5px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.3)]",
            "hover:shadow-[0_0_0_0.5px_rgba(0,0,0,0.2),0_2px_4px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_0_0_0.5px_rgba(255,255,255,0.15),0_2px_4px_rgba(0,0,0,0.4)]",
            "active:scale-[0.99]",
            useLocallySelected
              ? "bg-primary/5 ring-2 ring-primary/50"
              : "bg-background"
          )}
        >
          {useLocallySelected && (
            <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)]">
              <Check className="w-3 h-3 text-primary-foreground" />
            </div>
          )}
          <div className="flex items-start gap-3">
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
              useLocallySelected
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground"
            )}>
              <Laptop className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Use Locally</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  Quick Start
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Skip login, configure your AI provider later in settings.
              </p>
            </div>
          </div>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or connect</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="flex items-center rounded-full bg-muted p-1">
          <button
            type="button"
            onClick={() => {
              setSelectedGroup("claude-code")
              setSelectedOptionId("claude-subscription")
            }}
            className={cn(
              "h-8 flex-1 rounded-full text-sm font-medium transition-colors",
              selectedGroup === "claude-code"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Claude Code
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedGroup("codex")
              setSelectedOptionId("codex-subscription")
            }}
            className={cn(
              "h-8 flex-1 rounded-full text-sm font-medium transition-colors",
              selectedGroup === "codex"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Codex
          </button>
        </div>

        {/* Billing Options */}
        <div className="space-y-3">
          {visibleOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => handleBillingOptionSelect(option.id)}
              className={cn(
                "relative w-full p-4 rounded-xl text-left transition-[transform,box-shadow] duration-150 ease-out",
                "shadow-[0_0_0_0.5px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.3)]",
                "hover:shadow-[0_0_0_0.5px_rgba(0,0,0,0.2),0_2px_4px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_0_0_0.5px_rgba(255,255,255,0.15),0_2px_4px_rgba(0,0,0,0.4)]",
                "active:scale-[0.99]",
                selectedOptionId === option.id && !useLocallySelected
                  ? "bg-primary/5"
                  : "bg-background"
              )}
            >
              {/* Checkmark in top right corner */}
              {selectedOptionId === option.id && !useLocallySelected && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)]">
                  <Check className="w-3 h-3 text-primary-foreground" />
                </div>
              )}
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    option.id === "claude-subscription"
                      ? "bg-[#D97757] text-white"
                      : option.id === "codex-subscription"
                        ? "bg-white text-black"
                      : selectedOptionId === option.id
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {option.icon}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{option.title}</span>
                    {option.recommended && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {option.subtitle}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Continue Button */}
        <button
          onClick={handleContinue}
          disabled={!useLocallySelected && !selectedOptionId}
          className="w-full h-8 px-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {useLocallySelected ? "Start" : "Continue"}
        </button>
      </div>
    </div>
  )
}
