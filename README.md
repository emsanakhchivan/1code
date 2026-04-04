# 1Code Fork

> **This is a community-enhanced fork of [21st.dev/1Code](https://github.com/21st-dev/1code)**

A powerful, locally-focused coding agent client with enhanced features for privacy-conscious developers and advanced model management.

**Fork Version:** `v0.0.90` (upstream: `v0.0.72`)

---

## Fork Highlights

This fork extends the original 1Code with **48+ unique commits** adding significant new capabilities:

### Local Mode - Complete Offline Operation

Run 1Code without any 21st.dev backend connections. Perfect for:
- Privacy-conscious developers who want zero external API calls
- Users who only want to use their own API keys
- Teams with strict network policies

**How it works:**
- Toggle "Local Mode" in Settings → Preferences
- All cloud features (Automations, Inbox, Remote Sync) are disabled
- Works with Claude, Codex, Custom Models, and Ollama using your own keys
- "Use Locally" quick-start option in onboarding flow

---

### Token Usage Monitor Dashboard

Track your AI spending with detailed analytics:

- **Real-time token tracking** per model and per chat
- **Cost estimation** with configurable rates
- **Time-range filtering** (Today, 7 Days, 30 Days, All Time)
- **Per-model breakdown** showing input/output/cache tokens
- **Activity heatmap** for usage patterns
- **Secondary metrics:** message count, cache read/write, duration

![Monitor Tab](assets/monitor-dashboard.png)

---

### Per-SubChat Model Selection

Assign different AI models to different sub-chats within the same project:

- **Model inheritance control** - choose whether new sub-chats inherit parent's model
- **Default model for new chats** - set a preferred model globally
- **Model persistence** - selections survive chat switching
- **Custom model profiles** - configure multiple providers (OpenRouter, Together AI, etc.)

---

### Enhanced Custom Model Profiles

Configure unlimited custom AI providers:

```typescript
// Example: OpenRouter profile with multiple models
{
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  token: "your-api-key",
  models: [
    { name: "Claude 3 Opus", modelId: "anthropic/claude-3-opus" },
    { name: "GPT-4 Turbo", modelId: "openai/gpt-4-turbo" },
    { name: "Gemini Pro", modelId: "google/gemini-pro" }
  ]
}
```

**Features:**
- Multiple models per profile
- Offline/Ollama profile pre-configured
- Visibility toggle per model
- Profile validation and deletion

---

### Archived Chats with Restore

Soft-delete chats without permanent loss:

- **Archive popover** with file stats (additions/deletions)
- **Search and filter** archived conversations
- **Batch archive** multiple chats
- **Restore functionality** - unarchive when needed
- **Archive count indicator** in sidebar

---

### Chat Details & Statistics

Get insights into your conversations:

- **ChatDetailsPopover** - comprehensive statistics per chat
- **Model tags** displayed on messages
- **Agent model tag** component showing which model generated each response
- **Token usage** per message
- **Iterations tracking** and context window estimation

---

### Windows Enhancements

Better Windows support for cross-platform users:

- **Shell type selection** - Choose Bash, PowerShell, or CMD
- **Windows build workflow** - Automated CI/CD for Windows releases
- **Windows path handling** - Fixed absolute path issues in file viewer
- **VS-style file tree** - Proper folder icons and path normalization

---

### Persistent Error Handling

Better UX when things go wrong:

- **Persistent error banner** - Dismissible but remembers state
- **Error state management** - Tracks errors across all chat transports
- **Stream inactivity timeout** - Handles proxy disconnects gracefully

---

### Upgraded Codex Integration

- **GPT-5.4 Codex** as default model (upgraded from previous version)
- Better model tracking in message metadata
- Enhanced model switching UX

---

## All Original Features from 1Code

This fork maintains all features from the upstream 1Code:

### Multi-Agent Support
- Claude Code and Codex in one app
- Instant switching between agents
- Custom models and providers (BYOK)

### Visual UI
- Cursor-like desktop app
- Diff previews and real-time tool execution
- Built-in Git client with visual staging

### Git Worktree Isolation
- Each chat runs in its own isolated worktree
- Background execution support
- Branch safety - never accidentally commit to main

### Plan Mode
- Structured plans with markdown preview
- Clarifying questions before execution
- Extended thinking enabled by default

### MCP & Plugins
- Full server lifecycle management
- Plugin marketplace
- Rich tool display

### More Original Features
- Background agents (cloud sandboxes)
- Live browser previews
- Kanban board
- Chat forking
- Message queue
- Voice input
- Skills & slash commands
- Custom sub-agents
- Memory (CLAUDE.md support)
- Cross platform (macOS, Windows, Linux)

---

## Comparison: Fork vs Upstream

| Feature | Upstream (v0.0.72) | This Fork (v0.0.90) |
|---------|-------------------|---------------------|
| Local Mode | No | **Yes** |
| Token Monitor | No | **Yes** |
| Per-SubChat Models | Basic | **Advanced** |
| Archive with Restore | No | **Yes** |
| Chat Statistics | No | **Yes** |
| Windows Shell Selection | No | **Yes** |
| Persistent Errors | Basic | **Advanced** |
| Custom Model Profiles | Single model | **Multiple models per profile** |
| Codex Default | Previous | **GPT-5.4** |
| Offline Quick Start | No | **Yes** |

---

## Installation

### Build from Source (Free)

```bash
# Prerequisites: Bun, Python 3.11, setuptools
git clone https://github.com/YOUR_FORK/1codepulll.git
cd 1codepulll
bun install
bun run claude:download  # Download Claude binary
bun run codex:download   # Download Codex binary
bun run build
bun run package:mac      # or package:win, package:linux
```

> **Note:** This fork can be built completely free. Use Local Mode with your own API keys.

### Development

```bash
bun install
bun run claude:download  # First time only
bun run codex:download   # First time only
bun run dev
```

---

## Fork Changelog

### v0.0.90 (Current)
- feat(local-mode): Complete offline operation without backend APIs
- feat(monitor): Token usage analytics dashboard
- feat(models): Per-subchat model selection with inheritance control
- feat(archive): Archived chats with restore functionality
- feat(stats): Chat details popover with comprehensive statistics
- feat(windows): Shell type selection (Bash/PowerShell/CMD)
- feat(errors): Persistent error state management
- feat(codex): Upgraded to GPT-5.4 as default
- feat(models): Enhanced custom model profiles (multiple models per profile)

### Key Commits (48 total)
```
06a742d feat(sidebar): hide cloud features in local mode
4b89b09 feat(settings): add local mode toggle and account connection UI
b2af931 feat(onboarding): add "Use Locally" quick start option
6ad1f53 feat(core): add local mode infrastructure
bafcc96 feat(settings): add Monitor tab for token usage analytics
cbe010f feat(usage): add token usage analytics router
184d581 feat: Enhanced custom model profiles with multiple models
c2f8aeb feat(terminal): add shell type selection
... and 40 more
```

---

## Contributing to This Fork

We welcome contributions that align with the fork's focus:

1. **Privacy-first features** - More offline/local capabilities
2. **Model flexibility** - Support for more AI providers
3. **Windows/Linux support** - Better cross-platform experience
4. **Developer tools** - Analytics, debugging, monitoring

---

## Original Project Credits

This project is a fork of [1Code](https://github.com/21st-dev/1code) by the [21st.dev](https://21st.dev) team.

- **Original License:** Apache License 2.0
- **Original Authors:** 21st.dev team
- **Original Repository:** https://github.com/21st-dev/1code

Please support the original project by subscribing at [1code.dev](https://1code.dev) if you use cloud features.

---

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.

---

## Community & Support

- **Original Discord:** [discord.gg/8ektTZGnj4](https://discord.gg/8ektTZGnj4)
- **Fork Issues:** Open an issue in this repository for fork-specific bugs/features
- **Upstream Issues:** For core bugs, consider reporting to the original repo

---

## Quick Links

| Resource | Link |
|----------|------|
| Original Project | [1code.dev](https://1code.dev) |
| Original Repo | [github.com/21st-dev/1code](https://github.com/21st-dev/1code) |
| This Fork | Your fork URL |
| Documentation | [CLAUDE.md](CLAUDE.md) |
| Build Instructions | See Installation section |

---

> Built with love by the community. Forked from 21st.dev's excellent 1Code project.