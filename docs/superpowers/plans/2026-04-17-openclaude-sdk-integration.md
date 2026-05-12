# OpenClaude SDK Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OpenClaude CLI subprocess with direct SDK import, matching Claude Code SDK integration pattern.

**Architecture:** Fix oclaude SDK gaps (env vars, session resume/fork/continue), then replace spawn calls in 1codepulll with SDK query() imports.

**Tech Stack:** TypeScript, dynamic ESM import, QueryEngine, AsyncIterable streaming

---

## File Structure

**Phase 1 (oclaude SDK fixes):**
- `oclaude/src/entrypoints/sdk.ts` - Add env, fork, continue handling to query()

**Phase 2 (1codepulll integration):**
- `src/main/lib/claude/env.ts` - Add getOpenClaudeSDK() function
- `src/main/lib/claude/index.ts` - Export getOpenClaudeSDK
- `src/main/lib/trpc/routers/claude.ts` - Replace spawn with SDK query
- `scripts/download-openclaude-binary.mjs` - Copy sdk.mjs instead of cli.mjs

---

## Phase 1: Fix oclaude SDK

### Task 1: Add `env` option handling to query()

**Files:**
- Modify: `C:/Users/test/Documents/Projects/oclaude/src/entrypoints/sdk.ts`

**Analysis:** `QueryOptions` already has `settings?: { env?: Record<string, string> }` (line 657), but query() never uses it. Add snapshot/restore pattern.

- [ ] **Step 1: Add env handling in query() function**

Find the query() function at line ~1120. After extracting options, add env handling:

```typescript
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: QueryOptions
}): Query {
  const { prompt, options = {} as QueryOptions } = params
  const {
    cwd,
    model,
    abortController,
    systemPrompt,
    settings,  // ADD THIS
  } = options

  // ... existing validation ...

  // Apply environment overrides with snapshot/restore pattern
  const envOverrides = settings?.env
  let envSnapshot: Record<string, string | undefined> = {}
  if (envOverrides && Object.keys(envOverrides).length > 0) {
    // Snapshot current values
    for (const key of Object.keys(envOverrides)) {
      envSnapshot[key] = process.env[key]
    }
    // Apply overrides
    Object.assign(process.env, envOverrides)
  }

  // ... rest of query() setup ...
```

- [ ] **Step 2: Restore env in QueryImpl async iterator**

In QueryImpl class (line ~876), the `[Symbol.asyncIterator]()` method needs to restore env after the query completes. Modify:

```typescript
async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
  // Ensure init() completes before any query runs
  await init()

  try {
    if (typeof this.prompt === 'string') {
      // Single string prompt — submit once and yield all results
      yield* this.engine.submitMessage(this.prompt)
    } else {
      // AsyncIterable<SDKUserMessage> — iterate and submit each message
      for await (const userMessage of this.prompt) {
        // Check if aborted before processing next message
        if (this.abortController.signal.aborted) break

        // Pass content directly to submitMessage
        const content = extractPromptFromUserMessage(userMessage)
        yield* this.engine.submitMessage(content, { uuid: userMessage.uuid })
      }
    }
  } finally {
    // Restore environment snapshot if we applied overrides
    if (this.envSnapshot && Object.keys(this.envSnapshot).length > 0) {
      for (const [key, origValue] of Object.entries(this.envSnapshot)) {
        if (origValue === undefined) delete process.env[key]
        else process.env[key] = origValue
      }
    }
  }
}
```

- [ ] **Step 3: Store envSnapshot in QueryImpl**

Add field to QueryImpl class and pass it from query():

```typescript
class QueryImpl implements Query {
  private engine: QueryEngine
  private prompt: string | AsyncIterable<SDKUserMessage>
  private abortController: AbortController
  private appStateStore: Store<AppState>
  private envSnapshot: Record<string, string | undefined>  // ADD THIS
  private pendingPermissionPrompts = new Map<string, {...}>()

  constructor(
    engine: QueryEngine,
    prompt: string | AsyncIterable<SDKUserMessage>,
    abortController: AbortController,
    appStateStore: Store<AppState>,
    envSnapshot: Record<string, string | undefined>,  // ADD THIS
  ) {
    this.engine = engine
    this.prompt = prompt
    this.abortController = abortController
    this.appStateStore = appStateStore
    this.envSnapshot = envSnapshot  // ADD THIS
  }
```

- [ ] **Step 4: Pass envSnapshot when creating QueryImpl**

At line ~1188 in query():

```typescript
const queryImpl = new QueryImpl(null as any, prompt, ac, appStateStore, envSnapshot)  // ADD envSnapshot
```

- [ ] **Step 5: Commit SDK env changes**

```bash
cd C:/Users/test/Documents/Projects/oclaude
git add src/entrypoints/sdk.ts
git commit -m "feat(sdk): add env option handling with snapshot/restore pattern"
```

---

### Task 2: Add `fork` option to query()

**Files:**
- Modify: `C:/Users/test/Documents/Projects/oclaude/src/entrypoints/sdk.ts`

**Analysis:** The SDK already has `forkSession()` as a standalone function. We need to wire it into `query()` so when `sessionId` + `fork: true` is passed, it forks first then starts the query.

- [ ] **Step 1: Add fork option to QueryOptions type**

At line ~630, add to QueryOptions:

```typescript
export type QueryOptions = {
  cwd: string
  model?: string
  sessionId?: string
  resume?: string
  fork?: boolean  // ADD THIS: fork the session before resuming
  // ... rest stays same
}
```

- [ ] **Step 2: Handle fork in query() function**

After the env handling, add fork logic:

```typescript
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: QueryOptions
}): Query {
  const { prompt, options = {} as QueryOptions } = params
  const {
    cwd,
    model,
    abortController,
    systemPrompt,
    settings,
    sessionId,  // ADD
    fork,       // ADD
  } = options

  if (!cwd) {
    throw new Error('query() requires options.cwd')
  }

  // Fork session if requested
  let effectiveSessionId = sessionId
  if (sessionId && fork) {
    // Fork happens synchronously before query starts
    // We need to await it, so we use a wrapper pattern
    // Note: forkSession is async, but query() must return sync
    // Solution: fork in async iterator
  }

  // ... rest stays same for now, fork handled in iterator ...
```

- [ ] **Step 3: Fork in QueryImpl iterator (async)**

Since forkSession is async but query() must return Query synchronously, we handle the fork in the async iterator:

```typescript
async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
  await init()

  // Fork session if requested (must happen before query starts)
  let sessionIdToUse = this.sessionId
  if (this.sessionId && this.forkSession) {
    try {
      const forkResult = await forkSession(this.sessionId, { dir: this.cwd })
      sessionIdToUse = forkResult.session_id
      console.log(`[sdk] Forked session ${this.sessionId} → ${sessionIdToUse}`)
    } catch (err) {
      console.error(`[sdk] Failed to fork session:`, err)
      // Fall back to using original sessionId
    }
  }

  try {
    // If we have a session to resume, load its messages into engine
    if (sessionIdToUse) {
      // Load session messages and inject into engine
      const messages = await getSessionMessages(sessionIdToUse, { dir: this.cwd })
      if (messages.length > 0) {
        // Inject messages into engine's mutableMessages
        for (const msg of messages) {
          this.engine.injectMessage(msg)
        }
      }
    }

    // Now run the query
    if (typeof this.prompt === 'string') {
      yield* this.engine.submitMessage(this.prompt)
    } else {
      for await (const userMessage of this.prompt) {
        if (this.abortController.signal.aborted) break
        const content = extractPromptFromUserMessage(userMessage)
        yield* this.engine.submitMessage(content, { uuid: userMessage.uuid })
      }
    }
  } finally {
    // Restore env
    if (this.envSnapshot && Object.keys(this.envSnapshot).length > 0) {
      for (const [key, origValue] of Object.entries(this.envSnapshot)) {
        if (origValue === undefined) delete process.env[key]
        else process.env[key] = origValue
      }
    }
  }
}
```

- [ ] **Step 4: Add fields and pass fork options**

Add to QueryImpl:

```typescript
class QueryImpl implements Query {
  private sessionId?: string      // ADD
  private forkSession?: boolean   // ADD
  private cwd: string             // ADD
  // ... existing fields ...

  constructor(
    engine: QueryEngine,
    prompt: string | AsyncIterable<SDKUserMessage>,
    abortController: AbortController,
    appStateStore: Store<AppState>,
    envSnapshot: Record<string, string | undefined>,
    sessionId?: string,           // ADD
    forkSession?: boolean,        // ADD
    cwd: string,                  // ADD
  ) {
    // ... existing assignments ...
    this.sessionId = sessionId
    this.forkSession = forkSession
    this.cwd = cwd
  }
```

Update query() to pass these:

```typescript
const queryImpl = new QueryImpl(
  null as any,
  prompt,
  ac,
  appStateStore,
  envSnapshot,
  sessionId,    // ADD
  fork,         // ADD
  cwd,          // ADD
)
```

- [ ] **Step 5: Add injectMessage to QueryEngine if needed**

Check if QueryEngine has a way to inject initial messages. It already has `initialMessages` in config. Add a method to inject after construction if needed:

```typescript
// In QueryEngine class (src/QueryEngine.ts)
injectMessage(msg: any): void {
  this.mutableMessages.push(msg)
}
```

- [ ] **Step 6: Commit fork changes**

```bash
cd C:/Users/test/Documents/Projects/oclaude
git add src/entrypoints/sdk.ts src/QueryEngine.ts
git commit -m "feat(sdk): add fork option to query() for session branching"
```

---

### Task 3: Add `continue` option to query()

**Files:**
- Modify: `C:/Users/test/Documents/Projects/oclaude/src/entrypoints/sdk.ts`

**Analysis:** `continue: true` means "find and resume the last session for this cwd". Use `listSessions()` filtered by cwd, pick most recent.

- [ ] **Step 1: Add continue option to QueryOptions**

```typescript
export type QueryOptions = {
  cwd: string
  model?: string
  sessionId?: string
  fork?: boolean
  continue?: boolean  // ADD: resume last session for this cwd
  // ...
}
```

- [ ] **Step 2: Handle continue in QueryImpl iterator**

```typescript
async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
  await init()

  let sessionIdToUse = this.sessionId

  // Handle --continue: find last session for this cwd
  if (this.continueSession && !sessionIdToUse) {
    try {
      const sessions = await listSessions({ dir: this.cwd, limit: 1 })
      if (sessions.length > 0) {
        sessionIdToUse = sessions[0].session_id
        console.log(`[sdk] Continuing session ${sessionIdToUse}`)
      }
    } catch (err) {
      console.error(`[sdk] Failed to find session for continue:`, err)
    }
  }

  // Fork if requested (same logic as Task 2)
  if (sessionIdToUse && this.forkSession) {
    // ... fork logic from Task 2 ...
  }

  // ... rest same as Task 2 ...
}
```

- [ ] **Step 3: Add continue field to QueryImpl**

```typescript
class QueryImpl implements Query {
  private continueSession?: boolean  // ADD
  // ...

  constructor(
    // ... existing params ...
    continueSession?: boolean,        // ADD
  ) {
    // ...
    this.continueSession = continueSession
  }
```

Update query() call:

```typescript
const queryImpl = new QueryImpl(
  null as any,
  prompt,
  ac,
  appStateStore,
  envSnapshot,
  sessionId,
  fork,
  cwd,
  continue,    // ADD
)
```

- [ ] **Step 4: Commit continue changes**

```bash
cd C:/Users/test/Documents/Projects/oclaude
git add src/entrypoints/sdk.ts
git commit -m "feat(sdk): add continue option to query() for last session resume"
```

---

### Task 4: Rebuild oclaude SDK

**Files:**
- Run: build command in oclaude

- [ ] **Step 1: Build SDK**

```bash
cd C:/Users/test/Documents/Projects/oclaude
bun run build
```

Expected: `dist/sdk.mjs` updated with new options

- [ ] **Step 2: Verify build output**

```bash
ls -la C:/Users/test/Documents/Projects/oclaude/dist/sdk.mjs
```

---

## Phase 2: Integrate into 1codepulll

### Task 5: Add getOpenClaudeSDK() function

**Files:**
- Modify: `src/main/lib/claude/env.ts`
- Modify: `src/main/lib/claude/index.ts`

- [ ] **Step 1: Add SDK import function to env.ts**

Add after `getBundledOpenClaudeBinaryPath()` function (around line 160):

```typescript
// Cache for OpenClaude SDK query function
let cachedOpenClaudeQuery: ((params: { prompt: string | AsyncIterable<any>; options?: any }) => AsyncIterable<any>) | null = null

/**
 * Get the OpenClaude SDK query function.
 * Dynamic import from hardcoded path in dev mode, bundled copy in production.
 */
export async function getOpenClaudeSDK(): Promise<(params: { prompt: string | AsyncIterable<any>; options?: any }) => AsyncIterable<any>> {
  if (cachedOpenClaudeQuery) return cachedOpenClaudeQuery

  const isDev = !app.isPackaged
  const sdkPath = isDev
    ? "C:/Users/test/Documents/Projects/oclaude/dist/sdk.mjs"
    : path.join(process.resourcesPath, "bin", "openclaude-sdk.mjs")

  console.log("[openclaude-sdk] Loading SDK from:", sdkPath)

  try {
    const sdk = await import(sdkPath)
    cachedOpenClaudeQuery = sdk.query
    return cachedOpenClaudeQuery
  } catch (err) {
    console.error("[openclaude-sdk] Failed to load SDK:", err)
    throw new Error(`Failed to load OpenClaude SDK from ${sdkPath}: ${err}`)
  }
}
```

- [ ] **Step 2: Export from index.ts**

Add to `src/main/lib/claude/index.ts`:

```typescript
export {
  // ... existing exports ...
  getOpenClaudeSDK,  // ADD
} from "./env"
```

- [ ] **Step 3: Commit SDK loader**

```bash
git add src/main/lib/claude/env.ts src/main/lib/claude/index.ts
git commit -m "feat: add getOpenClaudeSDK() for direct SDK import"
```

---

### Task 6: Replace openclaude spawn branch with SDK query

**Files:**
- Modify: `src/main/lib/trpc/routers/claude.ts`

**Analysis:** Replace the `if (agentType === "openclaude")` block (lines ~1194-1430) with SDK query pattern matching Claude Code branch.

- [ ] **Step 1: Import getOpenClaudeSDK at top of file**

Add import at top:

```typescript
import { getOpenClaudeSDK, buildAgentEnv, logClaudeEnv } from "../claude"
```

- [ ] **Step 2: Replace openclaude spawn branch**

Find the block starting with `if (agentType === "openclaude")` (around line 1194). Replace the entire spawn logic with:

```typescript
// 4. Spawn agent process
if (agentType === "openclaude") {
  try {
    const openClaudeQuery = await getOpenClaudeSDK()
  } catch (sdkError) {
    emitError(sdkError, "Failed to load OpenClaude SDK")
    safeEmit({ type: "finish" } as UIMessageChunk)
    safeComplete()
    return
  }

  resetInactivityTimer()

  // Build SDK query options
  const sdkOptions: {
    cwd: string
    model?: string
    permissionMode?: string
    settings?: { env: Record<string, string> }
    sessionId?: string
    fork?: boolean
    continue?: boolean
    abortController?: AbortController
  } = {
    cwd: input.cwd,
    model: resolvedModel || undefined,
    permissionMode: input.mode === "plan" ? "plan" : "default",
    settings: { env: agentEnv },
    abortController,
  }

  // Session handling: resume or continue
  if (resumeSessionId) {
    sdkOptions.sessionId = resumeSessionId
    sdkOptions.fork = true  // Fork to avoid "session in use" error
  } else {
    sdkOptions.continue = true  // Continue last session
  }

  // Create SDK stream
  const stream = openClaudeQuery({
    prompt: input.prompt,
    options: sdkOptions,
  })

  // Transform and accumulate (same logic as current code)
  let openClaudeParts: any[] = []
  let openClaudeCurrentText = ""
  let openClaudeMetadata: any = {}

  try {
    for await (const msg of stream) {
      if (abortController.signal.aborted) break
      resetInactivityTimer()

      const transformed = openClaudeTransform(msg)
      for (const t of transformed) {
        // Inject model info from config BEFORE emitting
        if (t.type === "message-metadata" && finalCustomConfig) {
          t.messageMetadata = {
            ...t.messageMetadata,
            modelId: finalCustomConfig.model,
            modelProvider: endpointType === "openai-compatible" ? "openai" : "custom",
          }
        }
        safeEmit(t)

        // Accumulate parts for DB save (same switch logic as current)
        switch (t.type) {
          case "text-delta":
            openClaudeCurrentText += t.delta
            break
          case "text-end":
            if (openClaudeCurrentText.trim()) {
              openClaudeParts.push({ type: "text", text: openClaudeCurrentText })
              openClaudeCurrentText = ""
            }
            break
          case "tool-input-available":
            openClaudeParts.push({
              type: `tool-${t.toolName}`,
              toolCallId: t.toolCallId,
              toolName: t.toolName,
              input: t.input,
              state: "call",
              startedAt: Date.now(),
            })
            break
          case "tool-output-available":
            const toolPart = openClaudeParts.find(
              (p: any) => p.toolCallId === t.toolCallId && p.state === "call"
            )
            if (toolPart) {
              toolPart.state = "result"
              toolPart.output = t.output
              toolPart.completedAt = Date.now()
            }
            break
          case "tool-output-error":
            const errorPart = openClaudeParts.find(
              (p: any) => p.toolCallId === t.toolCallId && p.state === "call"
            )
            if (errorPart) {
              errorPart.state = "error"
              errorPart.error = t.errorText
              errorPart.completedAt = Date.now()
            }
            break
          case "message-metadata":
            openClaudeMetadata = t.messageMetadata
            break
        }
      }
    }
  } catch (streamError) {
    console.error(`[openclaude] Stream error:`, streamError)
    emitError(streamError, "OpenClaude query failed")
  }

  // Flush remaining text
  if (openClaudeCurrentText.trim()) {
    openClaudeParts.push({ type: "text", text: openClaudeCurrentText })
  }

  // Inject model info from customConfig
  if (finalCustomConfig) {
    openClaudeMetadata.modelId = finalCustomConfig.model
    openClaudeMetadata.modelProvider = endpointType === "openai-compatible" ? "openai" : "custom"
  }

  // Save to DB (same logic as current on("exit") handler)
  if (openClaudeParts.length > 0) {
    try {
      const db = getDatabase()
      const assistantMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: openClaudeParts,
        metadata: openClaudeMetadata,
      }
      const finalMessages = [...messagesToSave, assistantMessage]

      db.update(subChats)
        .set({
          messages: JSON.stringify(finalMessages),
          sessionId: openClaudeMetadata.sessionId,
          streamId: null,
          updatedAt: new Date(),
        })
        .where(eq(subChats.id, input.subChatId))
        .run()

      db.update(chats)
        .set({ updatedAt: new Date() })
        .where(eq(chats.id, input.chatId))
        .run()

      // Token usage recording (same as current)
      if (openClaudeMetadata.totalTokens && openClaudeMetadata.totalTokens > 0) {
        // ... insert tokenUsage record ...
      }
    } catch (saveError) {
      console.error(`[openclaude] Failed to save messages:`, saveError)
    }
  }

  safeEmit({ type: "finish" } as UIMessageChunk)
  safeComplete()
}
```

- [ ] **Step 3: Remove spawn-related imports**

Remove unused imports: `spawn` from node:child_process if only used for openclaude. Keep if used elsewhere.

- [ ] **Step 4: Commit SDK integration**

```bash
git add src/main/lib/trpc/routers/claude.ts
git commit -m "feat: replace OpenClaude CLI spawn with direct SDK import"
```

---

### Task 7: Remove CLI-specific code

**Files:**
- Modify: `src/main/lib/claude/env.ts` - Remove getBundledOpenClaudeBinaryPath
- Modify: `scripts/download-openclaude-binary.mjs` - Update to copy SDK

- [ ] **Step 1: Remove getBundledOpenClaudeBinaryPath from env.ts**

Delete the function (lines ~107-160):

```typescript
// DELETE this entire function:
export function getBundledOpenClaudeBinaryPath(): string {
  // ... entire function body ...
}
```

Also remove the cache variables:

```typescript
// DELETE:
let cachedOpenClaudePath: string | null = null
let openClaudePathComputed = false
```

- [ ] **Step 2: Remove export from index.ts**

Remove from exports:

```typescript
export {
  // ...
  getBundledOpenClaudeBinaryPath,  // REMOVE this
  clearOpenClaudeEnvCache,         // REMOVE this
} from "./env"
```

- [ ] **Step 3: Update download script**

Modify `scripts/download-openclaude-binary.mjs` to copy SDK instead of CLI:

```javascript
// Change from cli.mjs to sdk.mjs
const sourceFile = isDev
  ? path.join(oclaudePath, "dist/sdk.mjs")  // CHANGE: was cli.mjs
  : // ... production logic ...
const targetFile = path.join(targetDir, "openclaude-sdk.mjs")  // CHANGE: was openclaude.mjs
```

- [ ] **Step 4: Commit cleanup**

```bash
git add src/main/lib/claude/env.ts src/main/lib/claude/index.ts scripts/download-openclaude-binary.mjs
git commit -m "refactor: remove CLI-specific OpenClaude code, use SDK instead"
```

---

### Task 8: Update production build

**Files:**
- `scripts/download-openclaude-binary.mjs` - Already updated in Task 7
- `package.json` - Verify scripts

- [ ] **Step 1: Verify package.json scripts**

Check that `openclaude:download` script exists:

```bash
grep -A2 "openclaude:download" package.json
```

Expected: Script that runs `scripts/download-openclaude-binary.mjs`

- [ ] **Step 2: Test download script**

```bash
bun run openclaude:download
```

Expected: Copies `sdk.mjs` to `resources/bin/openclaude-sdk.mjs`

---

## Testing

### Manual Tests

1. **New chat with OpenClaude** → verify stream, DB save, token tracking
2. **Resume existing chat** → verify session history loaded, fork works
3. **Plan mode** → verify permission restrictions applied
4. **Custom model (OpenAI-compatible)** → verify env vars passed, model used
5. **Cancel mid-stream** → verify abort works, DB state consistent
6. **Error cases** → verify auth errors, network errors handled

### Integration Tests

Run the app and test each agent type:

```bash
bun run dev
```

Test in UI:
1. Create new chat, select OpenClaude agent
2. Send message, verify response stream
3. Resume chat, verify history
4. Switch to plan mode, test restrictions
5. Cancel during response, verify cleanup