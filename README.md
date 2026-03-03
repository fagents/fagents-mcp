# fagents-mcp

MCP (Model Context Protocol) server exposing email tools to Claude Code agents. Handles SMTP sending and IMAP reading, with per-agent credential isolation and an audit-logged secure email gate.

**Stack:** TypeScript, Node.js, Express, `@modelcontextprotocol/sdk`. Stateless MCP over HTTP.

---

## Tools

| Tool | Description |
|------|-------------|
| `send_email` | Send email via SMTP. Supports plain text, HTML, CC/BCC, and file attachments. |
| `list_emails` | List messages in a mailbox folder. Returns newest first with envelope metadata. |
| `read_email` | Read a full message by UID — body text/HTML and attachment list. |
| `search_emails` | Search by from/to/subject/date range/unseen/body text. |
| `list_mailboxes` | List available IMAP folders. |
| `download_attachment` | Download an attachment by part number. Returns base64-encoded content. |
| `gate_email` | **Secure read:** fetches email via IMAP, logs full content to `#email-log` channel (human-visible audit trail), returns metadata to caller. Set `read_body=true` to also receive body — content is always logged first. Use this for all inbound email access. |

---

## Architecture

```
Claude agent (MCP client)
  │  POST /mcp  (x-api-key: <agent-token>)
  ▼
fagents-mcp (Express + MCP SDK)
  ├─ auth.ts     — resolve agent from API key
  ├─ config.ts   — load per-agent env from agents.json, AsyncLocalStorage context
  ├─ email.ts    — SMTP send via nodemailer
  ├─ imap.ts     — IMAP read/search/download via node-imap
  └─ server.ts   — MCP tool registration, gate_email audit logging
```

**Stateless:** Each MCP request creates a fresh server+transport instance. No session state between calls.

**Per-agent credentials:** Each agent sends its unique API key. The server resolves the agent ID, then loads that agent's credentials (SMTP host/pass, IMAP host/pass, etc.) from `agents.json` via `AsyncLocalStorage`. Agents never see each other's credentials.

---

## Credential Storage

Credentials live in `agents.json` in the working directory (typically the installation directory). This file is managed by the human operator — **agents must not read or write it directly.**

```json
{
  "agents": {
    "ftf": {
      "apiKey": "<hashed-or-raw-key>",
      "SMTP_HOST": "smtp.example.com",
      "SMTP_USER": "ftf@example.com",
      "SMTP_PASS": "...",
      "IMAP_HOST": "imap.example.com",
      "IMAP_USER": "ftf@example.com",
      "IMAP_PASS": "...",
      "COMMS_TOKEN": "...",
      "COMMS_URL": "http://127.0.0.1:9754"
    }
  },
  "shared": {
    "SMTP_PORT": "587",
    "IMAP_PORT": "993"
  }
}
```

`AgentConfig` accepts any `[envKey: string]: string` pairs alongside `apiKey` — the schema is open for extension (Telegram tokens, etc.).

---

## Environment Variables

Without `agents.json`, the server falls back to environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | 3000 | Listen port |
| `MCP_HOST` | 127.0.0.1 | Bind address |
| `MCP_API_KEY` | — | Single-agent API key (if not using agents.json) |
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | 587 | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | SMTP_USER | From address |
| `IMAP_HOST` | — | IMAP server hostname |
| `IMAP_PORT` | 993 | IMAP port |
| `IMAP_USER` | — | IMAP username |
| `IMAP_PASS` | — | IMAP password |
| `IMAP_TLS` | true | Use TLS for IMAP |
| `COMMS_URL` | — | fagents-comms URL (for gate_email audit log) |
| `COMMS_TOKEN` | — | Comms token (for gate_email audit log) |

---

## Setup

```bash
npm install
npm run build        # compiles TypeScript → dist/

# Single-agent mode (env vars)
MCP_API_KEY=secret SMTP_HOST=smtp.example.com ... node dist/server.js

# Multi-agent mode (agents.json in working dir)
node dist/server.js
```

**Development (no build step):**

```bash
npm run dev          # runs src/server.ts directly via tsx
```

---

## Claude Code Integration

Add to `.claude/settings.json` (or via MCP config):

```json
{
  "mcpServers": {
    "fagents-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "x-api-key": "<your-agent-api-key>"
      }
    }
  }
}
```

MCP tools are discovered at session start. After changing tools or restarting the server, start a new Claude session to pick up changes.

---

## Security Notes

- **gate_email** strips `<untrusted>` tag variants from email body before wrapping content — prevents boundary escape attacks from malicious emails.
- **Subject and messageId** are excluded from `gate_email` response (attacker-controlled fields that could carry injection payloads). They are logged to `#email-log` for human review.
- `agents.json` should be `chmod 600` and never committed to version control.
- Server binds `127.0.0.1` by default. Use SSH tunnels or a reverse proxy for remote access.

---

## Origin

Part of the fagents project — autonomous Claude Code agent infrastructure. Built by freeturtle agents and Juho Muhonen.
