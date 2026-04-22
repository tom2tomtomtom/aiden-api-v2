# AIDEN Brain API v2 — Deploy + LinkedIn Engine Setup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision a fresh Supabase project + Railway service for aiden-brain-api-v2, seed phantom data, issue the first API key, and commit the pending linkedin-engine model-ID fixes.

**Architecture:** aiden-api-v2 is a standalone TypeScript Express service (Dockerfile-based) that wraps the Nuclear Brain. It gets its own Supabase project (for multi-tenant API keys, usage logs, phantom tables) and its own Railway project. No shared infra with any other AIDEN service. The linkedin-engine cleanup (Track 2) is independent — it just commits 3 pending model-ID patches.

**Tech Stack:** Node.js 20 ESM, Express 5, TypeScript, Supabase (pgvector), Railway (Dockerfile), `tsx` for scripts.

---

## Files touched

### aiden-api-v2 (`/Users/tommyhyde/aiden-api-v2`)
- Modify: `.env` (local only, never committed) — add new Supabase credentials for seeding
- Read: `supabase/migrations/001_brain_v2_schema.sql` — apply via Supabase MCP
- Read: `supabase/migrations/002_token_cap.sql` — apply via Supabase MCP
- Read: `supabase/migrations/003_system_phantoms.sql` — apply via Supabase MCP
- Read: `scripts/seed-system-phantoms.ts` — run after migrations
- Read: `data/phantoms.json` — input to seeder

### aiden-linkedin-engine (`/Users/tommyhyde/aiden-linkedin-engine`)
- Already modified: `src/scanner/relevance.ts` — model ID patch, commit as-is
- Already modified: `src/scanner/sources.ts` — model ID patch, commit as-is
- Already modified: `src/generator/post-writer.ts` — model ID patch, commit as-is
- Already modified: `package-lock.json` — commit as-is

---

## Task 1: Create new Supabase project

**Context:** aiden-api-v2 needs its own Supabase project — separate from the LinkedIn Engine's Supabase. The project needs pgvector enabled (migration 001 enables it). Provisioning takes ~2 minutes.

**Files:** none modified — captures credentials for later tasks

- [ ] **Step 1: Load Supabase MCP tool schema**

```
ToolSearch query: "select:mcp__claude_ai_Supabase__create_project,mcp__claude_ai_Supabase__get_project,mcp__claude_ai_Supabase__confirm_cost,mcp__claude_ai_Supabase__get_cost"
```

- [ ] **Step 2: Get cost estimate for new project**

Call `mcp__claude_ai_Supabase__get_cost` with:
```json
{ "type": "project" }
```

- [ ] **Step 3: Confirm cost, then create project**

Call `mcp__claude_ai_Supabase__confirm_cost` if needed, then `mcp__claude_ai_Supabase__create_project` with:
```json
{
  "name": "aiden-brain-api-v2",
  "region": "ap-southeast-1",
  "confirm_cost_id": "<id from get_cost>"
}
```

Wait for status `ACTIVE_HEALTHY` — poll `mcp__claude_ai_Supabase__get_project` with the returned project ID every 30s.

- [ ] **Step 4: Capture credentials**

From the project response, note:
- `SUPABASE_URL` = `https://<project-ref>.supabase.co`
- `SUPABASE_SERVICE_KEY` = service role key from the response or Supabase dashboard

These are needed in Tasks 2, 3, and 4.

---

## Task 2: Run database migrations

**Context:** Three migrations must be applied in order. Migration 001 requires pgvector. The Supabase MCP `apply_migration` tool applies raw SQL. If pgvector fails (some regions need manual enable), run `CREATE EXTENSION IF NOT EXISTS vector;` as a prior step.

**Files:**
- Read: `supabase/migrations/001_brain_v2_schema.sql`
- Read: `supabase/migrations/002_token_cap.sql`
- Read: `supabase/migrations/003_system_phantoms.sql`

- [ ] **Step 1: Load migration tool**

```
ToolSearch query: "select:mcp__claude_ai_Supabase__apply_migration,mcp__claude_ai_Supabase__list_migrations"
```

- [ ] **Step 2: Apply migration 001**

Read the full content of `supabase/migrations/001_brain_v2_schema.sql` then call `mcp__claude_ai_Supabase__apply_migration` with:
```json
{
  "project_id": "<project_id from Task 1>",
  "name": "001_brain_v2_schema",
  "query": "<full SQL content of 001_brain_v2_schema.sql>"
}
```

- [ ] **Step 3: Apply migration 002**

Read `supabase/migrations/002_token_cap.sql` and apply:
```json
{
  "project_id": "<project_id>",
  "name": "002_token_cap",
  "query": "<full SQL content of 002_token_cap.sql>"
}
```

- [ ] **Step 4: Apply migration 003**

Read `supabase/migrations/003_system_phantoms.sql` and apply:
```json
{
  "project_id": "<project_id>",
  "name": "003_system_phantoms",
  "query": "<full SQL content of 003_system_phantoms.sql>"
}
```

- [ ] **Step 5: Verify tables exist**

Call `mcp__claude_ai_Supabase__list_tables` with project_id. Expected tables:
`tenants`, `api_keys`, `conversations`, `messages`, `agency_phantoms`, `phantom_feedback`, `phantom_alliances`, `concepts`, `usage_logs`, `system_phantoms`

---

## Task 3: Seed system phantoms

**Context:** `data/phantoms.json` contains 200+ phantom definitions. The seed script does an upsert on `phantom_key`, so it's safe to re-run. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in the environment.

**Files:**
- Read: `scripts/seed-system-phantoms.ts`
- Read: `data/phantoms.json`

- [ ] **Step 1: Write credentials to local .env**

Create/update `/Users/tommyhyde/aiden-api-v2/.env` with:
```
SUPABASE_URL=<from Task 1>
SUPABASE_SERVICE_KEY=<from Task 1>
ANTHROPIC_API_KEY=<from parent session — already in local .env or prompt user>
JWT_SECRET=<generate: openssl rand -hex 32>
API_KEY_SALT=<generate: openssl rand -hex 16>
ADMIN_SECRET=<generate: openssl rand -hex 32>
```

Do NOT commit this file (it's in .gitignore).

- [ ] **Step 2: Run seed script**

```bash
cd /Users/tommyhyde/aiden-api-v2
npx tsx scripts/seed-system-phantoms.ts
```

Expected output:
```
Seeded N phantoms
```

Where N > 100. If output shows 0 or errors, check SUPABASE_URL and SUPABASE_SERVICE_KEY.

- [ ] **Step 3: Verify phantom count**

```bash
cd /Users/tommyhyde/aiden-api-v2
node -e "
import('@supabase/supabase-js').then(({createClient}) => {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  db.from('system_phantoms').select('id', {count:'exact',head:true}).then(({count,error}) => {
    console.log('phantom count:', count, error);
  });
});
" 
```

Expected: count > 100, error null.

---

## Task 4: Create Railway project and set environment variables

**Context:** aiden-api-v2 has a `railway.json` and `Dockerfile`. We create a new Railway project linked to the `tom2tomtomtom/aiden-api-v2` GitHub repo. Railway will auto-deploy on push to `main`. Environment variables must be set before the first successful deploy.

**Files:** none modified

- [ ] **Step 1: Generate secrets**

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "API_KEY_SALT=$(openssl rand -hex 16)"
echo "ADMIN_SECRET=$(openssl rand -hex 32)"
```

Record these values — they're needed in step 3 and cannot be recovered if lost.

- [ ] **Step 2: Initialise Railway project**

```bash
cd /Users/tommyhyde/aiden-api-v2
railway init
```

When prompted:
- Project name: `aiden-brain-api-v2`
- Starting point: Empty project

This creates the Railway project and links the local directory.

- [ ] **Step 3: Set environment variables**

```bash
cd /Users/tommyhyde/aiden-api-v2
railway variables set \
  ANTHROPIC_API_KEY="<value>" \
  SUPABASE_URL="<value from Task 1>" \
  SUPABASE_SERVICE_KEY="<value from Task 1>" \
  JWT_SECRET="<generated in Step 1>" \
  API_KEY_SALT="<generated in Step 1>" \
  ADMIN_SECRET="<generated in Step 1>" \
  AIDEN_MAIN_MODEL="claude-sonnet-4-6" \
  AIDEN_FAST_MODEL="claude-haiku-4-5-20251001" \
  NODE_ENV="production"
```

- [ ] **Step 4: Verify variables are set**

```bash
cd /Users/tommyhyde/aiden-api-v2
railway variables
```

Expected: all 9 variables listed with non-empty values.

- [ ] **Step 5: Deploy to Railway**

```bash
cd /Users/tommyhyde/aiden-api-v2
railway up --detach
```

Watch for build logs in Railway dashboard. Build takes ~2 min. Expected final status: `ACTIVE`.

- [ ] **Step 6: Get Railway public URL**

```bash
cd /Users/tommyhyde/aiden-api-v2
railway domain
```

If no domain assigned yet, create one:
```bash
railway domain create
```

Note the URL (format: `aiden-brain-api-v2.up.railway.app` or similar).

- [ ] **Step 7: Verify health endpoint**

```bash
curl -s https://<railway-url>/api/v1/health | jq .
```

Expected:
```json
{
  "success": true,
  "data": { "status": "ok", ... }
}
```

If 404, check the health route path in `src/api/routes/health.ts`.

---

## Task 5: Create first tenant and API key

**Context:** The API uses `X-Admin-Secret` for admin operations and `X-API-Key` for regular calls. We create an internal tenant ("AIDEN Internal") and issue an API key for the LinkedIn Engine to use. The full key is only shown once — save it.

**Files:** none modified

- [ ] **Step 1: Create AIDEN Internal tenant**

```bash
curl -s -X POST https://<railway-url>/api/v1/keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <ADMIN_SECRET value from Task 4>" \
  -d '{
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "name": "AIDEN Internal"
  }' | jq .
```

Wait — the `POST /api/v1/keys` endpoint requires an existing `tenant_id` UUID in the `tenants` table. We need to create the tenant first via SQL.

Call `mcp__claude_ai_Supabase__execute_sql` with:
```json
{
  "project_id": "<project_id>",
  "query": "INSERT INTO tenants (name, contact_email, plan, monthly_token_cap) VALUES ('AIDEN Internal', 'tomandkimsrsvp@gmail.com', 'internal', NULL) RETURNING id;"
}
```

Note the returned `id` UUID.

- [ ] **Step 2: Create API key for LinkedIn Engine**

```bash
curl -s -X POST https://<railway-url>/api/v1/keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <ADMIN_SECRET>" \
  -d '{
    "tenant_id": "<UUID from Step 1>",
    "name": "LinkedIn Engine",
    "rate_limit_per_minute": 10,
    "rate_limit_per_day": 100
  }' | jq .
```

Expected response contains `data.key` (format: `aiden_sk_<prefix>_<secret>`).

- [ ] **Step 3: Save the key**

The key is shown once. Store it:
- Copy the full key value
- Add to `/Users/tommyhyde/aiden-linkedin-engine/.env` as `AIDEN_API_KEY=<value>`
- Note the Railway URL as `AIDEN_API_URL=https://<railway-url>`

Do NOT commit either value.

---

## Task 6: Commit pending linkedin-engine changes

**Context:** Three source files have model-ID patches already applied (`claude-sonnet-4-6` in post-writer, relevance, sources). `package-lock.json` has a minor update. These are all unstaged. No code changes needed — just commit what's there.

**Files:**
- Commit: `src/scanner/relevance.ts`
- Commit: `src/scanner/sources.ts`
- Commit: `src/generator/post-writer.ts`
- Commit: `package-lock.json`

- [ ] **Step 1: Typecheck before committing**

```bash
cd /Users/tommyhyde/aiden-linkedin-engine
npx tsc --noEmit
```

Expected: no errors. If errors, fix them before proceeding.

- [ ] **Step 2: Verify diffs are model-ID only**

```bash
cd /Users/tommyhyde/aiden-linkedin-engine
git diff src/scanner/relevance.ts src/scanner/sources.ts src/generator/post-writer.ts
```

Expected: only model string changes (e.g. old model ID → `claude-sonnet-4-6`). If any other changes are present, investigate before committing.

- [ ] **Step 3: Commit**

```bash
cd /Users/tommyhyde/aiden-linkedin-engine
git add src/scanner/relevance.ts src/scanner/sources.ts src/generator/post-writer.ts package-lock.json
git commit -m "$(cat <<'EOF'
fix: update Claude model IDs to current versions

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push to main**

```bash
cd /Users/tommyhyde/aiden-linkedin-engine
git push origin main
```

Railway auto-deploys on push. Monitor the deploy in the Railway dashboard for the LinkedIn Engine service.

- [ ] **Step 5: Verify Railway deploy succeeds**

```bash
cd /Users/tommyhyde/aiden-linkedin-engine
railway status
```

After the deploy completes, check the health endpoint:
```bash
curl -s https://<linkedin-engine-railway-url>/health | jq .
```

Expected: `{"status":"ok"}` or similar.

---

## Post-deployment checklist

After all tasks complete:

- [ ] `GET /api/v1/health` on aiden-brain-api-v2 returns `{"success":true}`
- [ ] `POST /api/v1/chat` with a test message and `X-API-Key: <linkedin-engine-key>` returns a phantom-driven response
- [ ] LinkedIn Engine deployed successfully on Railway
- [ ] `ADMIN_SECRET`, `JWT_SECRET`, `API_KEY_SALT` stored somewhere secure (password manager) — not just in local .env
- [ ] aiden-api-v2 GitHub repo connected to Railway project for future auto-deploys (do this in Railway dashboard: Settings > Source > Connect GitHub repo)
