<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://veloxdb.dev/logo-dark.png](https://www.veloxdb.dev/logo-dark.svg">
    <svg alt="VeloxDB" src="https://www.veloxdb.dev/logo-dark.svg" width="520">
  </picture>
</p>

<p align="center">
  <strong>PostgreSQL, unleashed on your desktop.</strong>
</p>

<p align="center">
  <a href="https://veloxdb.com"><strong>Official Website</strong></a> ·
  <a href="#features">Features</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#development">Development</a> ·
  <a href="https://github.com/abeni16/veloxdb/releases">Releases</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/abeni16/veloxdb?style=flat-square" alt="License">
  <img src="https://img.shields.io/github/v/release/abeni16/veloxdb?style=flat-square" alt="Release">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square" alt="Platforms">
</p>

---

**VeloxDB** is a **fast, memory-efficient, developer-focused** desktop client for PostgreSQL. Connect directly to your databases — no cloud, no middleware, no telemetry. Built with performance and productivity at its core.

Watch the demo: **[veloxdb.com](https://veloxdb.com)**

---

## Why VeloxDB?

- **Fast** — Native desktop app with Rust-backed connection pooling. Zero latency from cloud proxies.
- **Memory-efficient** — Virtual scrolling for large result sets. Only loads what you see, so million-row queries stay snappy.
- **Developer-focused** — Monaco editor (the engine behind VS Code), real-time SQL linting, autocomplete from your schema, keyboard-first design, and a command palette for everything.

---

## Features

### SQL Query Workspace
- **Monaco-powered editor** with SQL syntax highlighting, autocomplete (table/column/function inference), and configurable fonts
- **Multi-tab editing** — each tab targets its own connection
- **Real-time linting** — syntax validated against your actual PostgreSQL server as you type
- **Query history** with favorites, search, and per-connection filtering
- **Results grid** with virtual scrolling, inline cell editing, and row insertion/deletion
- **EXPLAIN ANALYZE** — run and view query plans inline
- **Export** results to CSV or JSON
- **SQL formatting** — pretty-print with one keystroke

### Visual ER Diagram (Model)
- **Interactive canvas** to introspect, design, and evolve your schema visually
- **Auto-layout** — grid, topological, and Dagre-based algorithms
- **Drag-and-drop** tables from the catalog onto the canvas
- **Create relationships** by connecting columns between tables
- **Inline editing** — rename tables, change data types, add/drop columns right on the diagram
- **Index, trigger, rule, and RLS policy** management from the property inspector
- **Undo/Redo** — every change is reversible
- **Migration preview** — review generated DDL before applying to the database
- **Export** diagrams as PNG or PDF

### Connection Management
- **Multiple profiles** with host, port, database, user, and SSL settings
- **SSH tunnel support** — connect through a bastion/jump host with key or password auth
- **Credentials stored securely** in the OS keychain (macOS Keychain, Windows Credential Manager, Linux `secret-service`)
- **Health pings** — auto-detect connection drops and reconnect

### Developer Experience
- **Command palette** (`Cmd+P` / `Ctrl+P`) — search and invoke any action
- **Keyboard shortcuts** for everything — run query, format SQL, toggle sidebar, switch tabs
- **Light and dark themes** with system-follow
- **Persistent workspace** — your tabs, queries, and diagram positions survive restarts

---

## Installation

### Download (macOS, Windows, Linux)

Download the latest release from the **[Releases page](https://github.com/abeni16/veloxdb/releases)**.

**macOS (Apple Silicon):** [Download DMG](https://github.com/abeni16/veloxdb/releases/download/v0.1.0-beta.3/veloxdb_0.1.0-beta.3_aarch64.dmg)

| Platform | Package |
|----------|---------|
| macOS | `.dmg` (Apple Silicon) |
| Linux | `.AppImage` / `.deb` |
| Windows | `.msi` / `.exe` |

> **macOS note:** VeloxDB is not notarized yet. After installing, run this command to remove the quarantine flag:
> ```bash
> xattr -cr /Applications/veloxdb.app
> ```

### From Source

#### Prerequisites
- **Node.js 20+** with **pnpm**
- **Rust** (install via [rustup](https://rustup.rs))
- **PostgreSQL** (local or remote)
- **sshpass** (macOS: `brew install sshpass`, Linux: `apt install sshpass`) — only needed for SSH password auth

#### Quick Start
```bash
# Clone the repo
git clone https://github.com/abeni16/veloxdb.git
cd veloxdb

# Install frontend dependencies
pnpm install

# Start full desktop app (Tauri + React)
pnpm tauri

# Or run frontend-only in browser (no backend)
pnpm dev
```

#### Local Development Database
```bash
docker compose -f docker-compose.pg.yml up -d
# Connection: localhost:15432, user=velox, password=velox, db=veloxdb
```

---

## Architecture

```
┌─────────────────────────────────────────┐
│              React Frontend             │
│  Monaco Editor · ReactFlow · Zustand    │
│       TanStack Query · Tailwind         │
├─────────────────────────────────────────┤
│          Tauri IPC Bridge               │
├─────────────────────────────────────────┤
│           Rust Backend                  │
│  tokio-postgres · deadpool · SSH tunnel │
│  OS Keychain · Connection Pooling       │
├─────────────────────────────────────────┤
│           PostgreSQL                    │
└─────────────────────────────────────────┘
```

- **Local-first** — data flows directly from the app to your database. Nothing is routed through a web service.
- **Repository pattern** — frontend data access is abstracted behind a `VeloxDbRepository` interface, making the transport layer swappable.
- **Connection pooling** — `deadpool-postgres` manages concurrent query sessions efficiently.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **UI** | React 19, TypeScript, Tailwind CSS, shadcn/ui, Radix UI |
| **Editor** | Monaco Editor 0.55 |
| **Diagram** | ReactFlow 12, Dagre |
| **State** | Zustand, TanStack Query |
| **Desktop** | Tauri 2 |
| **Backend** | Rust, tokio-postgres, deadpool, rustls |
| **Build** | Vite 8, pnpm |
| **Tests** | Vitest |

---
<p align="center">
  <a href="https://buymeacoffee.com/abeni3ase7i" target="_blank">
    <img
      src="https://img.shields.io/badge/Support%20VeloxDB-☕%20Buy%20Me%20a%20Coffee-1f1f1f?style=for-the-badge"
      alt="Support VeloxDB"
    />
  </a>
</p>
---

## Contributing

Contributions are welcome! See **[CONTRIBUTING.md](CONTRIBUTING.md)** for:
- Development environment setup
- Project structure walkthrough
- Code style and conventions
- Pull request process
- How to report bugs and request features

---

## License

[MIT](LICENSE) © Abenezer

---

<p align="center">
  <sub>Built with Rust and TypeScript. No cloud. No tracking. Just PostgreSQL on your desktop.</sub>
</p>
