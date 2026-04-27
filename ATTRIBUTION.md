# Third-party attributions

`ghidra-agent-mcp` is built on the work of many open-source projects. Each of
the following is the property of its respective owner, used under the listed
license.

## Reverse-engineering platform

- **Ghidra** — https://github.com/NationalSecurityAgency/ghidra
  Apache License 2.0. The Ghidra plugin server, decompiler, analyzers, and
  project framework are all part of Ghidra and the property of the National
  Security Agency.

## Java server dependencies

- **Gson** — https://github.com/google/gson — Apache License 2.0.

## Python MCP bridge dependencies

- **httpx** — https://www.python-httpx.org/ — BSD-3-Clause.
- **mcp / FastMCP** — https://github.com/modelcontextprotocol — MIT.

## Desktop GUI — runtime

- **Tauri 2** — https://tauri.app/ — MIT or Apache-2.0 (dual-licensed).
- **React 18** — https://react.dev/ — MIT.
- **shadcn/ui** components (Button, Card, Badge, Input, Tabs, Dialog,
  ScrollArea, Tooltip, Popover, Separator) — https://ui.shadcn.com/ — MIT.
- **Radix UI primitives** (`@radix-ui/react-dialog`, `react-tabs`, `react-popover`,
  `react-tooltip`, `react-scroll-area`, `react-slot`, `react-toggle`,
  `react-separator`) — https://www.radix-ui.com/ — MIT.
- **Tailwind CSS** — https://tailwindcss.com/ — MIT.
- **tailwindcss-animate** — MIT.
- **class-variance-authority**, **clsx**, **tailwind-merge** — MIT.
- **lucide-react** — https://lucide.dev/ — ISC.
- **react-force-graph-2d** + transitive **d3-force** — MIT.

## Desktop GUI — Rust crates

- **reqwest** — https://github.com/seanmonstar/reqwest — MIT or Apache-2.0.
- **tokio** — https://tokio.rs/ — MIT.
- **notify** — https://github.com/notify-rs/notify — Apache-2.0 or MIT.
- **serde / serde_json** — https://serde.rs/ — MIT or Apache-2.0.
- **anyhow** — MIT or Apache-2.0.

## Typography

- **IBM Plex Sans** + **IBM Plex Sans KR** + **IBM Plex Mono** —
  https://www.ibm.com/plex/ — SIL Open Font License 1.1.

## Brand mark

- The pixel-art brand mark (`gui/src/assets/brand-mark.png`) was generated
  with the [pixelforge-mcp](https://www.npmjs.com/package/pixelforge-mcp)
  Model Context Protocol server using Google Gemini image generation.
  The output is treated as a creative asset by this project but the underlying
  model and tooling licenses apply to any redistribution of the model itself.

## Container base image

- **eclipse-temurin:21-jre** — https://hub.docker.com/_/eclipse-temurin —
  the Temurin JDK is licensed under GPLv2 with the Classpath Exception.
