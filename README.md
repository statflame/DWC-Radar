# DWCRadar

Vibecoded Vencord plugin that scans servers for staff-role members and collects their IDs for DWC bulk actions.

## Features

- **Auto-scan on join:** automatically detects staff members when you join a new server and sends a notification
- **Manual scan:** scan the current server or all servers at once from the modal
- **Right-click scan:** right-click any server in the sidebar to scan it for staff
- **Invite queue:** paste a list of invite links, then join them one by one with the **Join Next** button or **Alt+A** shortcut
- **Copy DWC format:** copy all detected IDs in `?dwc add` format, ready to paste
- **Deduplication:** if the same user is staff in multiple servers, they show once with a badge indicating how many servers
- **Leave All Servers:** right-click any server to leave every server at once (respects your exclusion list)
- **Multi-language:** detects staff roles in English, Spanish, Portuguese, French, German, Italian, Dutch, and Turkish
- **Smart filtering:** automatically excludes roles containing "retired", "former", "ping", "tester", "bot", "announcement", and more
- **Bot exclusion:** bot accounts are never logged
- **Settings modal:** gear icon opens a dedicated settings screen with live keyword chips, per-field counts, and built-in exclusion reference

## Installation

Because this is not an official Vencord plugin, you must build Vencord with the plugin from source before injecting Discord.

1. Install [Node.js](https://nodejs.org/), [git](https://git-scm.com/), and [pnpm](https://pnpm.io/) if missing.

2. Clone Vencord's GitHub repository:

```
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
```

3. Navigate to the `src` folder in the cloned Vencord repository, create a new folder called `userplugins` if it doesn't already exist.

4. Download `index.tsx`, `DWCRadarPanel.tsx`, `store.ts`, and `style.css` from this repository and move them to the `userplugins/DWCRadar` folder.

5. Build Vencord and inject Discord:

```
pnpm build
pnpm inject
```

6. If built and injected successfully, follow the remaining prompt(s) and restart Discord to apply changes.

7. In Discord's Vencord plugins menu, enable the **DWCRadar** plugin.

[Official Vencord custom plugin installation guide](https://docs.vencord.dev/installing/custom-plugins/)
