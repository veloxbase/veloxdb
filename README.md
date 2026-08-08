<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.veloxdb.dev/logo-dark.svg">
    <img alt="VeloxDB" src="https://www.veloxdb.dev/logo-dark.svg" width="200">
  </picture>
</p>

<p align="center">
  <strong>Databases, unleashed on your desktop.</strong>
</p>

<p align="center">
  <a href="https://veloxdb.dev"><strong>Official Website</strong></a> ·
  <a href="#features">Features</a> ·
  <a href="#supported-databases">Databases</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="https://github.com/abeni16/veloxdb/releases">Releases</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/abeni16/veloxdb?style=flat-square" alt="License">
  <img src="https://img.shields.io/github/v/release/abeni16/veloxdb?style=flat-square" alt="Release">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square" alt="Platforms">
</p>

---

**VeloxDB** is a **fast, memory-efficient, developer-focused** desktop client for **PostgreSQL, MySQL, SQLite, DuckDB, MongoDB, and Redis**. Connect directly to your databases — no cloud, no middleware, no telemetry. Built with performance and productivity at its core.

Watch the demo: **[veloxdb.dev](https://veloxdb.dev)**

---

## Why VeloxDB?

- **Multi-Engine Support** — One unified client for relational SQL (PostgreSQL, MySQL, SQLite, DuckDB), document stores (MongoDB), and key-value caches (Redis).
- **Fast** — Native desktop application powered by Rust and Tauri 2. Direct database connections with zero latency from cloud proxies.
- **Memory-Efficient** — Virtual scrolling for massive result sets. Only loads what's visible on screen so million-row queries stay fast and responsive.
- **Developer-Focused** — Monaco editor (the engine behind VS Code), schema-aware autocomplete, multi-tab workspace, keyboard-first design, command palette, and visual ER modeling.

---

## Supported Databases

| Engine | Type | Driver / Connection | Supported Features |
|--------|------|-------------------|-------------------|
| **PostgreSQL** | Relational | Native `tokio-postgres`, `deadpool-postgres` | Full SQL workspace, ER Diagrams, EXPLAIN ANALYZE, SSL/TLS, SSH Tunnel, Keychain |
| **MySQL** | Relational | `sqlx` (MySQL driver) | SQL workspace, ER Diagrams, SSL/TLS, SSH Tunnel, Keychain |
| **SQLite** | Embedded SQL | `sqlx` (SQLite driver) | File picker, SQL workspace, ER Diagrams, Keychain |
| **DuckDB** | Analytical SQL | `duckdb` (bundled native driver) | File picker, analytical SQL workspace, query execution, Keychain |
| **MongoDB** | Document | `mongodb` (native Rust driver) | Document querying, SRV connection string support, SSH Tunnel, Keychain |
| **Redis** | Key-Value / In-Memory | `redis` (tokio async driver) | DB index selection, command execution, Keychain |

---

## Features

### Multi-Tab SQL & Query Workspace
- **Monaco-Powered Editor** — Syntax highlighting, schema-aware autocomplete (table/column/function inference), and configurable font settings (JetBrains Mono built-in).
- **Multi-Tab Workspace** — Open multiple query tabs, each independently attached to any connected database engine.
- **Real-Time Linting** — Syntax validated live against your database server as you type.
- **Query History & Favorites** — Per-connection query history with full-text search, filtering, and starred snippets.
- **Virtual Results Grid** — Instant rendering of large result sets via virtual scrolling, inline cell editing, row insertion, and row deletion.
- **EXPLAIN ANALYZE** — Run and view query execution plans inline with visual node breakdowns.
- **Export Capabilities** — Export query results to CSV, JSON, PDF, or SVG.
- **SQL Formatting** — One-keystroke SQL pretty-printing powered by `sql-formatter`.

### Visual ER Diagram (Model Workspace)
- **Interactive Canvas** — Introspect, design, and evolve schemas visually with ReactFlow 12.
- **Auto-Layout** — Grid, topological, and Dagre-based graph layout algorithms.
- **Drag-and-Drop** — Drag tables directly from the schema catalog onto the diagram canvas.
- **Visual Relationships** — Connect table columns visually to define foreign key relationships.
- **Inline Schema Editing** — Rename tables, alter data types, and add/drop columns directly on the diagram.
- **Advanced Metadata Inspector** — Manage indexes, triggers, rules, and RLS (Row-Level Security) policies.
- **Migration Preview & DDL Export** — Review generated DDL scripts before executing changes against your database.
- **Export Diagrams** — Save visual diagrams as high-resolution PNG or PDF files.

### Connection Management & Security
- **Multi-Engine Profiles** — Configure profiles for PostgreSQL, MySQL, SQLite, DuckDB, MongoDB, and Redis.
- **SSH Tunneling** — Connect through bastion/jump hosts with public key or password authentication.
- **SSL/TLS Modes** — Configure SSL requirements (Disable, Prefer, Require) with custom CA certificates.
- **OS Keychain Integration** — Credentials stored securely in native operating system keychains (macOS Keychain, Windows Credential Manager, Linux Secret Service via `secret-service`).
- **Connection Health & Auto-Reconnect** — Background pings automatically detect drops and transparently reconnect.

### Developer Experience
- **Command Palette** (`Cmd+P` / `Ctrl+P`) — Search and execute any command or navigate workspace views instantly.
- **Keyboard-First Design** — Configurable shortcuts for running queries, formatting SQL, toggling sidebars, and switching tabs.
- **Themes & Styling** — Sleek dark and light modes with automatic OS system preference matching.
- **Internationalization (i18n)** — Built-in localization support via `i18next`.
- **Persistent Workspace State** — Restores open tabs, query drafts, active connections, and diagram layouts on launch.

---

## Installation

### Download (macOS, Windows, Linux)

Download pre-built installers for the latest release (**v0.3.1**) on the **[Releases Page](https://github.com/abeni16/veloxdb/releases)**.

| Platform | Package | Download Link |
|----------|---------|---------------|
| **macOS** | `.dmg` / `.app` | [Download macOS Release](https://github.com/abeni16/veloxdb/releases) |
| **Linux** | `.AppImage` / `.deb` | [Download Linux Release](https://github.com/abeni16/veloxdb/releases) |
| **Windows** | `.msi` / `.exe` | [Download Windows Release](https://github.com/abeni16/veloxdb/releases) |

> **macOS Note:** If macOS shows a quarantine warning when opening the app, run the following command to lift the quarantine flag:
> ```bash
> xattr -cr /Applications/veloxdb.app
> ```

---

## Building From Source

### Prerequisites
- **Node.js 20+** and **pnpm 10+**
- **Rust 1.77+** (install via [rustup](https://rustup.rs))
- **PostgreSQL / MySQL / SQLite / MongoDB / Redis** (local or remote instance for testing)
- **sshpass** *(optional)* — required only for SSH tunneling with password authentication (`brew install sshpass` on macOS, `apt install sshpass` on Linux)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/abeni16/veloxdb.git
cd veloxdb

# 2. Install dependencies
pnpm install

# 3. Launch full desktop application (Tauri + React + Rust)
pnpm tauri

# 4. Or run frontend-only preview in browser (mock/web repository)
pnpm dev
```

### Local Development Database (Docker)

Spin up a local PostgreSQL test instance using Docker Compose:

```bash
docker compose -f docker-compose.pg.yml up -d
# Connection: host=localhost, port=15432, user=velox, password=velox, db=veloxdb
```

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                     React 19 Frontend                  │
│   Monaco Editor · ReactFlow 12 · Zustand 5 · i18next   │
│       TanStack Query v5 · Tailwind CSS v4 · Radix      │
├────────────────────────────────────────────────────────┤
│                    Tauri 2 IPC Bridge                  │
├────────────────────────────────────────────────────────┤
│                      Rust Backend                      │
│   ┌───────────────┬─────────────┬───────────┬──────┐   │
│   │ tokio-postgres│    sqlx     │   duckdb  │mongo │   │
│   │   (Postgres)  │(MySQL/SQLite│ (DuckDB)  │(Mongo│   │
│   └───────────────┴─────────────┴───────────┴──────┘   │
│       deadpool-postgres · redis-rs · SSH Tunnel        │
│       OS Keychain (keyring) · Connection Pooling       │
├────────────────────────────────────────────────────────┤
│           Target Databases (Local / Cloud / SSH)       │
└────────────────────────────────────────────────────────┘
```

- **Local-First Architecture** — Direct connection between the desktop client and your database. Zero telemetry, zero web proxy routing.
- **Repository Pattern** — Frontend data access is abstracted behind a clean transport layer (`VeloxDbRepository`), enabling seamless operation in both native desktop (Tauri IPC) and browser preview environments.
- **Extensible Engine Drivers** — Rust backend employs specialized engine modules under `src-tauri/src/engines/` (`postgres`, `mysql`, `sqlite`, `duckdb`, `mongo`, `redis`) for high-performance, type-safe database communication.

---

## Tech Stack

| Layer | Technologies & Libraries |
|-------|--------------------------|
| **UI Framework** | React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Radix UI, Phosphor Icons |
| **Code Editor** | Monaco Editor 0.55 (`@monaco-editor/react`) |
| **Diagram Engine** | ReactFlow 12 (`@xyflow/react`), Dagre graph layout |
| **State Management** | Zustand 5, TanStack Query v5 |
| **Data Grid & Virtualization** | TanStack Virtual 3, TanStack Table 8 |
| **Desktop Framework** | Tauri 2 |
| **Backend & Drivers** | Rust, `tokio-postgres`, `sqlx`, `duckdb`, `mongodb`, `redis`, `deadpool-postgres`, `rustls` |
| **Build & Bundler** | Vite 8, pnpm 10 |
| **Internationalization** | i18next, react-i18next |
| **Testing** | Vitest |

---

## Star History

<a href="https://www.star-history.com/?repos=abeni16%2Fveloxdb&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=abeni16/veloxdb&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=abeni16/veloxdb&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=abeni16/veloxdb&type=date&legend=top-left" />
 </picture>
</a>

---

## 💖 Sponsors

Thanks to these amazing people who support VeloxDB!

<!-- sponsors --><!-- sponsors -->

<p align="center">
  <a href="https://github.com/sponsors/abeni16">
    <img src="https://img.shields.io/badge/Sponsor-❤-red?style=for-the-badge" alt="Sponsor VeloxDB"/>
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
  <sub>Built with Rust and TypeScript. No cloud. No tracking. Just fast database tooling on your desktop.</sub>
</p>

