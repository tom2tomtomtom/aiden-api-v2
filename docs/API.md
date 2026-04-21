# AIDEN Brain API v2 - Endpoint Reference

Base URL: `https://brain.aiden.services/api/v1`

All protected endpoints require `X-API-Key` header.

---

## Authentication

All requests (except `/health`) require an API key:

```
X-API-Key: aiden_sk_your_key_here
```

---

## Health Check

```bash
GET /api/v1/health
```

No auth required.

```bash
curl https://brain.aiden.services/api/v1/health
```

Response:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "2.0.0",
    "uptime_seconds": 12345
  }
}
```

---

## Chat

### Non-Streaming

```bash
POST /api/v1/chat
```

```bash
curl -X POST https://brain.aiden.services/api/v1/chat \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Write a bold creative strategy for a challenger brand",
    "personality_mode": "collaborator",
    "stream": false
  }'
```

Request body:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| message | string | yes | User message |
| conversation_id | string | no | Continue existing conversation |
| personality_mode | string | no | "collaborator", "challenger", or "collaborative" |
| model | string | no | Model override |
| stream | boolean | no | Enable SSE streaming (default: false) |

Response:
```json
{
  "success": true,
  "data": {
    "content": "Here is a creative strategy that challenges conventions...",
    "conversation_id": "conv-abc123",
    "phantoms_fired": [
      { "shorthand": "challenger_instinct", "score": 5.2, "source": "base" },
      { "shorthand": "bold_direction", "score": 3.8, "source": "agency" }
    ],
    "collisions": [
      { "phantomA": "brevity_master", "phantomB": "depth_seeker", "tension": "minimalism vs depth" }
    ],
    "thinking_mode": { "mode": "generative", "label": "Generative", "description": "Creating new ideas" },
    "maturity_stage": "exploring"
  }
}
```

### Streaming (SSE)

```bash
curl -X POST https://brain.aiden.services/api/v1/chat \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"message": "Write a manifesto", "stream": true}'
```

Events:
```
data: {"type": "text", "data": "Here is "}
data: {"type": "text", "data": "my creative "}
data: {"type": "text", "data": "manifesto..."}
data: {"type": "phantom", "data": [{"shorthand": "bold_direction", "score": 4.1, "source": "base"}]}
data: {"type": "collision", "data": [{"phantomA": "brevity", "phantomB": "depth", "tension": "brief vs deep"}]}
data: {"type": "thinking_mode", "data": {"mode": "generative", "label": "Generative"}}
data: {"type": "done", "data": {"conversation_id": "conv-abc", "maturity_stage": "exploring"}}
```

---

## Structured Generation

All generation endpoints run as async jobs. Poll `/jobs/{id}/status` for completion.

### Strategy

```bash
POST /api/v1/generate/strategy
```

```bash
curl -X POST https://brain.aiden.services/api/v1/generate/strategy \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"brief": "Launch campaign for an electric vehicle startup targeting Gen Z"}'
```

### Territories

```bash
POST /api/v1/generate/territories
```

```bash
curl -X POST https://brain.aiden.services/api/v1/generate/territories \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"brief": "Rebrand a 100-year-old bank for digital natives"}'
```

### Big Idea

```bash
POST /api/v1/generate/big-idea
```

```bash
curl -X POST https://brain.aiden.services/api/v1/generate/big-idea \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"brief": "Anti-fast-fashion campaign", "territories": ["radical transparency", "slow fashion luxury"]}'
```

### Copy Suite

```bash
POST /api/v1/generate/copy-suite
```

```bash
curl -X POST https://brain.aiden.services/api/v1/generate/copy-suite \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"brief": "Mental health awareness week", "big_idea": "The bravest thing you can do is ask for help"}'
```

---

## Jobs

### Check Status

```bash
GET /api/v1/jobs/{id}/status
```

```bash
curl https://brain.aiden.services/api/v1/jobs/job-123/status \
  -H "X-API-Key: aiden_sk_..."
```

Response:
```json
{ "success": true, "data": { "job_id": "job-123", "status": "completed" } }
```

### Get Result

```bash
GET /api/v1/jobs/{id}/result
```

---

## Workflow

```bash
POST /api/v1/workflow
```

Runs a guided pipeline: brief > strategy > territories > big idea > copy suite.

```bash
curl -X POST https://brain.aiden.services/api/v1/workflow \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"brief": "Launch a new energy drink targeting extreme sports athletes"}'
```

---

## Feedback

```bash
POST /api/v1/feedback
```

Submit feedback on a brain response. Adjusts phantom weights.

```bash
curl -X POST https://brain.aiden.services/api/v1/feedback \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "msg-abc",
    "conversation_id": "conv-123",
    "feedback_type": "positive"
  }'
```

Feedback types:
| Type | Effect |
|------|--------|
| positive | Boosts active phantoms (+0.08 proportional to score) |
| negative | Small penalty (-0.03), flags for review if 3+ in 30 days |
| used | Strongest signal (+0.12 flat boost) |
| regenerated | Same as negative |
| edited | Neutral, logged for analysis |

---

## Phantom Management

### List Phantoms

```bash
GET /api/v1/phantoms
```

```bash
curl https://brain.aiden.services/api/v1/phantoms \
  -H "X-API-Key: aiden_sk_..."
```

### Phantom Stats

```bash
GET /api/v1/phantoms/stats
```

Returns activation stats, quality scores, and alliance data.

### Cultivate from Documents

```bash
POST /api/v1/phantoms/cultivate
```

```bash
curl -X POST https://brain.aiden.services/api/v1/phantoms/cultivate \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {"title": "Agency manifesto", "content": "We believe in the power of ideas that make people uncomfortable..."}
    ]
  }'
```

### Interview Responses

```bash
POST /api/v1/phantoms/interview
```

### Taste Test (Cold Start)

```bash
POST /api/v1/taste-test
```

```bash
curl -X POST https://brain.aiden.services/api/v1/taste-test \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "answers": [
      {"question_id": 1, "choice": "a", "strength": 4},
      {"question_id": 2, "choice": "b", "strength": 3}
    ]
  }'
```

---

## Usage

```bash
GET /api/v1/usage
```

Returns usage for the current billing period.

---

## API Keys

### Rotate Key

```bash
POST /api/v1/keys/rotate
```

24-hour grace period: both old and new keys work during transition.

---

## Rate Limiting

Rate limits are per-API-key. Headers on every response:

```
X-RateLimit-Limit-Minute: 60
X-RateLimit-Remaining-Minute: 59
X-RateLimit-Limit-Day: 10000
X-RateLimit-Remaining-Day: 9999
```

429 response includes `retry_after_seconds`.

---

## Error Format

All errors follow this shape:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "details": {}
}
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error |
| 401 | Missing or invalid API key |
| 402 | Insufficient tokens |
| 403 | Key deactivated |
| 429 | Rate limit exceeded |
| 500 | Internal error |
