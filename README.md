# AI-Powered File Management System

A Next.js web application that lets users upload, organize, and search files with AI-generated summaries and tags powered by Claude.

## Features

- **File upload** — upload any file type; stored in Supabase Storage
- **AI summarization** — Claude analyzes text-readable files (`.txt`, `.md`, `.csv`, `.json`, `.log`) and generates a summary, tags, and structured metadata on upload
- **Folder management** — create folders, move files into folders, view per-folder AI context summaries
- **Folder-level context** — Claude synthesizes per-file summaries into a folder-level overview with dominant topics and key entities; manually refreshable
- **Search** — client-side keyword search across file names, AI summaries, and tags; optionally scoped to a selected folder
- **Authentication** — email/password sign-up and sign-in via Supabase Auth with session management handled by Next.js middleware
- **n8n integration** — a `/api/process-file` webhook endpoint (protected by `INGEST_SECRET`) allows n8n automations to trigger file re-processing

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4 |
| Backend | Next.js API Routes (server-side) |
| Database & Storage | Supabase (PostgreSQL + Storage) |
| Auth | Supabase Auth with `@supabase/ssr` |
| AI | Anthropic Claude (`claude-sonnet-4-5`) via `@anthropic-ai/sdk` |
| AI (installed, unused) | LangChain wrappers for OpenAI and Google Gemini |
| Automation | n8n (self-hosted, optional) |

## Project Structure

```
File-Manager_Test/
├── file-manager-ai/          # Next.js application
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── upload/           # File upload + triggers AI ingestion
│   │   │   │   ├── process-file/     # n8n/webhook endpoint to re-process a file
│   │   │   │   ├── search/           # Keyword search across files and metadata
│   │   │   │   └── folders/          # CRUD for folders + folder context refresh
│   │   │   ├── auth/                 # Supabase Auth UI page
│   │   │   ├── dashboard/            # Main file manager UI
│   │   │   └── page.tsx              # Landing page
│   │   ├── components/
│   │   │   ├── UserMenu.tsx          # Sign-out dropdown
│   │   │   └── FileUploadForm.tsx    # Standalone upload form (not used on dashboard)
│   │   ├── lib/
│   │   │   ├── ai/orchestrator.ts    # Core AI pipeline: extract → summarize → store
│   │   │   └── supabase/             # Browser and server Supabase client factories
│   │   └── middleware.ts             # Refreshes Supabase auth session on every request
│   └── .env.example
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project with:
  - A `files` storage bucket
  - `files`, `file_metadata`, `folders`, and `folder_metadata` tables
- An [Anthropic API key](https://console.anthropic.com)

### Installation

```bash
cd file-manager-ai
npm install
```

### Environment setup

```bash
cp .env.example .env.local
# Fill in the values — see the Environment Variables section below
```

### Run locally

```bash
npm run dev
# App runs at http://localhost:3000
```

To enable the n8n webhook integration, start n8n separately (`npx n8n` or via Docker) and set `N8N_INGEST_WEBHOOK_URL` to your webhook URL.

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (safe to expose to browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (safe to expose to browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — **server-side only**, bypasses RLS |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude summarization — **server-side only** |
| `OPENAI_API_KEY` | OpenAI API key (LangChain dependency installed, not yet wired up) |
| `GEMINI_API_KEY` | Google Gemini API key (LangChain dependency installed, not yet wired up) |
| `INGEST_SECRET` | Shared secret for the `/api/process-file` webhook — generate with `openssl rand -hex 32` |
| `N8N_INGEST_WEBHOOK_URL` | n8n webhook URL for optional automation triggers |

## Architecture

When a user uploads a file, the `/api/upload` route stores it in Supabase Storage, inserts a record into the `files` table, and then fires `orchestrateFileIngestion` asynchronously (so the upload response returns immediately).

The orchestrator:
1. **Downloads** the file from Supabase Storage using the service role key
2. **Extracts text** for supported types (plain text, markdown, CSV, JSON, logs)
3. **Calls Claude** (`claude-sonnet-4-5`) with a sampled excerpt to generate a JSON `{ summary, tags, extra_context }` object
4. **Upserts** the result into the `file_metadata` table
5. **Triggers folder context recomputation** if the file belongs to a folder — Claude synthesizes all per-file summaries in the folder into a folder-level summary stored in `folder_metadata`

The `/api/process-file` endpoint lets n8n (or any HTTP client with the `INGEST_SECRET` header) re-trigger step 1–5 for any file by `fileId` + `userId`.

## License

MIT
