# brain-mcp

A small MCP (Model Context Protocol) server that gives Claude — or any MCP-aware client — read/write access to an Obsidian vault, plus opinionated tools for orienting at the start of a session and writing a handoff note at the end.

It is meant to be your "second brain" surface for Claude: project context bundles live in your vault, session notes accumulate over time, and a fresh session can pick up exactly where the last one ended.

## What it does

Six tools, all operating against folders inside a configured Obsidian vault:

| Tool | Purpose |
|------|---------|
| `read_note` | Read a single note by path |
| `write_note` | Create or overwrite a note |
| `list_notes` | List markdown notes in a folder |
| `search_notes` | Plain substring search across the vault |
| `start_session` | Bundle the project's `context-bundles/<project>.md` with the most recent `sessions/<project>/<date>.md` into one orientation payload |
| `end_session` | Write a structured handoff note to `sessions/<project>/<YYYY-MM-DD>.md` |

Multiple vaults are supported — each tool takes an optional `vault` argument and falls back to the configured default.

## Vault layout

The session tools assume this convention inside your vault:

```
<vault>/
├── context-bundles/
│   ├── treyd-fe.md
│   └── treyd-website.md
└── sessions/
    ├── treyd-fe/
    │   ├── 2026-04-25.md
    │   └── 2026-04-26.md
    └── treyd-website/
        └── 2026-04-20.md
```

`read_note`, `write_note`, `list_notes`, and `search_notes` are layout-agnostic — use them however you like.

## Install

```bash
git clone git@github.com:MohamedElshazly/brain-mcp.git
cd brain-mcp
npm install
npm run build
```

## Configure

Create `~/.brain-mcp/config.json`:

```json
{
  "default": "main",
  "vaults": {
    "main": "~/Documents/Obsidian/Brain",
    "work": "~/Documents/Obsidian/Work"
  }
}
```

Tilde expansion is supported. The `default` key picks which vault is used when a tool call omits the `vault` argument.

## Wire it into Claude Code

Add the server with the Claude Code CLI:

```bash
claude mcp add brain-mcp -- node /absolute/path/to/brain-mcp/dist/index.js
```

Or run from source during development:

```bash
claude mcp add brain-mcp -- npx tsx /absolute/path/to/brain-mcp/src/index.ts
```

After adding it, restart Claude Code. The tools will appear under the `brain-mcp` server.

### Other MCP clients

Anything that speaks MCP over stdio works. The command is:

```
node /absolute/path/to/brain-mcp/dist/index.js
```

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "brain-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/brain-mcp/dist/index.js"]
    }
  }
}
```

## Develop

```bash
npm run dev     # tsx watch src/index.ts
npm run build   # tsc → dist/
npm start       # node dist/index.js
```

The server logs `brain-mcp running` to stderr on startup. stdout is reserved for the MCP protocol.

## Session workflow

The intended day-to-day loop:

1. **Start of session** — call `start_session({ project: "treyd-fe" })`. You get the project's context bundle plus the last session note in one payload.
2. **Work happens.**
3. **End of session** — call `end_session({ project, last_state, decisions, blocked, next_action, files_touched })`. A dated note is written to `sessions/<project>/`.

Tomorrow's `start_session` then picks up that note automatically.

## License

ISC
