import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

interface Config {
  vaults: Record<string, string>;
  default: string;
}

async function loadConfig(): Promise<Config> {
  const configPath = path.join(
    process.env.HOME || "~",
    ".brain-mcp",
    "config.json"
  );
  const raw = await fs.readFile(configPath, "utf-8");
  return JSON.parse(raw);
}

function resolvePath(vaultPath: string, notePath: string): string {
  const expanded = vaultPath.replace("~", process.env.HOME || "~");
  return path.join(expanded, notePath.endsWith(".md") ? notePath : `${notePath}.md`);
}

function resolveVaultPath(config: Config, vault?: string): string {
  const key = vault || config.default;
  const vaultPath = config.vaults[key];
  if (!vaultPath) throw new Error(`Vault "${key}" not found in config. Available: ${Object.keys(config.vaults).join(", ")}`);
  return vaultPath;
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "brain-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "read_note",
      description: "Read a note from the Obsidian vault",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path relative to vault root (e.g. context-bundles/treyd-fe)" },
          vault: { type: "string", description: "Vault name from config (defaults to default vault)" },
        },
        required: ["path"],
      },
    },
    {
      name: "write_note",
      description: "Write or overwrite a note in the Obsidian vault",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Note path relative to vault root" },
          content: { type: "string", description: "Full markdown content to write" },
          vault: { type: "string", description: "Vault name from config (defaults to default vault)" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "list_notes",
      description: "List all notes in a vault folder",
      inputSchema: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder path relative to vault root (e.g. sessions/treyd-fe)" },
          vault: { type: "string", description: "Vault name from config (defaults to default vault)" },
        },
        required: ["folder"],
      },
    },
    {
      name: "search_notes",
      description: "Search for a string across all notes in the vault",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for" },
          vault: { type: "string", description: "Vault name from config (defaults to default vault)" },
        },
        required: ["query"],
      },
    },
    {
      name: "end_session",
      description: "Write a session handoff note to the vault. Call this when the user says 'end session'.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name (e.g. treyd-fe, treyd-website)" },
          last_state: { type: "string", description: "Where did we stop exactly?" },
          decisions: { type: "string", description: "Key choices made this session" },
          blocked: { type: "string", description: "What is open or blocked" },
          next_action: { type: "string", description: "The single first thing to do next session" },
          files_touched: { type: "string", description: "Comma-separated list of files changed" },
          vault: { type: "string", description: "Vault name from config (defaults to default vault)" },
        },
        required: ["project", "last_state", "next_action"],
      },
    },
    {
      name: "start_session",
      description: "Call this at the start of a session. Reads the project context bundle and most recent session note in one call.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name (e.g. treyd-fe, treyd-website)" },
          vault: { type: "string", description: "Vault name from config (defaults to default vault)" },
        },
        required: ["project"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const config = await loadConfig();
  const { name, arguments: args } = request.params;

  if (!args) throw new Error("No arguments provided");

  try {
    // ── read_note ──────────────────────────────────────────────────────────
    if (name === "read_note") {
      const vaultPath = resolveVaultPath(config, args.vault as string | undefined);
      const fullPath = resolvePath(vaultPath, args.path as string);
      const content = await fs.readFile(fullPath, "utf-8");
      return { content: [{ type: "text", text: content }] };
    }

    // ── write_note ─────────────────────────────────────────────────────────
    if (name === "write_note") {
      const vaultPath = resolveVaultPath(config, args.vault as string | undefined);
      const fullPath = resolvePath(vaultPath, args.path as string);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, args.content as string, "utf-8");
      return { content: [{ type: "text", text: `Written: ${fullPath}` }] };
    }

    // ── list_notes ─────────────────────────────────────────────────────────
    if (name === "list_notes") {
      const vaultPath = resolveVaultPath(config, args.vault as string | undefined);
      const expanded = vaultPath.replace("~", process.env.HOME || "~");
      const folderPath = path.join(expanded, args.folder as string);
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      const notes = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.replace(".md", ""));
      return { content: [{ type: "text", text: notes.join("\n") }] };
    }

    // ── search_notes ───────────────────────────────────────────────────────
    if (name === "search_notes") {
      const vaultPath = resolveVaultPath(config, args.vault as string | undefined);
      const expanded = vaultPath.replace("~", process.env.HOME || "~");
      const query = (args.query as string).toLowerCase();
      const results: string[] = [];

      async function walk(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            await walk(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            const content = await fs.readFile(fullPath, "utf-8");
            if (content.toLowerCase().includes(query)) {
              results.push(fullPath.replace(expanded + "/", ""));
            }
          }
        }
      }

      await walk(expanded);
      return {
        content: [{
          type: "text",
          text: results.length ? results.join("\n") : "No results found",
        }],
      };
    }

    // ── end_session ────────────────────────────────────────────────────────
    if (name === "end_session") {
      const vaultPath = resolveVaultPath(config, args.vault as string | undefined);
      const project = args.project as string;
      const date = new Date().toISOString().split("T")[0];
      const notePath = `sessions/${project}/${date}.md`;
      const fullPath = resolvePath(vaultPath, notePath);

      const content = `---
type: session
project: ${project}
date: ${date}
---

## Last state
${args.last_state}

## What was decided
${args.decisions || "—"}

## Open / blocked
${args.blocked || "—"}

## Next action
${args.next_action}

## Files touched
${args.files_touched ? (args.files_touched as string).split(",").map((f: string) => `- ${f.trim()}`).join("\n") : "—"}
`;

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");

      return {
        content: [{
          type: "text",
          text: `Session note written to ${notePath}`,
        }],
      };
    }

    // ── start_session ──────────────────────────────────────────────────────
    if (name === "start_session") {
      const vaultPath = resolveVaultPath(config, args.vault as string | undefined);
      const project = args.project as string;
      const expanded = vaultPath.replace("~", process.env.HOME || "~");

      const bundlePath = resolvePath(vaultPath, `context-bundles/${project}`);
      const bundle = await fs.readFile(bundlePath, "utf-8");

      const sessionsDir = path.join(expanded, "sessions", project);
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
      const sessionFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name)
        .sort()
        .reverse();
      const latest = sessionFiles[0];
      const sessionNote = latest
        ? await fs.readFile(path.join(sessionsDir, latest), "utf-8")
        : "(no prior sessions)";

      const combined = `# Context bundle: ${project}\n\n${bundle}\n\n---\n\n# Last session${latest ? ` (${latest.replace(".md", "")})` : ""}\n\n${sessionNote}`;

      return { content: [{ type: "text", text: combined }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("brain-mcp running");
}

main();