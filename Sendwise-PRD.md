# Sendwise — Product Requirements Document
### Cold Email Campaign Scheduler with Resilient Queueing, Rate Limiting & Search

**Version:** 1.0
**Status:** Draft for Development
**Owner:** Product/Engineering
**Last Updated:** September 27, 2026

---

## Table of Contents

1. Executive Summary
2. Problem Statement
3. Solution Overview
4. User Personas
5. Technical Architecture
6. Functional Requirements
7. API Specifications
8. Data Models
9. Implementation Plan
10. Success Metrics

---

## 1. Executive Summary

### Vision & Value Proposition

Sendwise is a full-stack email campaign scheduling platform that lets an authenticated user upload a list of leads, compose a message once, and have it delivered on a precise, rate-limited schedule — without babysitting a script or worrying that a server restart will lose track of what has and hasn't been sent.

The product exists to prove out (and, longer term, productize) a pattern that most outbound-email tooling gets wrong: treating scheduling as an in-memory concern. Sendwise instead treats **Redis-backed, durable job scheduling as a first-class architectural decision**, with PostgreSQL as the single source of truth for campaign and email state, and Elasticsearch as a dedicated, non-authoritative search layer. The result is a system where sending 10 emails or 10,000 behaves identically: predictably throttled, resumable after a crash, and fully auditable.

Sendwise is being built first as a focused, demo-ready assignment/MVP, but every architectural decision (queue-backed scheduling, idempotent workers, Redis-atomic rate limiting, decoupled search indexing) is one that a real SaaS product would also need on day one — so the MVP is deliberately built as a foundation, not a throwaway prototype.

### Key Objectives

| Objective | Target |
|---|---|
| Reliable delayed delivery | 100% of scheduled emails eventually delivered, in order, even across backend restarts |
| Rate-limit compliance | 0 emails sent above the configured hourly limit per sender |
| No duplicate sends | 0 duplicate deliveries for any given email record, including after a crash/restart |
| Search latency | Sub-second response for `/api/emails/search` across all indexed emails |
| Time-to-first-campaign | A new user can go from Google login to a scheduled campaign in under 2 minutes |
| Demo reliability | 100% reproducible end-to-end demo (login → schedule → rate-limit → restart → search) |

### Expected Impact

Sendwise demonstrates a production-credible architecture for scheduled, rate-limited, multi-recipient email delivery — a pattern directly reusable for cold outreach tools, drip campaigns, transactional digest sends, and notification systems. Success is measured not just by "does it send email" but by whether the system survives the two hardest real-world conditions for any queue-based product: **process restarts** and **rate-limit boundary conditions**.

---

## 2. Problem Statement

### Current Situation

Teams and individual senders who need to email a list of leads on a schedule are typically forced into one of three flawed patterns:

- **Naive `setInterval`/cron scripts** that hold scheduling state in application memory or in fragile local timers. A server restart, deploy, or crash silently drops in-flight jobs, and there is no way to know which emails were actually sent versus lost mid-flight.
- **Manual, unrate-limited sending** through personal SMTP/Gmail accounts, which trips provider rate limits and lands senders in spam folders or gets accounts suspended.
- **Heavyweight, expensive third-party ESPs** (SendGrid, Mailgun, Instantly, Smartlead) that solve the problem but as an opaque black box — no visibility into queue state, no control over per-sender pacing logic, and recurring per-seat/per-email costs that don't make sense for smaller sending volumes.

### Pain Points

- **"I scheduled 500 emails and the server restarted — now I have no idea which ones went out."** Loss of scheduling state on restart is the single most damaging failure mode for any outbound campaign tool.
- **"I hit my provider's rate limit and the whole batch failed."** Without a persistent, atomic rate-limit counter, concurrent workers can easily overshoot a provider's hourly cap, especially when running multiple worker processes.
- **"I can't find that one email I sent three weeks ago."** Without a dedicated search layer, finding a specific sent email inside a growing PostgreSQL table means writing ad-hoc SQL or scrolling a paginated table.
- **"I don't know when to stop and manually check things."** Without proactive notifications (e.g., on hitting a rate limit), operators only discover problems by reactively checking a dashboard.

### Opportunity

There is a clear gap between "toy script" and "expensive ESP" for teams that want **transparent, self-hosted, durable scheduling** with real observability into queue state (waiting/active/delayed/failed jobs) and search. The cost of inaction is continued reliance on either unreliable scripts (lost sends, damaged sender reputation) or unnecessary ESP spend for volumes that don't require it.

---

## 3. Solution Overview

### How It Works

Sendwise's core flow takes a user from authentication to a fully monitored, rate-limited send:

```
Google Login → Dashboard → Compose Email → Upload CSV → Validate Emails
     → Create Campaign → Persist to PostgreSQL → Enqueue BullMQ Delayed Jobs
     → Redis/BullMQ → Worker → Rate-Limit Check → Delay Check → Ethereal SMTP
     → Update PostgreSQL → Index in Elasticsearch → Dashboard
```

A user logs in with Google, composes a subject/body, uploads a CSV of recipient addresses, and sets three scheduling parameters: a start time, a delay between individual sends, and an hourly send limit per sender. On submission, the backend independently re-validates every email address (never trusting client-side validation), persists one row per recipient in PostgreSQL, and creates one BullMQ delayed job per email, each scheduled at `startTime + (index × delay)`.

A dedicated worker process consumes the queue. Before sending, it re-checks the email's current status (to guarantee idempotency), checks a Redis-backed atomic counter against the sender's hourly limit, and only then sends through Ethereal SMTP (a safe, fake-SMTP provider ideal for demos and testing). On send, PostgreSQL is updated and the record is asynchronously indexed into Elasticsearch, which powers a dedicated search endpoint. If the hourly limit has been reached, the job is rescheduled to the next available hour rather than failed or dropped — and, if the user has connected Slack, a notification is sent the moment a sender's hourly limit is hit.

### Technical Approach & Key Decisions

- **Redis/BullMQ over `setInterval`/cron/agenda** — because job state must survive a process crash. Jobs live in Redis, not application memory, so a killed Node.js process loses zero scheduled work; on restart, the worker reconnects and picks up exactly where it left off.
- **PostgreSQL as source of truth, Elasticsearch as a pure index** — Sendwise never treats Elasticsearch as authoritative. Every read that matters for correctness (status, retry count, idempotency checks) goes to PostgreSQL; Elasticsearch exists solely to make free-text search fast.
- **Redis-atomic rate limiting** — hourly send counters are windowed Redis keys (`email-rate:{senderId}:{hourWindow}`) incremented via `INCR`/`EXPIRE` or a Lua script, so concurrent workers cannot race past the limit.
- **Idempotent workers keyed by `email.id`** — every BullMQ job uses the email's own database ID as its `jobId`, making duplicate enqueuing a no-op and making "already sent, skip" a one-line status check inside the worker.

### Core Differentiators

- **Crash-transparent scheduling** — the restart scenario is a designed-for feature, not an edge case; the same PostgreSQL + Redis + BullMQ split that makes local development easy is what makes production reliability possible.
- **Visible internals** — Bull Board gives real-time insight into waiting/active/delayed/completed/failed jobs, something most black-box ESPs never expose.
- **Overflow-safe rate limiting** — emails beyond the hourly cap are automatically rescheduled to the next available hour in original order, rather than failed, dropped, or requiring manual intervention.
- **Proactive Slack alerting** — operators are notified the moment a sender is throttled, without needing to poll a dashboard.

---

## 4. User Personas

### Persona 1 — Priya Nair, Growth/Outbound Lead at an Early-Stage Startup

- **Role:** Runs cold outbound for a 12-person B2B SaaS startup; not an engineer.
- **Workflow:** Exports a lead list from a CRM as CSV, writes a single templated email, and wants to send it to 200–500 leads spread across the day without tripping spam filters.
- **Pain points:** *"Every time I've tried to blast a list, half of it lands in spam because I sent everything in ten minutes."* Needs pacing and hourly caps without configuring anything technical.
- **Technical proficiency:** Low-to-medium. Comfortable with dashboards and CSV uploads; not comfortable with SMTP configuration or reading server logs.
- **Needs from Sendwise:** A dead-simple compose flow, a visible "X emails detected" confirmation after CSV upload, and a scheduled/sent table she can glance at.

### Persona 2 — Daniel Osei, Founding Engineer

- **Role:** The one engineer at a two-person startup responsible for both the product and its infrastructure.
- **Workflow:** Needs to stand up outbound email capability quickly, without adopting a full paid ESP, and needs confidence that a Friday-night deploy won't silently drop Monday-morning scheduled sends.
- **Pain points:** *"I don't trust a scheduler I can't inspect. If something's stuck, I need to see why — not guess."* Also cares deeply about idempotency: a bug that double-sends a cold email to a prospect is a reputational risk.
- **Technical proficiency:** High. Comfortable with Docker Compose, Redis, and reading a queue dashboard directly.
- **Needs from Sendwise:** Bull Board visibility into every job state, environment-variable-driven configuration (concurrency, delay, hourly limit), and documented guarantees around idempotency and restart behavior.

### Persona 3 — Marcus Webb, Ops/Support Manager Monitoring Send Health

- **Role:** Owns the "is outbound working right now" question for the team; not writing code but responsible for catching problems fast.
- **Workflow:** Wants to be told — not have to go look — the moment a sender is throttled or a batch is falling behind schedule.
- **Pain points:** *"I find out about problems from a customer complaint, not from our own tooling."*
- **Technical proficiency:** Medium. Comfortable with Slack and a dashboard; not comfortable with Redis CLI or SQL.
- **Needs from Sendwise:** A one-click Slack connection and automatic notifications the moment a rate limit is hit, plus a searchable sent-email log to answer "did we actually email this person?" without asking an engineer.

---

## 5. Technical Architecture

### System Components & Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + TypeScript + Tailwind CSS + React Router + Axios | Dashboard, compose flow, CSV handling, tables |
| Backend API | Express + TypeScript | REST API, auth, campaign orchestration |
| Database | PostgreSQL (via Prisma ORM) | Source of truth for users, campaigns, emails, senders, Slack connections |
| Queue / Scheduler | BullMQ | Durable delayed job scheduling |
| Queue Storage | Redis | BullMQ backing store + distributed rate-limit counters |
| Search | Elasticsearch | Free-text search index over sent/scheduled emails |
| SMTP | Ethereal (via Nodemailer) | Safe fake-SMTP delivery for testing/demo |
| Auth (User) | Google OAuth 2.0 | User login/identity |
| Auth (Notifications) | Slack OAuth 2.0 | Rate-limit alerting |
| Queue Observability | Bull Board | Live view of waiting/active/delayed/completed/failed jobs |
| Containerization | Docker Compose | Local orchestration of Postgres, Redis, Elasticsearch |

### High-Level Architecture Diagram

```
             ┌──────────────┐
             │    React     │
             │   Frontend   │
             └──────┬───────┘
                    │  REST (Axios)
                    ↓
             ┌──────────────┐
             │   Express    │
             │   Backend    │
             └────┬────┬────┘
                  │    │
        ┌─────────┘    └─────────┐
        ↓                        ↓
   PostgreSQL                  Redis
  (source of truth)         (BullMQ + rate limit)
        │                        │
        │                    BullMQ Worker
        │                        │
        │                  ┌─────┴─────┐
        │                  ↓           ↓
        │             Ethereal SMTP  Slack API
        │             (Nodemailer)  (on limit hit)
        ↓
 Elasticsearch
 (search index, non-authoritative)
```

### Data Flow & Integration Specification

1. **Auth:** User authenticates via Google OAuth → backend creates/finds user → issues session/JWT → frontend receives user profile (name, email, avatar).
2. **Compose → Schedule:** Frontend posts subject, body, CSV-derived recipient list, start time, delay, and hourly limit to `POST /api/campaigns`.
3. **Persistence & Enqueue:** Backend re-validates every email address, creates one `campaigns` row and one `emails` row per recipient, then enqueues one BullMQ job per email with `delay = scheduledTime - Date.now()` and `jobId = email.id`.
4. **Worker Execution:** The worker (configurable concurrency) pulls jobs from `emailQueue`, checks the email's DB status (idempotency guard), checks/increments the sender's Redis hourly counter, sends via Ethereal/Nodemailer, updates PostgreSQL, and asynchronously indexes the result into Elasticsearch.
5. **Overflow Handling:** If the hourly counter is at its limit, the job is not sent — it is rescheduled to the start of the next hour window, preserving relative send order.
6. **Notification:** The moment a sender's hourly limit is first reached in a given window, if Slack is connected, a formatted alert is posted to the configured channel.
7. **Read Paths:** The dashboard reads scheduled/sent emails from PostgreSQL (`GET /api/emails/scheduled`, `GET /api/emails/sent`) and full-text search from Elasticsearch (`GET /api/emails/search`).

### Scalability Considerations

- **Horizontal worker scaling:** Because job state lives in Redis and idempotency is enforced via `jobId = email.id` plus a DB status check, multiple worker instances can run concurrently against the same queue without risk of duplicate sends.
- **Rate limiting under concurrency:** The Redis counter increment must be atomic (`INCR`+`EXPIRE`, or preferably a single Lua script performing check-and-increment) specifically to prevent two workers from each reading a stale pre-increment count and both sending past the limit.
- **Large batches (1,000+ emails):** The system never attempts to process a full batch simultaneously. BullMQ holds all jobs in Redis; the combination of worker concurrency, per-email delay, and hourly rate limit naturally paces delivery — e.g., 1,000 emails at a 100/hour cap span roughly 10 hours, with PostgreSQL tracking state, Redis tracking rate limits, and BullMQ tracking schedule, all independently of how many are "in flight" at once.
- **Search scaling:** Because Elasticsearch is a derived index rather than the source of truth, it can be rebuilt from PostgreSQL at any time without data loss risk, and search load never competes with transactional write load on the primary database.

### Security Considerations

- All dashboard and campaign APIs require a valid session/JWT; unauthenticated requests are rejected.
- Google OAuth means Sendwise never stores or handles user passwords.
- SMTP credentials and Slack access tokens are stored server-side only and are never returned to the frontend in any API response.
- All OAuth client secrets and SMTP credentials are stored in environment variables, never committed to source control.
- All campaign inputs (`subject`, `body`, `emails`, `startTime`, `delaySeconds`, `hourlyLimit`) are server-side validated regardless of client-side checks already performed.
- **Documented gap for this assignment scope:** Slack access tokens and SMTP passwords are stored in plaintext in PostgreSQL. A production system would encrypt these at rest (e.g., via `pgcrypto` or an application-layer KMS-backed encryption scheme); this is called out explicitly in the README as a known, deliberate scope reduction rather than an oversight.
- Public-facing endpoints (notably OAuth callbacks) should have basic API rate limiting applied to reduce abuse surface.

---

## 6. Functional Requirements

Priority key: **P0** = must work for MVP acceptance, **P1** = required for full assignment scope, **P2** = polish/nice-to-have.

### FR-01 — Google Sign-In (P0)

**User story:** As a user, I want to log in with my Google account so that I don't need to create or remember a separate password.

**Flow:** `Google → Backend callback → Create/find user → Create session/JWT → Dashboard`

**Acceptance criteria:**
- Clicking "Continue with Google" initiates the Google OAuth consent flow.
- On successful auth, a user record is created if one doesn't already exist (matched by `google_id`), or the existing one is reused.
- Name, email, and avatar are displayed in the dashboard header immediately after login.
- Failed or cancelled OAuth attempts return the user to the login screen with a visible error, not a blank page.

### FR-02 — Logout (P0)

**User story:** As a user, I want to log out so that my session doesn't remain active on a shared device.

**Acceptance criteria:**
- Clicking "Logout" clears the session/JWT client- and server-side.
- User is redirected to the login screen.
- Any subsequent request to a protected API with the old token returns `401 Unauthorized`.

### FR-03 — Dashboard Overview (P0)

**User story:** As a user, I want a single dashboard showing my identity, navigation, and a way to start a new campaign.

**Acceptance criteria:**
- Header shows logo, avatar, name, email, and a logout control.
- Navigation exposes "Scheduled Emails" and "Sent Emails" views plus Slack connection status.
- A prominent "Compose New Email" action is always visible.
- Empty states are shown when no scheduled or sent emails exist yet ("No scheduled emails yet." / "No sent emails yet.") with a call to action to compose one.

### FR-04 — CSV Lead Upload & Client-Side Preview (P0)

**User story:** As a user, I want to upload a CSV of email addresses and immediately see how many valid, de-duplicated recipients were detected.

**Acceptance criteria:**
- Accepts a CSV with an `email` column.
- Frontend parses the file, performs basic email-format validation, removes duplicates, and displays a count (e.g., "125 email addresses detected").
- This client-side check is explicitly a UX convenience only — it is never treated as authoritative.

### FR-05 — Backend Email Re-Validation (P0)

**User story:** As the system, I must never trust client-supplied email validation, so that malformed or malicious input cannot corrupt a campaign.

**Acceptance criteria:**
- `POST /api/campaigns` independently validates every email address in the payload server-side.
- Invalid entries are rejected with a clear error identifying which addresses failed and why, following the standard error shape (`{ "success": false, "message": "..." }`).
- A campaign is only created once all required fields (`subject`, `body`, `startTime`, `delaySeconds`, `hourlyLimit`, `emails[]`) pass validation.

### FR-06 — Compose & Schedule Campaign (P0)

**User story:** As a user, I want to compose a subject/body, set a start time, per-email delay, and hourly limit, and schedule the campaign in one action.

**Flow:** `Validate request → Validate emails → Create campaign → Create email records → Create BullMQ jobs → Return campaign ID`

**Acceptance criteria:**
- Compose modal/page collects: subject, body, CSV upload, start time, delay between emails (seconds), and hourly limit.
- On submit, exactly one `campaigns` row and one `emails` row per recipient are created in PostgreSQL.
- Exactly one BullMQ job is created per email, scheduled at `startTime + (index × delaySeconds)`, using `jobId = email.id`.
- On success, the frontend shows a confirmation (e.g., "✓ 25 emails scheduled successfully") and the new campaign's ID is returned to the client.
- On failure, the frontend shows a clear error (e.g., "❌ Failed to schedule emails") without leaving partial data in an inconsistent state.

### FR-07 — Durable, Delayed Job Scheduling via BullMQ/Redis (P0)

**User story:** As the system, I must schedule per-email sends using durable, Redis-backed jobs — never `setInterval`, cron, `node-cron`, or `agenda` — so that scheduled work survives a process crash.

**Acceptance criteria:**
- Every scheduled email corresponds to exactly one BullMQ job on the `emailQueue`, with a computed `delay` and `jobId = email.id`.
- No scheduling logic anywhere in the codebase depends on an in-process timer surviving until the target send time.
- Job payload contains at minimum `{ emailId, campaignId, senderId }`; the worker fetches full state from PostgreSQL rather than trusting stale job payload data.

### FR-08 — Configurable Worker Concurrency (P1)

**User story:** As an engineer, I want to control how many jobs the worker processes in parallel via an environment variable.

**Acceptance criteria:**
- `WORKER_CONCURRENCY` env var directly configures the BullMQ `Worker`'s `concurrency` option.
- Changing the value and restarting the worker visibly changes how many jobs run in parallel (observable in Bull Board).

### FR-09 — Redis-Backed Hourly Rate Limiting (P0)

**User story:** As a sender, I must never send more than my configured hourly limit, even when multiple worker processes are running concurrently.

**Flow:** `Receive job → Get sender → Get current hour window → Check Redis counter → Counter < limit? → Send + increment, or reschedule`

**Acceptance criteria:**
- Rate-limit state is stored in Redis under a key such as `email-rate:{senderId}:{hourWindow}` — never in an in-process variable.
- The check-and-increment operation is atomic (via `INCR`+`EXPIRE` or a Lua script) so two concurrent workers cannot both read a pre-increment count and both send, exceeding the limit.
- An email arriving after the hourly cap is reached is neither failed nor dropped — its BullMQ job is rescheduled to the next available hour window.
- Relative send order is preserved across the rescheduling boundary (e.g., emails 101–150 of a 150-email batch with a 100/hour cap are sent first-in-first-out in hour two).

### FR-10 — Idempotent Sends (P0)

**User story:** As a recipient, I must never receive a duplicate email due to a retry, a re-processed job, or a worker restart.

**Acceptance criteria:**
- Every BullMQ job's `jobId` is the corresponding `email.id`, so re-enqueuing the same email is a no-op at the queue level.
- Before sending, the worker checks the email's current DB status; if it is already `sent`, the worker returns immediately without contacting the SMTP server.
- This guarantee holds even if the same job is somehow delivered to the worker twice (e.g., after a crash mid-processing).

### FR-11 — Crash & Restart Resilience (P0)

**User story:** As an engineer, I need scheduled campaigns to continue automatically after a backend restart, with zero manual intervention.

**Flow:** `Stop backend → Redis + PostgreSQL persist state → Start backend → Reconnect Redis → Worker resumes → Existing jobs continue`

**Acceptance criteria:**
- Stopping and restarting the Express/worker process does not require any manual re-scheduling.
- All jobs that were pending before the restart are still present in Redis and are processed after the worker reconnects.
- No emails are lost, and no emails are duplicated, across a restart (validated in combination with FR-10).

### FR-12 — Email Sending via Ethereal/Nodemailer (P0)

**User story:** As the system, I need to actually deliver each scheduled email through a safe, testable SMTP provider.

**Flow:** `Worker → DB status = processing → Rate-limit check → SMTP connection (Nodemailer) → Ethereal → Success/Failure → Update DB`

**Acceptance criteria:**
- The worker uses Nodemailer configured against Ethereal SMTP credentials from environment variables.
- On success, the email's status is updated to `sent`, `sent_at` is set, and the Ethereal preview URL is captured (surfaced in logs/demo).
- On failure, status is set to `failed` with a captured `error_message`, subject to the retry policy in FR-13.

### FR-13 — Retry with Exponential Backoff (P1)

**User story:** As the system, I should retry a temporary send failure a bounded number of times, with increasing delay, rather than retrying forever or giving up immediately.

**Acceptance criteria:**
- BullMQ job options specify a maximum of 3 attempts with exponential backoff between retries.
- Permanent failures (e.g., malformed recipient rejected by SMTP) do not consume all retry attempts pointlessly — they are marked `failed` promptly with a descriptive `error_message`.

### FR-14 — Multiple Senders (P1)

**User story:** As the system, I should support multiple Ethereal sender accounts, each with its own independent hourly rate limit.

**Acceptance criteria:**
- A `senders` table stores one or more sender identities with their own SMTP credentials and `hourly_limit`.
- Rate-limit counters are scoped per `senderId`, so two senders can send concurrently without interfering with each other's limits.

### FR-15 — Scheduled & Sent Email Views (P0)

**User story:** As a user, I want to see which of my emails are still scheduled and which have already gone out.

**Acceptance criteria:**
- `GET /api/emails/scheduled` and `GET /api/emails/sent` return correctly filtered, correctly shaped data per the API spec in Section 7.
- Frontend renders each as a table (`Email | Subject | Scheduled/Sent Time | Status`) with a loading state and an empty state.
- Status badges are rendered distinctly for `Scheduled`, `Processing`, `Sent`, and `Failed`.

### FR-16 — Elasticsearch Indexing & Search (P1)

**User story:** As a user, I want to search across all my emails by recipient, subject, or status, quickly.

**Flow:** `PostgreSQL (sent) → Elasticsearch index → GET /api/emails/search?q=... → Results`

**Acceptance criteria:**
- On every meaningful status change (and at minimum on send), the email record is indexed/updated in an `emails` Elasticsearch index.
- `GET /api/emails/search?q=<term>` searches across `recipient`, `subject`, and `status` and returns matching results.
- Elasticsearch is never queried as the source of truth for anything other than search results — all authoritative reads go to PostgreSQL.

### FR-17 — Slack Connection (P1)

**User story:** As a user, I want to connect my Slack workspace so I can be notified about important sending events.

**Flow:** `Connect Slack → Slack OAuth → Allow → Callback → Exchange code for token → Store token → Connected`

**Acceptance criteria:**
- "Connect Slack" initiates the Slack OAuth flow and, on success, stores the access token and target channel server-side (never exposed to the frontend).
- Dashboard reflects connection status ("Slack ✓ Connected").
- "Disconnect Slack" (`DELETE /api/slack/disconnect`) cleanly removes the stored connection; subsequent rate-limit events silently skip notification without error.

### FR-18 — Rate-Limit Slack Notification (P1)

**User story:** As an operator, I want to be proactively notified in Slack the moment a sender hits its hourly cap.

**Acceptance criteria:**
- The first time a sender's hourly counter reaches its limit within a given hour window, a formatted message is posted to the connected Slack channel, including sender, limit, time window, and a note that sending resumes next hour.
- If Slack is not connected, this step is silently skipped — it never causes a job failure or worker crash.

### FR-19 — Bull Board Queue Dashboard (P1)

**User story:** As an engineer, I want a live view into queue state so I can observe and debug scheduling behavior in real time.

**Acceptance criteria:**
- Bull Board is mounted at an admin route (e.g., `/admin/queues`) and reflects the live state of the `emailQueue`: waiting, active, delayed, completed, and failed jobs.
- No custom UI work is required beyond wiring Bull Board to the existing queue — this is intentionally scoped to be low-effort, high-visibility.

### FR-20 — Consistent Error Handling (P2)

**User story:** As a frontend developer, I want every backend error to follow the same shape so I can render errors generically.

**Acceptance criteria:**
- All API error responses use `{ "success": false, "message": "<human-readable message>" }`.
- The frontend has a single generic error-rendering path that works for any endpoint.

---

## 7. API Specifications

All authenticated endpoints require a valid session/JWT (see FR-01/FR-02); unauthenticated requests return `401 Unauthorized` with the standard error shape.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/google` | Initiates Google OAuth flow |
| GET | `/api/auth/google/callback` | Google OAuth callback; creates/finds user, issues session |
| GET | `/api/auth/me` | Returns the currently authenticated user's profile |
| POST | `/api/auth/logout` | Clears session/token |

### Campaigns & Emails

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/campaigns` | Creates a campaign and schedules all associated emails |
| GET | `/api/emails/scheduled` | Lists all not-yet-sent emails for the current user |
| GET | `/api/emails/sent` | Lists all sent emails for the current user |
| GET | `/api/emails/search` | Full-text search across recipient/subject/status via Elasticsearch |
| GET | `/api/emails/:id` | Fetches a single email record's full detail |

### Slack

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/slack/connect` | Initiates Slack OAuth flow |
| GET | `/api/slack/callback` | Slack OAuth callback; exchanges code for token, stores connection |
| GET | `/api/slack/status` | Returns current Slack connection status |
| DELETE | `/api/slack/disconnect` | Removes the stored Slack connection |

### `POST /api/campaigns` — Request Example

```json
{
  "subject": "Hello",
  "body": "This is a test email",
  "startTime": "2026-09-27T15:00:00Z",
  "delaySeconds": 2,
  "hourlyLimit": 100,
  "emails": [
    "test1@example.com",
    "test2@example.com",
    "test3@example.com"
  ]
}
```

**Processing order:** validate request → validate every email → create campaign → create one email record per recipient → create one BullMQ delayed job per email → return the campaign ID.

**Response (success):**
```json
{
  "success": true,
  "campaignId": "c7a1e9f0-...",
  "emailsScheduled": 3
}
```

### `GET /api/emails/scheduled` — Response Example

```json
{
  "emails": [
    {
      "id": "123",
      "recipient": "abc@gmail.com",
      "subject": "Hello",
      "scheduledAt": "2026-09-27T15:00:00Z",
      "status": "scheduled"
    }
  ]
}
```

### `GET /api/emails/sent` — Response Example

```json
{
  "emails": [
    {
      "id": "123",
      "recipient": "abc@gmail.com",
      "subject": "Hello",
      "sentAt": "2026-09-27T15:00:04Z",
      "status": "sent"
    }
  ]
}
```

### `GET /api/emails/search?q=<term>`

Searches `recipient`, `subject`, and `status` fields via Elasticsearch. Example: `?q=invoice` returns any email whose recipient, subject, or status contains "invoice."

### Authentication & Rate Limiting

- All `/api/campaigns` and `/api/emails/*` routes require a valid session/JWT, enforced via `auth.middleware.ts`.
- Public-facing routes (OAuth entry points) should have basic per-IP request rate limiting to reduce abuse.

### Error Handling

All errors follow a single consistent shape:

```json
{
  "success": false,
  "message": "Invalid email address"
}
```

---

## 8. Data Models

### Entity Relationship Overview

```
User
 ├── Campaign(s)
 ├── Sender(s)
 └── SlackConnection

Campaign
 └── Email(s)

Sender
 └── Email(s)
```

### `users`

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| google_id | string | Unique, from Google OAuth |
| name | string | |
| email | string | Unique |
| avatar_url | string | |
| created_at | timestamp | |
| updated_at | timestamp | |

### `campaigns`

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | FK → users.id |
| subject | string | |
| body | text | |
| start_time | timestamp | |
| delay_seconds | integer | |
| hourly_limit | integer | |
| status | enum | `scheduled`, `processing`, `completed`, `paused`, `failed` |
| created_at | timestamp | |
| updated_at | timestamp | |

### `emails`

The most important table in the system — every recipient of every campaign gets exactly one row.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key; also used as the BullMQ `jobId` |
| campaign_id | uuid | FK → campaigns.id |
| user_id | uuid | FK → users.id |
| sender_id | uuid | FK → senders.id |
| recipient | string | Validated email address |
| subject | string | Denormalized from campaign at schedule time |
| body | text | Denormalized from campaign at schedule time |
| scheduled_at | timestamp | Computed as `startTime + index × delay` |
| sent_at | timestamp | Null until sent |
| status | enum | `scheduled`, `processing`, `sent`, `failed` |
| attempts | integer | Retry count |
| message_id | string | SMTP/Ethereal message identifier |
| error_message | string | Populated on failure |
| created_at | timestamp | |
| updated_at | timestamp | |

### `senders`

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | FK → users.id |
| email | string | e.g. `sender1@ethereal.email` |
| smtp_host | string | |
| smtp_port | integer | |
| smtp_user | string | |
| smtp_password | string | Never exposed to frontend; plaintext storage is a documented MVP-scope limitation |
| hourly_limit | integer | |
| created_at | timestamp | |

### `slack_connections`

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | FK → users.id |
| team_id | string | |
| access_token | string | Never exposed to frontend; plaintext storage documented as a scope limitation |
| channel_id | string | |
| connected | boolean | |
| created_at | timestamp | |
| updated_at | timestamp | |

### Data Validation Rules

- `emails[]` — every entry must pass RFC-5322-reasonable email format validation server-side, independent of any frontend check.
- `subject`, `body` — required, non-empty.
- `startTime` — required, must be a valid ISO-8601 timestamp.
- `delaySeconds` — required, non-negative integer.
- `hourlyLimit` — required, positive integer.

### Storage Requirements

- **PostgreSQL** is the authoritative store for all entities above and must never lose data on Elasticsearch or Redis failure.
- **Redis** stores only ephemeral/derived state: BullMQ job data and hourly rate-limit counters (each counter keyed to its hour window and allowed to expire naturally).
- **Elasticsearch** stores a denormalized, rebuildable copy of email records (`id`, `recipient`, `subject`, `status`, `sentAt`) purely for search; it is never a required dependency for core send/schedule correctness.

---

## 9. Implementation Plan

### Priority-Ordered Build Sequence

**🔴 Priority 1 — Core send path (must work)**
PostgreSQL schema · Redis · Express API skeleton · BullMQ queue · Email worker · Ethereal integration · `POST /api/campaigns` · `GET /api/emails/scheduled` & `/sent` · React dashboard shell

**🟠 Priority 2 — Correctness under real-world conditions**
Google OAuth · configurable worker concurrency · Redis-atomic hourly rate limiting · rescheduling on limit-hit · idempotent sends (`jobId = email.id` + status guard)

**🟡 Priority 3 — Observability & input UX**
Elasticsearch indexing + search · Bull Board · CSV upload with client-side preview

**🟢 Priority 4 — Integrations & polish**
Slack OAuth · Slack rate-limit notification · UI polish (status badges, loading/empty states) · search UI

> Slack and Elasticsearch are explicit assignment requirements and must not be omitted from final submission — if time is tight, ship their smallest functional version rather than an elaborate UI around them.

### Sprint Breakdown (assuming a single full-stack engineer, ~4–5 focused hours)

| Phase | Duration | Scope |
|---|---|---|
| Phase 1 — Foundations | ~60 min | Docker Compose (Postgres/Redis/Elasticsearch), Prisma schema + migrations, Express skeleton, BullMQ queue + worker stub |
| Phase 2 — Core Send Path | ~90 min | `POST /api/campaigns`, delayed job creation, worker send logic via Ethereal, scheduled/sent read APIs, minimal React dashboard + compose form |
| Phase 3 — Correctness | ~60 min | Google OAuth, Redis-atomic rate limiting + reschedule-on-limit, idempotency guard, restart verification |
| Phase 4 — Observability & Search | ~45 min | Elasticsearch indexing on send, search endpoint + UI, Bull Board mount |
| Phase 5 — Slack & Polish | ~45 min | Slack OAuth connect/disconnect, rate-limit notification, status badges, empty/loading states, error handling pass |
| Phase 6 — Demo Prep | ~30 min | README architecture write-up, `.env.example`, restart demo rehearsal, 5-minute video recording |

### Team Composition

This scope is designed to be buildable by a **single full-stack engineer** comfortable with TypeScript across the stack. No dedicated design, QA, or DevOps resourcing is assumed; Docker Compose replaces the need for managed infrastructure during development.

### Dependencies

- Google Cloud OAuth client credentials must exist before FR-01 can be implemented end-to-end.
- Slack app credentials (client ID/secret, redirect URI) must exist before FR-17/FR-18.
- Ethereal test SMTP accounts (created ad hoc — no signup required) must exist before FR-12.

### Explicitly Out of Scope (Do Not Over-Invest Here)

❌ Complex campaign editor · ❌ Advanced analytics · ❌ Rich text email editor · ❌ Multiple dashboard pages · ❌ Advanced Elasticsearch UI · ❌ Fancy animations/transitions · ❌ Complex global state management · ❌ Microservices decomposition

### Demo Script (5 Minutes)

| Time | Segment |
|---|---|
| 0:00–0:30 | Architecture walkthrough: React → Express → Postgres/Redis/Elasticsearch → BullMQ Worker → Ethereal |
| 0:30–1:00 | Google login → dashboard |
| 1:00–2:00 | Compose email, upload `leads.csv` (10 detected), set delay=2s / hourly limit=5, click Schedule |
| 2:00–2:45 | Scheduled Emails table + Bull Board (Delayed/Waiting/Active/Completed) |
| 2:45–3:30 | Watch scheduled → sent transition; open an Ethereal preview |
| 3:30–4:15 | **Restart demo:** schedule a future email → stop backend → start backend → confirm it still sends with no manual intervention |
| 4:15–5:00 | Rate-limit demo: hourly limit=5, schedule 10 → show 5 sent / 5 deferred → show resulting Slack notification |

---

## 10. Success Metrics

| KPI | Target | Measurement Method | Review Interval |
|---|---|---|---|
| Scheduled-to-delivered completion rate | 100% (excluding permanent SMTP failures) | Compare `emails` rows with `status=scheduled` at T0 to `status=sent` after all scheduled times elapse | Per demo run / per test cycle |
| Rate-limit compliance | 0 emails sent above `hourlyLimit` per sender per hour window | Query `emails.sent_at` grouped by sender + hour, compare count to `senders.hourly_limit` | Per demo run |
| Duplicate-send incidents | 0 | Count of `emails` rows with `status=sent` and `message_id` set more than once for the same `id` | Continuous / per restart test |
| Restart recovery success | 100% of pre-restart pending jobs resume without manual re-scheduling | Manual restart test per demo script Section 9 | Per release / per demo |
| Search response time | < 1 second (p95) | Timed `GET /api/emails/search` calls against a seeded index | Per test cycle |
| Time-to-first-scheduled-campaign | < 2 minutes from login | Manual UX timing / usability walkthrough | Pre-demo validation |
| Slack notification delivery on rate-limit hit | 100% when connected; 0 errors when disconnected | Manual test: trigger limit with Slack connected and disconnected | Per test cycle |
| Feature checklist completion | 100% of Priority 1–3 items; Priority 4 items functional at minimum | Section 9 checklist walkthrough before submission | Pre-submission |

---

## Appendix A — Environment Configuration Reference

```
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sendwise
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200

WORKER_CONCURRENCY=5
MIN_EMAIL_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=100

SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=http://localhost:5000/api/slack/callback

FRONTEND_URL=http://localhost:5173
```

## Appendix B — Suggested Project Structure

```
sendwise/
├── backend/
│   └── src/
│       ├── config/        (db.ts, redis.ts, env.ts)
│       ├── controllers/   (auth, email, slack)
│       ├── routes/        (auth, email, slack)
│       ├── services/      (email, scheduler, rateLimit, slack, search)
│       ├── workers/       (email.worker.ts)
│       ├── queues/        (email.queue.ts)
│       ├── middleware/    (auth.middleware.ts)
│       ├── models/
│       ├── utils/
│       ├── app.ts
│       └── server.ts
├── frontend/
│   └── src/
│       ├── components/    (Button, Input, Modal, Header, EmailTable, Loading)
│       ├── pages/         (Login, Dashboard, ComposeEmail)
│       ├── services/      (api.ts)
│       ├── types/         (email.ts)
│       ├── hooks/         (useAuth.ts)
│       ├── App.tsx
│       └── main.tsx
├── docker-compose.yml
├── README.md
└── .gitignore
```

## Appendix C — Final Feature Checklist

**Backend:** Express + TypeScript · PostgreSQL · Redis · BullMQ · Delayed jobs · Worker · Configurable concurrency · Configurable delay · Hourly rate limit · Redis-backed rate counter · Rescheduling after limit · Idempotency · Ethereal SMTP · Elasticsearch indexing · Elasticsearch search · Bull Board · Google OAuth · Slack OAuth · Slack notification

**Frontend:** Google login · Dashboard · User name/email/avatar · Logout · Compose email · CSV upload · Email count · Start time · Delay · Hourly limit · Scheduled table · Sent table · Loading state · Empty state · Error messages · Search

**DevOps:** Docker Compose · `.env.example` · README · GitHub repository · Demo video · Restart demonstration
