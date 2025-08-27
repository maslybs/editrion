# Editrion (Beta)

A lightweight code editor built with Tauri and Monaco Editor. This is a Beta release.

## Features

- File explorer (sidebar)
- Multiple tabs for open files
- Multi-cursor editing
- Dark theme inspired by Monokai
- Familiar Sublime-like keybindings
- Syntax highlighting for popular languages

## Shortcuts

- `Cmd/Ctrl + S`: Save
- `Cmd/Ctrl + Shift + S`: Save As…
- `Cmd/Ctrl + D`: Add selection to next match (multi-cursor)
- `Cmd/Ctrl + Shift + L`: Select all occurrences
- `Cmd/Ctrl + W`: Close tab
- `Cmd/Ctrl + Click`: Add cursor

## Development

1) Install dependencies

```bash
npm install
```

2) Run in development (Tauri + Vite dev server)

```bash
npm run tauri dev
```

3) Build a distributable app

```bash
npm run tauri build
```

Notes:
- `dist/` is generated during build and is git-ignored.
- `tauri.conf.json` points to the built frontend via `frontendDist: "../dist"`.

## Save / Save As

- Save: `Cmd/Ctrl + S` or File → Save.
- Save As: `Cmd/Ctrl + Shift + S` or File → Save As…
  - The save dialog includes format filters.
  - If no extension is typed, a sensible default is appended (e.g. `.txt`).

## Find and Highlighting

- Open find: `Cmd/Ctrl + F`.
- As you type, previous highlights are cleared; only current matches remain.
- Whole word uses word boundaries for precise matches.

## App Icons

The project uses `src-tauri/icons/icon.png` as the single source image.

Generate platform-specific assets (run automatically on build):

```bash
npm run icons:tauri
```

This uses the Tauri CLI to create macOS `.icns`, Windows `.ico`, and Linux PNG sizes into `src-tauri/icons/`. You can still use `npm run icons` (custom script) if you prefer system tools.

macOS icon cache:
- If the built app shows an old or generic icon, macOS may be caching it.
- Remove the app from the Dock, delete any previously installed build, and reinstall.
- Launch once; the icon should update. In stubborn cases, restart Finder.

## System Requirements

- Node.js 16+
- Rust 1.60+
- Tauri CLI 2.x

## Supported File Types

- JavaScript/TypeScript
- Python
- Rust
- Go
- HTML/CSS
- JSON/YAML
- Markdown
- And more…
