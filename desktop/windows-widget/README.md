# Ascent Focus for Windows

Ascent Focus is a small native Windows companion app written in Rust and Slint. It has no embedded browser runtime and never connects directly to PostgreSQL; the website remains the source of truth for accounts, focus sessions, courses, personal tasks, and AI preferences.

## Install and use

For normal use, install the per-user `AscentFocus-Setup.exe` package, then launch **Ascent Focus** from the Start Menu. The installer writes to your user profile and does not need administrator access. Rust is not needed to run an already-built installer. A signed public installer is not published by this repository yet; the setup package can be built from source using the instructions below.

On first launch:

1. Enter your Ascent website URL and account username/password. Use `http://localhost:3000` or `http://localhost:3100` for local development, depending on how the site was started; remote servers must use HTTPS.
2. Sign in. The password is cleared from the form and is not saved. The session and CSRF tokens are stored in Windows Credential Manager; the server URL and last widget position are stored in `%APPDATA%\AscentFocus\settings.json`.
3. The compact rounded-rectangle button shows the remaining `mm:ss` timer beside the Ascent mark. When a task is active, the capsule widens slightly to show its title on one ellipsized line; the full title is available in the tooltip and accessibility description. The title comes from the synced focus session, so it returns after restarting the widget. Click the capsule to open timer controls; drag it or the panel header to reposition it. Use **Open task list** to expand Today, Courses, Mine, and AI suggestions.
4. **Work** starts a server-backed focus session and saves a snapshot of the task title in that session. **Pause**, **Resume**, and **Finish** update the same session as the website. Focus/test quests are completed by the website's tracked progress; habits and check-type quests, lessons, and personal tasks expose **Finish** when the server permits manual completion.
5. AI suggestions use the website's existing provider and cost limits, or return a deterministic local suggestion when remote AI is unavailable. Task-title sharing is off by default. Turning it on is an account-level opt-in that allows task titles to be sent to the configured provider; with it off, only task counts and focus minutes are sent.

The tray icon can restore or hide the widget, or quit the app. Closing the small panel returns to the timer pill. An expired session returns to sign-in; unsaved password data is never retained. Tasks and timer state are not optimistically reported as synced after a failed request.

## Start and stop with Make

From the repository root on Windows, run `make start` to build and launch the widget as a separate desktop process. The command returns after launch, so its terminal can be closed. Run `make stop` from the repository root to stop that widget process.

## Server setup

Deploy the website code first, then apply the database migration from the server environment:

```powershell
npm run db:migrate
```

The migration needs `DIRECT_DATABASE_URL` or a local direct `DATABASE_URL`; do not use a transaction pooler. The route handlers require the existing PostgreSQL backend and account setup. No extra database connection is opened by the desktop app.

## Build from source

Development requires Rust stable 1.88 or newer and an internet connection to download Cargo dependencies. Windows builds can use Visual Studio C++ Build Tools with the Windows SDK, or the GNU toolchain with MSYS2 UCRT64. For the no-Visual-Studio route, open PowerShell in this directory and use:

```powershell
$env:PATH = "C:\msys64\ucrt64\bin;C:\msys64\usr\bin;$env:PATH"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = "C:\msys64\ucrt64\bin\x86_64-w64-mingw32-gcc.exe"
cargo +stable-x86_64-pc-windows-gnu run
cargo +stable-x86_64-pc-windows-gnu build --release
```

If the GNU Rust toolchain is not installed yet, add it with `rustup toolchain install stable-x86_64-pc-windows-gnu`. The commands above set the MSYS2 paths only for the current PowerShell session.

To produce the per-user installer, install Inno Setup 6 and compile the release binary from the repository root:

```powershell
cargo +stable-x86_64-pc-windows-gnu build --release --manifest-path desktop\windows-widget\Cargo.toml
iscc packaging\windows.iss
```

The setup file is written to `dist\windows\AscentFocus-Setup.exe`. If `iscc` is not on `PATH`, run the `ISCC.exe` installed with Inno Setup and pass it `packaging\windows.iss`.

The first build may take a few minutes. The app uses Slint's Winit backend and software renderer rather than Chromium/WebView. Windows 11 receives a transient system backdrop when supported; the near-opaque UI remains the fallback on other systems. The installer is currently unsigned, so Windows may show its normal unknown-publisher prompt. RAM/CPU targets are not claimed until the packaged Windows app has been measured.

## Development notes

- Remote API calls use HTTPS, a bounded timeout, and redirects are disabled so session credentials are not forwarded to another host.
- Authenticated requests use the existing session cookie and CSRF checks.
- A local 25-minute display is derived from the server's elapsed focus time. While signed in, the widget checks server focus state every 30 seconds, including when paused or idle, so changes made on the website appear without manual refresh.
- The selected task title is stored with its focus session in `focus_sessions.task_title` and returned by `GET /api/focus`. It is display metadata; it does not complete or alter the task. Titles are sent to AI only when the account-level sharing preference is enabled.
- Windows Credential Manager contains the session token and CSRF token. Plain settings contain the server URL and last widget screen position.
- `desktop/windows-widget/src` contains the Rust client; `ui` contains the Slint UI and tray menu.
- The Windows package should be measured and exercised on Windows before setting a memory/CPU budget or publishing it.
