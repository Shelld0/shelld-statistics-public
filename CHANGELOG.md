# v1.0.1 — One-click Windows installer (Public Beta)

- Package optional MT5 Python bridge as separate built-in Windows EXE using PyInstaller on Windows build runner.
- Installed journal no longer requires external Node.js or Python for any feature. Auto-import still requires an installed desktop MT5 terminal.
- Prefer bundled bridge when Python field is empty; explicit developer Python path remains supported.
- Bundle and smoke-test the bridge before building NSIS Setup.exe.
- Update first launch, guides, build workflow and release checksum.
- No personal FTMO data, no database reset.
- **Source ZIP is not a Windows installer. Actual EXE must be built/tested on Windows Actions before publication.**

---

# Shelld Statistics Public Beta v1.0.0

- First clean public distribution from the v0.8.8 codebase.
- Removed FTMO account preset, login, server and computer-specific absolute paths.
- Independent `%APPDATA%/Shelld Statistics Public Beta` user-data folder, separate from private editions.
- One-time welcome screen supporting offline manual journal without MetaTrader5.
- Retains Trading Journal, Backtest, Weekly Plans, Telegram Export Studio, image editor and automatic backups.
- Compact Analytics: Long vs Short, drawdown series, model comparison; no heatmap, no R histogram.
- Windows NSIS installer workflow added for GitHub Actions, signed install requires separate publisher configuration.

**Beta status:** Build and test locally or in GitHub Actions before distribution; no bundled EXE in this source archive.
