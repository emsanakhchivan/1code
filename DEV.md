# Geliştirme Ortamı (Development)

Projeyi lokalde çalıştırıp özellik ekleyebilir ve test edebilirsiniz. Veritabanı kurulumu **gerekmez** — uygulama ilk çalıştırmada SQLite dosyasını kendisi oluşturur. Üreticinin (1code.dev) backend’ini kullanacaksanız ekstra bir şey yapmanız gerekmez.

## Hızlı başlangıç (README ile aynı)

```bash
bun install
bun run claude:download  # İlk seferde
bun run codex:download   # İlk seferde
bun run dev
```

- Uygulama açılır; giriş yapmamışsanız login sayfası gelir.
- Veritabanı otomatik: `%APPDATA%\Agents Dev\data\agents.db` (Windows) veya `~/Library/Application Support/Agents Dev/` (macOS).
- Renderer dev server: http://localhost:5173

### Claude / Codex “zaten npm’de var” — burada da mı indirilecek?

Evet. Bu proje **kendi CLI binary’lerini** kullanır (`resources/bin/`). NPM ile global kurduğunuz Claude veya başka bir Claude CLI **farklı**; Electron uygulaması `resources/bin/{platform}/claude.exe` ve `codex.exe` dosyalarını arar. Bu yüzden `claude:download` ve `codex:download` bu repo için gerekli (ilk kurulumda bir kez yeter).

## Windows’ta native modüller (better-sqlite3, node-pty)

Kurulum sırasında **Visual Studio bulunamadı** hatası alırsanız:

1. **Build Tools for Visual Studio 2022** yükleyin:  
   https://visualstudio.microsoft.com/visual-cpp-build-tools/  
   Kurulumda **“Desktop development with C++”** workload’unu seçin.

2. Kurulumdan sonra native modülleri Electron için derleyin:
   ```bash
   bun run rebuild
   ```

İlk kurulumda rebuild’i atlamak isterseniz (VS yokken sadece bağımlılıkları almak için):

```bash
SKIP_NATIVE_REBUILD=1 bun install
```

Sonra VS’i kurup `bun run rebuild` çalıştırabilirsiniz.

### Windows build’i bilgisayarında VS kurmadan (GitHub Actions)

Projede `.github/workflows/build-windows.yml` var. Bu workflow Windows’u **GitHub’ın runner’ında** (Visual Studio kurulu) derler; senin makinede VS gerekmez.

**Not:** Branch bazında “sadece bu branch private” olmaz; **repo** public ya da private olur. Repo’yu private yaparsan tüm branch’ler sadece sen (ve eklediğin kişiler) görür. Build’i de yine Actions’tan alırsın.

#### Yeni bir branch’e deploy edip EXE indirmek

1. **Repo’yu (istersen) private yap:** GitHub’da repo → **Settings** → **General** → **Danger Zone** → **Change repository visibility** → **Make private**.
2. **Yeni branch oluştur ve push et:**
   ```bash
   git checkout -b build/windows
   git add .
   git commit -m "Add Windows build workflow"
   git push -u origin build/windows
   ```
3. **GitHub’da build’i çalıştır:** **Actions** → sol taraftan **Build Windows** → **Run workflow** → açılan menüden branch’i seç (örn. `build/windows`) → **Run workflow**.
4. **EXE’yi indir:** Aynı sayfada run bittikten sonra (yeşil tik) run’a tıkla → aşağıda **Artifacts** bölümünde **windows-build** çıkar → indir. Zip içinde NSIS installer (`.exe`) ve portable sürüm vardır.

`main` / `master` / `develop`’a push edersen build otomatik tetiklenir; diğer branch’lerde yukarıdaki gibi **Run workflow** ile manuel tetiklemen yeterli.

## AI binary’leri (claude / codex)

Agent özelliklerinin çalışması için yukarıdaki adımlarda `claude:download` ve `codex:download` çalıştırılmalı (ilk seferde yeter). Atlarsanız uygulama açılır ama agent işlevleri çalışmaz.

## Ortam değişkenleri (.env)

Proje kökündeki `.env` dosyası lokal çalıştırma içindir. Tüm değişkenler **opsiyonel**:

- `MAIN_VITE_API_URL` – Backend API (varsayılan: https://21st.dev)
- `MAIN_VITE_POSTHOG_KEY`, `VITE_POSTHOG_KEY` – Analytics (isteğe bağlı)
- `MAIN_VITE_OPENAI_API_KEY` – Sesli giriş (Whisper) için

Örnek: Kendi API’nizi kullanacaksanız `.env` içine `MAIN_VITE_API_URL=http://localhost:3000` ekleyebilirsiniz.

## Yararlı komutlar

| Komut | Açıklama |
|-------|----------|
| `bun run dev` | Electron uygulamasını development modunda başlatır |
| `bun run build` | Production build (out/) |
| `bun run db:push` | Veritabanı şemasını SQLite’a uygular (geliştirme) |
| `bun run db:studio` | Drizzle Studio ile veritabanını açar |
| `bun run ts:check` | TypeScript tip kontrolü |

## Debug logları

CLAUDE.md içindeki **Debug Mode** bölümüne bakın: `packages/debug` ile yapılandırılmış log sunucusu ve `.debug/logs.ndjson` kullanımı anlatılıyor.
