# AIDEN Brain API v2 - Integration Guide

## Quickstart

### 1. Get an API Key

Contact Redbaez to get an API key. Keys start with `aiden_sk_`.

### 2. Install an SDK

**Python:**
```bash
pip install aiden-brain
```

**TypeScript:**
```bash
npm install @aiden/brain
```

### 3. Send Your First Message

**Python:**
```python
from aiden_brain import AIDENBrain

brain = AIDENBrain(api_key="aiden_sk_your_key_here")
response = brain.chat("Write a bold creative strategy for a challenger brand")
print(response.content)
print(f"Phantoms: {[p.shorthand for p in response.phantoms_fired]}")
```

**TypeScript:**
```typescript
import { AIDENBrain } from '@aiden/brain';

const brain = new AIDENBrain({ apiKey: 'aiden_sk_your_key_here' });
const response = await brain.chat('Write a bold creative strategy for a challenger brand');
console.log(response.content);
console.log('Phantoms:', response.phantomsFired.map(p => p.shorthand));
```

**curl:**
```bash
curl -X POST https://brain.aiden.services/api/v1/chat \
  -H "X-API-Key: aiden_sk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"message": "Write a bold creative strategy for a challenger brand"}'
```

---

## Authentication

Every request requires the `X-API-Key` header:

```
X-API-Key: aiden_sk_abc123_your_full_key
```

Keys are SHA-256 hashed before storage. Only the prefix (`aiden_sk_abc123`) is stored in plaintext for lookup.

### Key Rotation

```bash
POST /api/v1/keys/rotate
```

Returns a new key. The old key remains valid for 24 hours (grace period).

---

## Streaming

For real-time responses, use Server-Sent Events (SSE):

**Python:**
```python
for chunk in brain.chat_stream("Write a manifesto"):
    print(chunk, end="", flush=True)
```

**TypeScript:**
```typescript
for await (const chunk of brain.chatStream('Write a manifesto')) {
  process.stdout.write(chunk);
}
```

**curl:**
```bash
curl -N -X POST https://brain.aiden.services/api/v1/chat \
  -H "X-API-Key: aiden_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"message": "Write a manifesto", "stream": true}'
```

SSE event types:
- `text`: Content chunk
- `phantom`: Activated phantoms metadata
- `collision`: Creative tensions detected
- `thinking_mode`: Cognitive mode used
- `done`: Stream complete, includes conversation_id and maturity_stage

---

## Async Jobs (Polling)

Structured generation endpoints (strategy, territories, big-idea, copy-suite) run as async jobs.

### Manual Polling

```bash
# Start a job
POST /api/v1/generate/strategy
# Returns: { "job_id": "job-abc123" }

# Poll status
GET /api/v1/jobs/job-abc123/status
# Returns: { "status": "processing" }

# Get result when done
GET /api/v1/jobs/job-abc123/result
# Returns: { "strategy": { ... } }
```

### SDK Auto-Polling

Both SDKs abstract polling automatically:

```python
# Python - blocks until complete, polls internally
result = brain.generate_strategy("Launch campaign for EV startup")
print(result.result)
```

```typescript
// TypeScript - awaits completion, polls internally
const result = await brain.generateStrategy('Launch campaign for EV startup');
console.log(result.result);
```

---

## Webhooks

Configure a webhook URL when creating your API key. The brain will POST to your URL when async jobs complete:

```json
{
  "event": "job.completed",
  "job_id": "job-abc123",
  "status": "completed",
  "result": { ... }
}
```

Webhook payloads include an `X-AIDEN-Signature` header for verification.

---

## Feedback Loop

The feedback system teaches AIDEN what works for your agency. Every piece of feedback adjusts phantom weights.

```python
# User liked the response
brain.submit_feedback(
    message_id="msg-abc",
    conversation_id="conv-123",
    feedback_type="positive"
)

# User copied the output without editing (strongest signal)
brain.submit_feedback(
    message_id="msg-abc",
    conversation_id="conv-123",
    feedback_type="used"
)
```

Feedback types and their effects:

| Type | Weight Effect | Signal Strength |
|------|-------------|-----------------|
| positive | +0.08 (proportional to activation score) | Medium |
| used | +0.12 (flat) | Strongest |
| negative | -0.03 | Weak |
| regenerated | -0.03 | Weak |
| edited | None (logged for analysis) | Neutral |

---

## Personality Modes

Three modes control how AIDEN interacts:

| Mode | Behaviour |
|------|-----------|
| collaborator | Builds on ideas, "yes, and..." approach |
| challenger | Pushes back, questions assumptions |
| collaborative | Strategic wingman, adapts to context |

```python
response = brain.chat("Review this campaign", personality_mode="challenger")
```

---

## Conversation Continuity

Pass `conversation_id` to continue a conversation:

```python
r1 = brain.chat("Brief: launch campaign for a new energy drink")
r2 = brain.chat("Make it bolder", conversation_id=r1.conversation_id)
r3 = brain.chat("Write it up", conversation_id=r1.conversation_id)
```

The brain tracks maturity through 4 stages: INITIAL, EXPLORING, HAS_DIRECTION, SYNTHESIS_READY. After 2 exchanges, responses stop ending with questions (the no-questions rule).

---

## Error Handling

```python
from aiden_brain import (
    AIDENBrainError,
    AuthenticationError,
    RateLimitError,
    InsufficientTokensError,
)

try:
    response = brain.chat("Write something")
except AuthenticationError:
    print("Check your API key")
except RateLimitError as e:
    print(f"Rate limited. Retry after {e.retry_after}s")
except InsufficientTokensError:
    print("Upgrade your plan")
except AIDENBrainError as e:
    print(f"Brain error: {e}")
```

---

## Rate Limits

Default limits per API key:
- 60 requests per minute
- 10,000 requests per day

Check remaining limits in response headers:
```
X-RateLimit-Remaining-Minute: 59
X-RateLimit-Remaining-Day: 9999
```

---

## Phantom Management

### View Active Phantoms

```python
phantoms = brain.list_phantoms()
for p in phantoms:
    print(f"{p.shorthand}: weight={p.weight}, quality={p.quality_score}")
```

### View Stats and Alliances

```python
stats = brain.get_phantom_stats()
print(f"Total phantoms: {stats.total_phantoms}")
for alliance in stats.alliances:
    print(f"  {alliance['phantom_a']} + {alliance['phantom_b']}: strength {alliance['strength']}")
```

### Cultivate from Documents

```python
brain._request("POST", "/phantoms/cultivate", {
    "documents": [
        {"title": "Agency manifesto", "content": "We believe in ideas that make people uncomfortable..."}
    ]
})
```
