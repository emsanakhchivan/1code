# OpenClaude SDK Integration Design

**Date:** 2026-04-17
**Status:** Approved
**Scope:** Replace OpenClaude CLI subprocess with direct SDK import

## Problem

The 1codepulll Electron app currently spawns OpenClaude as a CLI subprocess (`node dist/cli.mjs`) with command-line arguments. This is fragile, requires cwd hacks in dev mode, and diverges from how Claude Code SDK is integrated (direct `import` + `query()`).

The oclaude project already has a fully implemented SDK at `src/entrypoints/sdk.ts` (builds to `dist/sdk.mjs`), but it has gaps that prevent direct use.

## Solution

**Phase 1:** Fix oclaude SDK gaps (env vars, session resume/continue).
**Phase 2:** Replace CLI spawn with SDK `query()` import in 1codepulll.

## Phase 1: oclaude SDK Fixes

### 1.1 Add `env` option to QueryOptions

**File:** `oclaude/src/entrypoints/sdk.ts`

Add `env?: Record<string, string>` to `QueryOptions` interface. The SDK's query engine init must merge these into the process environment for the duration of the query, restoring originals after.

Pattern (inside query() function, scoped to single query execution):
```typescript
// Snapshot only the keys we're about to override
const snapshot: Record<string, string | undefined> = {}
for (const key of Object.keys(options.env)) {
  snapshot[key] = process.env[key]
}
// Apply overrides
Object.assign(process.env, options.env)
try {
  // ... run query engine, yield messages
} finally {
  // Restore originals
  for (const [key, origValue] of Object.entries(snapshot)) {
    if (origValue === undefined) delete process.env[key]
    else process.env[key] = origValue
  }
}
```

Note: If multiple concurrent OpenClaude queries are expected, consider a per-query environment context instead of mutating `process.env`. For now, 1codepulll processes one query at a time per subchat, so snapshot/restore is sufficient.

### 1.2 Add session resume options to query()

Add to QueryOptions:
- `sessionId?: string` - Resume an existing session by ID
- `fork?: boolean` - When resuming, fork to a new session (avoids "session in use" error)
- `continue?: boolean` - Continue the most recent conversation

Wire these into the query engine initialization. When `sessionId` is set, load that session's history. When `fork` is true, create a forked copy. When `continue` is true, find and resume the last session.

### 1.3 Verify message format parity

The SDK's AsyncIterable must yield the same message types as CLI stream-json:
- `type: "system"` with `subtype: "init"` (MCP servers, tools, model info)
- `type: "assistant"` with `message.content` (text blocks, tool_use blocks)
- `type: "user"` with `message.content` (tool_result blocks)
- `type: "result"` with usage, session_id, cost
- `type: "stream_event"` with streaming events (content_block_start/delta/stop)

Verify and fix any format differences.

## Phase 2: 1codepulll Integration

### 2.1 Replace `getBundledOpenClaudeBinaryPath()` with `getOpenClaudeSDK()`

**File:** `src/main/lib/claude/env.ts`

Replace the CLI binary path function with an SDK dynamic import:

```typescript
let cachedOpenClaudeQuery: any = null

export async function getOpenClaudeSDK(): Promise<Function> {
  if (cachedOpenClaudeQuery) return cachedOpenClaudeQuery

  const isDev = !app.isPackaged
  const sdkPath = isDev
    ? "C:/Users/test/Documents/Projects/oclaude/dist/sdk.mjs"
    : path.join(process.resourcesPath, "bin", "openclaude-sdk.mjs")

  const sdk = await import(sdkPath)
  cachedOpenClaudeQuery = sdk.query
  return cachedOpenClaudeQuery
}
```

Export this from `src/main/lib/claude/index.ts`.

### 2.2 Replace openclaude spawn branch

**File:** `src/main/lib/trpc/routers/claude.ts`

Replace the `if (agentType === "openclaude")` block (lines ~1194-1430) with SDK query:

```typescript
if (agentType === "openclaude") {
  const openClaudeQuery = await getOpenClaudeSDK()

  resetInactivityTimer()

  const stream = openClaudeQuery({
    prompt: input.prompt,
    options: {
      cwd: input.cwd,
      model: resolvedModel || undefined,
      permissionMode: input.mode === "plan" ? "plan" : "default",
      env: agentEnv,
      ...(resumeSessionId
        ? { sessionId: resumeSessionId, fork: true }
        : { continue: true }),
      abortController,
    }
  })

  // Reuse the same transform and accumulation logic
  // (already works with SDK message types - same format as CLI stream-json)
  for await (const msg of stream) {
    if (abortController.signal.aborted) break
    resetInactivityTimer()

    const transformed = openClaudeTransform(msg)
    for (const t of transformed) {
      // Inject model info (same as current code)
      if (t.type === "message-metadata" && finalCustomConfig) {
        t.messageMetadata = {
          ...t.messageMetadata,
          modelId: finalCustomConfig.model,
          modelProvider: endpointType === "openai-compatible" ? "openai" : "custom",
        }
      }
      safeEmit(t)
      // ... accumulate parts for DB save (same switch logic)
    }
  }
}
```

### 2.3 Remove CLI-specific code

- Remove `spawn("node", cliArgs)` call
- Remove `childProcess.stdout/stderr/on("exit")` handlers
- Remove `CLAUDE_CODE_CWD` env var injection
- Remove `spawnCwd` dev-mode hack (oclaude project path as cwd)
- Remove `getBundledOpenClaudeBinaryPath()` function
- Keep `buildAgentEnv()` - still needed to build the env object for SDK

### 2.4 Update binary download script

**File:** `scripts/download-openclaude-binary.mjs`

Change from copying `dist/cli.mjs` to copying `dist/sdk.mjs` as `openclaude-sdk.mjs` into resources.

### 2.5 Unify the openclaude branch with claude-code branch pattern

Both branches should now follow the same pattern:
1. Get SDK query function (dynamic import, cached)
2. Call query(options) → AsyncIterable
3. Transform messages through createTransformer()
4. Accumulate parts for DB save
5. Handle errors consistently

## What Stays the Same

- `createTransformer()` - handles both SDK message formats identically
- `buildAgentEnv()` - still builds env vars, now passed via SDK `env` option
- DB save logic, token tracking, inactivity timer
- Abort/cancel via `abortController.abort()`
- All UI/frontend code

## Files Changed

| File | Change |
|------|--------|
| `oclaude/src/entrypoints/sdk.ts` | Add env, sessionId, fork, continue options |
| `src/main/lib/claude/env.ts` | Replace getBundledOpenClaudeBinaryPath with getOpenClaudeSDK |
| `src/main/lib/claude/index.ts` | Export getOpenClaudeSDK |
| `src/main/lib/trpc/routers/claude.ts` | Replace spawn branch with SDK query |
| `scripts/download-openclaude-binary.mjs` | Copy sdk.mjs instead of cli.mjs |

## Testing

1. New chat with OpenClaude agent → verify stream, DB save, token tracking
2. Resume existing chat → verify session history loaded, fork works
3. Plan mode → verify permission restrictions applied
4. Custom model (OpenAI-compatible) → verify env vars passed, model used
5. Cancel mid-stream → verify abort works, DB state consistent
6. Error cases → verify auth errors, network errors handled
