# Contributing to VeloxDB

Thanks for your interest in contributing! VeloxDB is a desktop-native PostgreSQL client — fast, memory-efficient, and developer-focused. This guide covers everything you need to start contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)

## Code of Conduct

Be respectful, constructive, and inclusive. Treat others the way you want to be treated.

## How Can I Contribute?

- **Bug fixes** — Check the [issues](https://github.com/abeni16/veloxdb/issues) for reported bugs
- **New features** — Discuss feature ideas by opening a discussion or issue first
- **Documentation** — Improve README, code comments, or write tutorials
- **Testing** — Add tests, improve test coverage
- **Design** — UI/UX improvements, icon design, color themes

## Development Setup

### Prerequisites

```bash
# Required
Node.js 20+ (with pnpm)
Rust (install via rustup)
PostgreSQL (local or remote)

# Optional (for SSH password auth)
brew install sshpass          # macOS
sudo apt install sshpass      # Linux
```

### Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/abeni16/veloxdb.git
cd veloxdb

# 2. Install frontend dependencies
pnpm install

# 3. Start a local PostgreSQL for development
docker compose -f docker-compose.pg.yml up -d
# Connection: localhost:15432, user=velox, password=velox, db=veloxdb

# 4. Launch the desktop app
pnpm tauri

# 5. Or run frontend-only in browser (no Rust backend)
pnpm dev
```

### Useful Commands

| Command | Description |
|---------|------------|
| `pnpm dev` | Frontend-only dev server (port 3000) |
| `pnpm tauri` | Full Tauri desktop app with hot-reload |
| `pnpm tauri:build` | Production build |
| `pnpm test` | Run tests (Vitest) |
| `pnpm lint` | Run ESLint |

## Project Structure

```
veloxdb/
├── src/                          # Frontend (React + TypeScript)
│   ├── main.tsx                  # App entry point
│   ├── App.tsx                   # Root application component
│   ├── components/               # Shared UI components (shadcn/ui)
│   ├── data/                     # Data layer
│   │   ├── types.ts              # TypeScript types
│   │   ├── query-keys.ts         # TanStack Query key factory
│   │   └── repositories/         # Repository pattern for data access
│   ├── features/
│   │   ├── connections/          # Connection management
│   │   ├── queries/              # SQL query workspace
│   │   ├── model/                # Visual ER diagram workspace
│   │   ├── schema/               # Schema inspection
│   │   └── commands/             # Command palette & settings
│   └── lib/                      # Utility functions
├── src-tauri/                    # Backend (Rust + Tauri)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs               # Rust entry point
│       ├── lib.rs                # App bootstrap & IPC handler registration
│       ├── commands.rs           # All Tauri IPC command handlers
│       ├── db.rs                 # Connection pool management
│       ├── models.rs             # Rust data models
│       ├── ssh_tunnel.rs         # SSH tunnel implementation
│       └── credentials.rs        # OS keychain integration
├── docker-compose.pg.yml         # Local PostgreSQL for dev
├── vite.config.ts                # Vite bundler config
└── tailwind.config.js            # Tailwind CSS config
```

## Code Style

### TypeScript / React

- **TypeScript strict mode** — all new code must be properly typed. Avoid `any`.
- **React functional components** — use hooks, not classes.
- **Import order** — external libraries first, then internal modules.
- **File naming** — kebab-case for component files, camelCase for utilities.
- **Component files** — one component per file. Co-locate related hooks and utilities.
- **CSS** — use Tailwind utility classes. No inline styles or separate CSS files unless necessary.

### Rust

- Follow standard Rust conventions (`rustfmt`).
- All public functions should have doc comments.
- `unwrap()` is not allowed — use proper error handling.
- New commands must be registered in `lib.rs` and have corresponding frontend repository methods.

### SQL

- Keywords UPPERCASE, identifiers lowercase_snake_case.
- Use parameterized queries — never string-interpolate user input into SQL.

### General

- Write meaningful commit messages (conventional commits preferred).
- Add tests for new features and bug fixes.
- Update documentation when changing public APIs.

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`.
2. **Implement** your change following the project conventions.
3. **Test** — run `pnpm test` and `pnpm lint` before submitting.
4. **Commit** with a descriptive message following [Conventional Commits](https://www.conventionalcommits.org/).
5. **Push** your branch and open a PR against `main`.
6. **Describe** what your PR does and link any related issues.
7. **Respond** to review feedback. CI checks must pass before merge.

### PR Title Format

```
feat: add SSH tunnel support
fix: resolve query history persistence bug
docs: update installation instructions
refactor: extract connection pooling to db.rs
test: add tests for relationship validation
```

## Reporting Bugs

Open an issue with:

1. **Title** — concise description of the bug
2. **Environment** — OS, VeloxDB version, PostgreSQL version
3. **Steps to reproduce** — exact sequence of actions
4. **Expected behavior** vs **Actual behavior**
5. **Screenshots or logs** if applicable

## Feature Requests

Before opening a feature request:

1. Check if it already exists in [issues](https://github.com/abeni16/veloxdb/issues)
2. Consider whether it aligns with VeloxDB's philosophy (local-first, fast, developer-focused)

Feature request issues should describe the use case and why it benefits the project.

---

Questions? Open a [discussion](https://github.com/abeni16/veloxdb/discussions) or reach out via the [website](https://veloxdb.dev).
