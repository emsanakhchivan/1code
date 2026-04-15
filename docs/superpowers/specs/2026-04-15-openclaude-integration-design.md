# OpenClaude CLI Integration Design

**Date:** 2026-04-15
**Status:** Draft - Pending User Approval
**Scope:** Add OpenClaude CLI as optional/beta agent in 1codepulll Electron app

---

## Summary

Integrate OpenClaude CLI (fork of Claude Code) as an alternative agent alongside Claude Code SDK. OpenClaude enables OpenAI-compatible endpoints (Ollama, Gemini, Together, etc.) while maintaining full Claude Code feature parity. The integration is additive - Claude Code mode remains unchanged.

---

## Architecture Overview

```
IPCChatTransport (renderer)
    ↓ tRPC subscription
claude.ts router (main)
    ↓ 
AgentTransportFactory.getTransport(agentType)
    ├── claude-code: ClaudeSDKTransport (existing SDK query)
    └── openclaude: OpenClaudeCLISpawn (spawn CLI, stdin/stdout JSON)
```

**Key insight:** OpenClaude is a Claude Code fork - same SDK, same JSON streaming protocol. Only differences:
1. CLI binary path (claude.exe vs openclaude.mjs)
2. OpenAI-compatible endpoints require environment flags

---

## Section 1: Settings & Atoms

### 1.1 New Atoms

**Agent type atom (global setting):**
```typescript
// src/renderer/lib/atoms/index.ts

export const agentTypeAtom = atomWithStorage<"claude-code" | "openclaude">(
  "agents:agent-type",
  "claude-code",  // default
  undefined,
  { getOnInit: true },
)
```

**Extended ModelProfile type:**
```typescript
export type EndpointType = "anthropic" | "openai-compatible"

export type ModelProfile = {
  id: string
  name: string
  baseUrl: string
  token: string
  models: CustomModelConfig[]
  endpointType: EndpointType  // NEW - default "anthropic"
  isOffline?: boolean
}
```

### 1.2 Default Values

- `agentTypeAtom`: `"claude-code"` (Anthropic official)
- `endpointType`: `"anthropic"` (Anthropic Messages API)
- Profiles without `endpointType` field → treated as `"anthropic"`

---

## Section 2: CLI Binary Bundling

### 2.1 Binary Structure

```
resources/bin/{platform}-{arch}/
├── claude.exe / claude           (existing - Claude Code binary)
├── openclaude.mjs                (NEW - OpenClaude CLI entrypoint)
├── VERSION                       (Claude Code version)
└── OPENCLAUDE_VERSION            (OpenClaude version)
```

**Source:** OpenClaude CLI entrypoint is `resources/cli.mjs` in oclaude repo.

### 2.2 Spawn Requirements

OpenClaude requires Node.js to run the .mjs entrypoint:
```typescript
spawn("node", [openclaudePath, ...args], { env, stdio: "pipe" })
```

**Node.js source options:**
- Dev mode: System Node from PATH
- Production: Bundle Node with Electron (Electron already has embedded Node)

### 2.3 Path Resolution

```typescript
// src/main/lib/claude/env.ts

export function getBundledOpenClaudeBinaryPath(): string {
  const isDev = !app.isPackaged
  const currentPlatform = process.platform
  const arch = process.arch

  const resourcesPath = isDev
    ? path.join(app.getAppPath(), "resources/bin", `${currentPlatform}-${arch}`)
    : path.join(process.resourcesPath, "bin")

  return path.join(resourcesPath, "openclaude.mjs")
}
```

---

## Section 3: Download Script & Build Integration

### 3.1 Download Script

```javascript
// scripts/download-openclaude-binary.mjs

const OPENCLAUDE_REPO = "https://github.com/anthropics/claude-code"  // TODO: Update with actual OpenClaude fork URL
const CLI_ENTRYPOINT = "resources/cli.mjs"
const BIN_DIR = path.join(ROOT_DIR, "resources/bin")

async function downloadOpenClaude(options) {
  const { localPath, version } = options
  const targetDir = path.join(BIN_DIR, `${process.platform}-${process.arch}`)
  const targetPath = path.join(targetDir, "openclaude.mjs")

  fs.mkdirSync(targetDir, { recursive: true })

  // Dev mode: copy from local oclaude project
  if (localPath && fs.existsSync(path.join(localPath, CLI_ENTRYPOINT))) {
    fs.copyFileSync(
      path.join(localPath, CLI_ENTRYPOINT),
      targetPath
    )
    console.log(`✓ Copied OpenClaude CLI from: ${localPath}`)
    return
  }

  // Production: download from GitHub releases
  const releaseVersion = version || await getLatestReleaseVersion()
  const downloadUrl = `${OPENCLAUDE_REPO}/releases/download/${releaseVersion}/cli.mjs`

  await downloadFile(downloadUrl, targetPath)
  console.log(`✓ Downloaded OpenClaude CLI v${releaseVersion}`)

  // Write version file
  fs.writeFileSync(
    path.join(BIN_DIR, "OPENCLAUDE_VERSION"),
    `${releaseVersion}\n${new Date().toISOString()}\n`
  )
}
```

### 3.2 package.json Scripts

```json
{
  "scripts": {
    "claude:download": "node scripts/download-claude-binary.mjs",
    "openclaude:download": "node scripts/download-openclaude-binary.mjs --local-path=C:/Users/test/Documents/Projects/oclaude",
    "postinstall": "bun run claude:download && bun run openclaude:download",
    "openclaude:download:prod": "node scripts/download-openclaude-binary.mjs --version=${OPENCLAUDE_VERSION}"
  }
}
```

### 3.3 Electron Builder Resources

```javascript
// electron.vite.config.ts
resources: [
  "resources/bin/**/*",
  "resources/bin/**/VERSION",
  "resources/bin/**/OPENCLAUDE_VERSION",
]
```

---

## Section 4: Backend Router Changes

### 4.1 Input Schema Extension

```typescript
// src/main/lib/trpc/routers/claude.ts

chat: publicProcedure
  .input(
    z.object({
      // ... existing fields
      agentType: z.enum(["claude-code", "openclaude"]).default("claude-code"),
      endpointType: z.enum(["anthropic", "openai-compatible"]).optional(),
    }),
  )
```

### 4.2 Environment Builder

```typescript
// src/main/lib/claude/env.ts

export function buildAgentEnv(options: {
  agentType: "claude-code" | "openclaude"
  endpointType?: "anthropic" | "openai-compatible"
  profile?: { baseUrl: string; token: string; models: { modelId: string }[] }
  enableTasks?: boolean
}): Record<string, string> {
  const baseEnv = buildClaudeEnv(options)

  // OpenClaude + OpenAI-compatible endpoint
  if (options.agentType === "openclaude" &&
      options.endpointType === "openai-compatible" &&
      options.profile) {
    return {
      ...baseEnv,
      CLAUDE_CODE_USE_OPENAI: "true",
      OPENAI_BASE_URL: options.profile.baseUrl,
      OPENAI_API_KEY: options.profile.token,
      OPENAI_MODEL: options.profile.models[0]?.modelId || "",
    }
  }

  // OpenClaude + Anthropic endpoint OR Claude Code - same base env
  return baseEnv
}
```

### 4.3 Spawn Logic

```typescript
// src/main/lib/trpc/routers/claude.ts (inside chat subscription)

const agentBinaryPath = input.agentType === "claude-code"
  ? getBundledClaudeBinaryPath()
  : getBundledOpenClaudeBinaryPath()

const agentEnv = buildAgentEnv({
  agentType: input.agentType,
  endpointType: input.endpointType,
  profile: finalCustomConfig,
  enableTasks: input.enableTasks,
})

// Spawn
const spawnCommand = input.agentType === "openclaude" ? "node" : agentBinaryPath
const spawnArgs = input.agentType === "openclaude"
  ? [agentBinaryPath, "--json-stream"]
  : []

const child = spawn(spawnCommand, spawnArgs, {
  env: agentEnv,
  stdio: ["pipe", "pipe", "pipe"],
})

// Rest of stream handling is IDENTICAL (shared transformer)
const transform = createTransformer({
  emitSdkMessageUuid: historyEnabled,
  isUsingOllama: input.endpointType === "openai-compatible",
})
```

---

## Section 5: Streaming Protocol (No Changes)

OpenClaude uses identical JSON streaming protocol as Claude Code. The existing `createTransformer()` handles all chunk types:

- `text-delta`, `text-start`, `text-end`
- `tool-input-start`, `tool-input-available`, `tool-output-*`
- `error`, `finish`, `start`

**No new transformer needed.** Both CLIs output the same `UIMessageChunk` format.

---

## Section 6: Frontend Transport

### 6.1 IPCChatTransport Changes

```typescript
// src/renderer/features/agents/lib/ipc-chat-transport.ts

// Read agent type from atom
const agentType = appStore.get(agentTypeAtom)

// Determine endpoint type from selected profile
const activeProfileId = appStore.get(activeProfileIdAtom)
const profiles = appStore.get(modelProfilesAtom)
const activeProfile = profiles.find(p => p.id === activeProfileId)
const endpointType = activeProfile?.endpointType || "anthropic"

// Pass to backend
trpcClient.claude.chat.subscribe({
  // ... existing params
  agentType,
  endpointType,
})
```

---

## Section 7: UI Changes

### 7.1 Settings Tab - Agent Selection

**Location:** `SettingsDialog` → `Agents` tab (or new `Beta` tab)

```tsx
// src/renderer/components/dialogs/settings-tabs/agents-settings-tab.tsx

<div className="space-y-4">
  <Label className="text-sm font-medium">Agent Type</Label>
  <RadioGroup value={agentType} onValueChange={setAgentType}>
    <div className="flex items-center space-x-2">
      <RadioGroupItem value="claude-code" id="claude-code" />
      <Label htmlFor="claude-code" className="cursor-pointer">
        Claude Code (Default)
        <span className="text-xs text-muted-foreground ml-2">
          Anthropic Claude models via official SDK
        </span>
      </Label>
    </div>
    <div className="flex items-center space-x-2">
      <RadioGroupItem value="openclaude" id="openclaude" />
      <Label htmlFor="openclaude" className="cursor-pointer">
        OpenClaude (Beta)
        <span className="text-xs text-muted-foreground ml-2">
          OpenAI-compatible endpoints: Ollama, Gemini, Together, etc.
        </span>
      </Label>
    </div>
  </RadioGroup>
</div>
```

### 7.2 Model Profile Dialog - Endpoint Type

**Location:** `CustomProfileDialog` in `agents-models-tab.tsx`

```tsx
<div className="space-y-2">
  <Label className="text-sm font-medium">Endpoint Type</Label>
  <Select value={endpointType} onValueChange={setEndpointType}>
    <SelectItem value="anthropic">
      Anthropic Messages API
    </SelectItem>
    <SelectItem value="openai-compatible">
      OpenAI-compatible (/v1, Ollama, Gemini)
    </SelectItem>
  </Select>
  {endpointType === "openai-compatible" && (
    <p className="text-xs text-orange-500">
      Requires OpenClaude agent mode
    </p>
  )}
</div>
```

### 7.3 Model Selector - Disabled Models

```tsx
// src/renderer/features/agents/components/agent-model-selector.tsx

{customProfiles.map(profile => (
  profile.models.map(model => {
    const isIncompatible =
      profile.endpointType === "openai-compatible" &&
      agentType === "claude-code"

    return (
      <CommandItem
        disabled={isIncompatible}
        className={cn(
          isIncompatible && "opacity-50 cursor-not-allowed"
        )}
      >
        <span>{model.name}</span>
        {isIncompatible && (
          <Badge variant="outline" className="ml-2 text-xs">
            OpenClaude only
          </Badge>
        )}
      </CommandItem>
    )
  })
))}
```

### 7.4 Agent Switch - Auto-clear Incompatible Profile

```typescript
// In atom setter or useEffect

if (newAgentType === "claude-code") {
  const currentProfileId = get(activeProfileIdAtom)
  const profiles = get(modelProfilesAtom)
  const currentProfile = profiles.find(p => p.id === currentProfileId)

  if (currentProfile?.endpointType === "openai-compatible") {
    // Clear profile selection
    set(activeProfileIdAtom, null)
    set(selectedCustomModelIdAtom, null)

    // Show toast
    toast.info("Profile cleared", {
      description: `"${currentProfile.name}" requires OpenClaude mode. Switched to default Claude model.`,
    })
  }
}
```

---

## Section 8: Error Handling

### 8.1 Shared Error Categories (No Changes)

Both CLIs emit identical error types - handled by existing `ERROR_TOAST_CONFIG`:
- `AUTH_FAILED_SDK`
- `INVALID_API_KEY_SDK`
- `RATE_LIMIT_SDK`
- `OVERLOADED_SDK`
- `PROCESS_CRASH`

### 8.2 New OpenAI-Compatible Errors

```typescript
// Add to ERROR_TOAST_CONFIG in ipc-chat-transport.ts

OPENAI_AUTH_FAILED: {
  title: "OpenAI authentication failed",
  description: "Check your API key or token for this endpoint.",
},
OPENAI_MODEL_NOT_FOUND: {
  title: "Model not available",
  description: "The selected model is not available at this endpoint.",
},
OPENAI_RATE_LIMIT: {
  title: "Rate limit exceeded",
  description: "This endpoint has rate limits. Wait and try again.",
},
OPENAI_CONNECTION_FAILED: {
  title: "Endpoint unreachable",
  description: "Could not connect to the endpoint. Check URL and network.",
},
OPENCLAUDE_BINARY_NOT_FOUND: {
  title: "OpenClaude CLI not found",
  description: "Run 'bun run openclaude:download' to bundle the CLI.",
  action: {
    label: "Copy command",
    onClick: () => navigator.clipboard.writeText("bun run openclaude:download"),
  },
},
NODE_NOT_FOUND: {
  title: "Node.js not found",
  description: "OpenClaude requires Node.js. Install Node or use Claude Code mode.",
},
```

### 8.3 Spawn Error Handling

```typescript
// src/main/lib/trpc/routers/claude.ts

try {
  const child = spawn(spawnCommand, spawnArgs, { env, stdio: "pipe" })
} catch (spawnError) {
  if (input.agentType === "openclaude") {
    emit.next({
      type: "error",
      errorText: "OpenClaude CLI failed to start. Check Node.js installation.",
      debugInfo: { category: "OPENCLAUDE_BINARY_ERROR" }
    })
    emit.next({ type: "finish" })
    emit.complete()
    return
  }
  // Claude Code spawn error handling (existing)
}
```

---

## Section 9: Testing & Validation

### 9.1 Validation Checkpoints

| Feature | Test | Expected Result |
|---------|------|-----------------|
| Agent switch | Toggle in settings | Atom updates, UI reflects change |
| Profile endpoint type | Select "openai-compatible" | Profile saves with flag |
| Model selector | OpenAI-compatible profile selected | Shows "(OpenClaude only)" badge when agent=claude-code |
| Auto-clear | Switch to claude-code with incompatible profile | Profile cleared, toast shown |
| OpenClaude spawn | Send message in openclaude mode | CLI spawns, JSON stream works |
| Anthropic endpoint | OpenClaude + Anthropic profile | Uses ANTHROPIC_API_KEY, same as claude-code |
| OpenAI endpoint | OpenClaude + OpenAI-compatible profile | Uses OPENAI_* env vars |
| Error handling | Kill CLI mid-stream | Error toast, stream closes gracefully |

### 9.2 Integration Test Flow

1. Install: `bun run postinstall`
   → Verify `resources/bin/{platform}-{arch}/openclaude.mjs` exists

2. Dev mode: Start app, check console
   → "[claude-binary] openclaude.mjs exists: true"

3. Settings: Switch agent → OpenClaude
   → `agentTypeAtom` = "openclaude"

4. Create profile: endpoint=openai-compatible, baseUrl=http://localhost:11434/v1
   → Profile saved with `endpointType` flag

5. Select model: Click model selector
   → OpenAI-compatible model shows, no disabled badge

6. Send message: Type "hello"
   → CLI spawns with `OPENAI_BASE_URL=http://localhost:11434/v1`
   → Response streams back

7. Switch back: agent → claude-code
   → Profile auto-cleared, toast: "Profile cleared..."

### 9.3 Manual QA Checklist

**Dev environment:**
- [ ] `bun run openclaude:download` copies from local oclaude path
- [ ] openclaude.mjs exists in resources/bin/{platform}-{arch}/
- [ ] Settings shows agent switch radio
- [ ] Profile dialog has endpoint type dropdown

**Production build:**
- [ ] `bun run build:prod` includes openclaude.mjs in resources
- [ ] App packaged with both binaries
- [ ] OpenClaude mode works without local oclaude project

**Edge cases:**
- [ ] Missing openclaude.mjs → graceful error, no crash
- [ ] Invalid OpenAI endpoint URL → connection error toast
- [ ] Switching agents mid-stream → abort handled correctly

---

## Implementation Notes

### Scope Boundaries

**Included:**
- Agent type atom and settings UI
- Endpoint type field in model profiles
- Binary download script and bundling
- Backend spawn branching
- Model selector disabled styling
- Auto-clear incompatible profile on agent switch
- OpenAI-specific error handling

**Not included (future enhancements):**
- Per-chat agent override
- Auto-detection of endpoint type from URL
- Fallback from OpenClaude to Claude Code on spawn failure
- OpenClaude CLI version checking/updates

### Breaking Changes

**None.** This is additive - Claude Code mode works identically to current behavior.

### Migration

Existing profiles without `endpointType` field → treated as `"anthropic"`.
No user action required.

---

## References

- OpenClaude repo: `C:\Users\test\Documents\Projects\oclaude`
- Claude Code SDK: `@anthropic-ai/claude-agent-sdk`
- Existing transport: `src/renderer/features/agents/lib/ipc-chat-transport.ts`
- Existing router: `src/main/lib/trpc/routers/claude.ts`
- Existing transformer: `src/main/lib/claude/transform.ts`