# OpenClaude Desktop App Design

## Summary

Add a professional desktop app to oclaude using Tauri v2 with React frontend. The CLI runs as a sidecar process, providing all CLI features plus desktop-specific capabilities (file picker, notifications, deep links, auto-updater).

**Key Decisions:**
- **Purpose**: CLI + Desktop features (all CLI capabilities plus desktop enhancements)
- **Framework**: React (preserve existing oclaude codebase)
- **Runtime**: Tauri v2 (primary), Electron (backup if issues)
- **Structure**: Single package (src-desktop subdirectory)
- **Approach**: Sidecar CLI + Platform Abstraction (adapted from opencode's Tauri implementation)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Desktop App                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │  React UI   │◄──►│  Platform   │◄──►│Tauri Plugins│ │
│  │  (Vite)     │    │ Abstraction │    │ (APIs)      │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
│         │                  │                           │
│         ▼                  ▼                           │
│  ┌─────────────┐    ┌─────────────┐                   │
│  │  IPC Layer  │◄──►│ Rust Backend│                   │
│  └─────────────┘    └─────────────┘                   │
│                            │                           │
│                            ▼                           │
│                    ┌─────────────┐                     │
│                    │ CLI Sidecar │                     │
│                    │ (Node.js)   │                     │
│                    └─────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

### Key Components

1. **React UI** - Desktop frontend using Vite + React
2. **Platform Abstraction** - Unified API for desktop features (adapted from opencode)
3. **Tauri Plugins** - File dialogs, notifications, updater, deep links, clipboard
4. **IPC Layer** - Communication between Rust backend and React frontend
5. **CLI Sidecar** - oclaude CLI bundled as executable, running as subprocess

---

## Directory Structure

```
oclaude/
├── src/                        # Existing CLI code (unchanged)
│   ├── ...
│
├── src-desktop/                # NEW: Desktop app
│   ├── src-tauri/              # Rust backend
│   │   ├── src/
│   │   │   ├── main.rs         # Entry point
│   │   │   ├── commands.rs     # Tauri commands (IPC)
│   │   │   └── sidecar.rs      # CLI sidecar management
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json     # Tauri config
│   │   └── capabilities/       # Tauri v2 permissions
│   │
│   ├── src/                    # React frontend
│   │   ├── index.tsx           # Entry point
│   │   ├── App.tsx             # Main app component
│   │   ├── platform.ts         # Platform abstraction
│   │   ├── components/
│   │   │   ├── SessionView.tsx # Conversation display
│   │   │   ├── ToolPanel.tsx   # Tool execution UI
│   │   │   └── FilePicker.tsx  # Native file picker
│   │   └── hooks/
│   │       ├── useSession.ts   # Session state management
│   │       └── useSidecar.ts   # Sidecar communication
│   │
│   ├── index.html              # HTML entry
│   ├── vite.config.ts          # Vite config
│   └── package.json            # Desktop scripts
│
├── bin/
│   └── openclaude              # CLI (bundled as sidecar)
│
├── package.json                # Root package (with desktop scripts)
└── bun.lock
```

---

## Platform Abstraction

The Platform interface provides unified access to desktop features. Adapted from opencode's implementation.

```typescript
interface Platform {
  platform: 'desktop';
  os: 'windows' | 'macos' | 'linux' | undefined;
  version: string;

  // File operations (Tauri dialog plugin)
  openDirectoryPickerDialog(opts?: PickerOptions): Promise<string | null>;
  openFilePickerDialog(opts?: PickerOptions): Promise<string | string[] | null>;
  saveFilePickerDialog(opts?: SaveOptions): Promise<string | null>;

  // System operations
  openLink(url: string): void;
  openPath(path: string, app?: string): void;

  // Storage (Tauri store plugin)
  storage(name?: string): AsyncStorage;

  // Updates (Tauri updater plugin)
  checkUpdate(): Promise<UpdateResult>;
  update(): Promise<void>;
  restart(): Promise<void>;

  // Notifications (Tauri notification plugin)
  notify(title: string, description?: string, href?: string): Promise<void>;

  // Clipboard (Tauri clipboard-manager plugin)
  readClipboardImage(): Promise<File | null>;

  // Deep links (Tauri deep-link plugin)
  getDeepLinks(): string[];

  // Sidecar management
  startSidecar(): Promise<void>;
  stopSidecar(): Promise<void>;
  sendToSidecar(message: any): Promise<any>;
}

interface PickerOptions {
  multiple?: boolean;
  title?: string;
  extensions?: string[];
}

interface UpdateResult {
  updateAvailable: boolean;
  version?: string;
}
```

---

## Tauri Configuration

### Plugins Required

| Plugin | Purpose |
|--------|---------|
| `clipboard-manager` | Clipboard image support |
| `deep-link` | `openclaude://` protocol |
| `dialog` | Native file/directory picker |
| `notification` | Desktop notifications |
| `opener` | Open URLs/files in system apps |
| `os` | OS detection (windows/macos/linux) |
| `process` | Process management, relaunch |
| `shell` | Sidecar execution |
| `store` | Persistent storage |
| `updater` | Auto-update |
| `http` | HTTP requests with proxy support |
| `window-state` | Save/restore window position |

### tauri.conf.json

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "OpenClaude",
  "identifier": "com.openclaude.desktop",
  "version": "../package.json",
  "build": {
    "beforeDevCommand": "bun run dev:ui",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build:ui",
    "frontendDist": "../dist"
  },
  "bundle": {
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns", "icons/icon.ico"],
    "active": true,
    "targets": ["deb", "rpm", "dmg", "nsis", "app"],
    "externalBin": ["sidecars/openclaude-cli"]
  },
  "plugins": {
    "deep-link": { "schemes": ["openclaude"] },
    "shell": { "sidecar": true }
  }
}
```

---

## IPC Commands (Rust)

```rust
// Sidecar management
#[tauri::command]
fn start_sidecar(app: AppHandle) -> Result<ServerInfo, String>;

#[tauri::command]
fn stop_sidecar() -> Result<(), String>;

#[tauri::command]
fn send_to_sidecar(message: String) -> Result<String, String>;

// File operations
#[tauri::command]
fn open_path(path: String, app: Option<String>) -> Result<(), String>;

// WSL support (Windows)
#[tauri::command]
fn wsl_path(path: String, mode: String) -> Result<String, String>;

#[tauri::command]
fn get_wsl_config() -> Result<WslConfig, String>;

// Updates
#[tauri::command]
fn check_update() -> Result<UpdateInfo, String>;

#[tauri::command]
fn install_update() -> Result<(), String>;
```

---

## Data Flow

### User Query Flow

```
User Input → SessionView → useSession hook → platform.sendToSidecar
           → Tauri command → Rust backend → CLI sidecar (stdin/stdout or socket)
           → CLI processes → Response → Rust → Tauri → React → UI update
```

### Deep Link Flow

```
openclaude://open?session=123 → Tauri deep-link plugin
                               → Platform.getDeepLinks()
                               → App opens session
```

### File Picker Flow

```
User clicks "Add Directory" → platform.openDirectoryPickerDialog()
                            → Tauri dialog plugin (native dialog)
                            → Path returned to React
                            → Add to session context
```

---

## Error Handling

### Error Types

| Type | Description | Recovery |
|------|-------------|----------|
| `sidecar-start` | CLI failed to start | Retry 3 times, show error dialog |
| `ipc` | IPC communication failed | Reconnect, retry with backoff |
| `session` | Session error from CLI | Show error in UI, offer restart |
| `network` | Network connectivity issue | Retry with exponential backoff |

### Recovery Strategy

```typescript
const errorHandlers = {
  'sidecar-start': async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await startSidecar();
        return;
      } catch (e) {
        if (i === 2) showFatalErrorDialog('CLI failed to start');
      }
    }
  },
  'ipc': async () => {
    await reconnectIPC();
    retryWithBackoff(3, 1000);
  },
  'network': async () => {
    exponentialBackoff(5, 1000, 30000);
  },
};
```

---

## WSL Support

For Windows users with WSL:

```typescript
// Platform abstraction handles WSL path conversion
async openDirectoryPickerDialog(opts) {
  const wslHome = await getWslHome();
  const result = await open({ directory: true, defaultPath: wslHome });
  return handleWslPicker(result); // Convert to WSL path if needed
}

async handleWslPicker(result) {
  if (!window.__OPENCLAUDE__?.wsl) return result;
  return commands.wslPath(result, 'linux');
}
```

---

## Deep Links

Supported protocols:
- `openclaude://open?session=<id>` - Open existing session
- `openclaude://file?path=<path>` - Open file in context
- `openclaude://dir?path=<path>` - Open directory in context

---

## Auto-Updater

- Uses `tauri-plugin-updater`
- Checks on startup (configurable)
- Downloads in background
- Kills sidecar before update
- Prompts user to install
- Auto-relaunches after update

---

## Build Targets

| Platform | Formats |
|----------|---------|
| macOS | `.dmg`, `.app` |
| Windows | `.exe` (NSIS installer) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Bundle size estimate: 15-25MB (including CLI sidecar)

---

## Package Scripts Additions

```json
{
  "scripts": {
    "dev:desktop": "cd src-desktop && bun run dev && tauri dev",
    "dev:desktop:ui": "cd src-desktop && bun run dev",
    "build:desktop": "cd src-desktop && bun run build && tauri build",
    "build:desktop:ui": "cd src-desktop && bun run build",
    "tauri": "tauri"
  }
}
```

---

## Testing Strategy

### Unit Tests
- `src-desktop/src/platform.test.ts` - Platform abstraction logic
- `src-desktop/src/hooks/*.test.ts` - React hooks
- `src-desktop/src-tauri/src/*.rs` - Rust backend tests

### Integration Tests
- Sidecar communication (IPC layer)
- File picker integration
- Deep link handling

### E2E Tests
- Full session flow (user input → response)
- Update flow
- WSL integration (Windows)

---

## Dependencies

### Tauri Plugins

```toml
# Cargo.toml
[dependencies]
tauri = { version = "2", features = ["devtools"] }
tauri-plugin-clipboard-manager = "2"
tauri-plugin-deep-link = "2"
tauri-plugin-dialog = "2"
tauri-plugin-notification = "2"
tauri-plugin-opener = "2"
tauri-plugin-os = "2"
tauri-plugin-process = "2"
tauri-plugin-shell = "2"
tauri-plugin-store = "2"
tauri-plugin-updater = "2"
tauri-plugin-http = "2"
tauri-plugin-window-state = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

### React Dependencies

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-clipboard-manager": "~2",
    "@tauri-apps/plugin-deep-link": "~2",
    "@tauri-apps/plugin-dialog": "~2",
    "@tauri-apps/plugin-notification": "~2",
    "@tauri-apps/plugin-opener": "^2",
    "@tauri-apps/plugin-os": "~2",
    "@tauri-apps/plugin-process": "~2",
    "@tauri-apps/plugin-shell": "~2",
    "@tauri-apps/plugin-store": "~2",
    "@tauri-apps/plugin-updater": "~2",
    "@tauri-apps/plugin-http": "~2",
    "@tauri-apps/plugin-window-state": "~2",
    "react": "^19",
    "react-dom": "^19",
    "@tanstack/react-query": "^5"
  }
}
```

---

## Reference Implementation

This design adapts opencode's Tauri implementation (`packages/desktop`) for oclaude:
- Platform abstraction pattern: `packages/desktop/src/index.tsx`
- Tauri plugins usage: `packages/desktop/src-tauri/tauri.conf.json`
- Sidecar management: Rust commands pattern
- Deep links: `@tauri-apps/plugin-deep-link`
- WSL support: Path conversion commands

---

## Backup Plan: Electron

If Tauri proves problematic (Rust issues, plugin compatibility, etc.), fallback to Electron:

- Use `electron-vite` for build
- `electron-builder` for packaging
- Node.js main process (no Rust)
- Same architecture: CLI sidecar + Platform abstraction
- Reference: opencode's `packages/desktop-electron`

Trade-off: Bundle size ~150MB vs ~20MB, but no Rust requirement.