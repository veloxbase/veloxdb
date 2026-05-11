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
  <sub>Built with Rust and TypeScript. No cloud. No tracking. Just PostgreSQL on your desktop.</sub>
</p>
