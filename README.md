# Sendwise

A full-stack email campaign scheduling platform with resilient queueing, rate limiting, and search.

## Tech Stack
- **Frontend**: React, TypeScript, Tailwind CSS, Vite
- **Backend**: Node.js, Express, TypeScript, Prisma (PostgreSQL), BullMQ (Redis), Elasticsearch
- **Infrastructure**: Docker Compose

## Quick Start

1. **Start Services**
   ```bash
   docker-compose up -d
   ```

2. **Setup Backend**
   ```bash
   cd backend
   npm install
   npx prisma generate
   npx prisma migrate dev
   npm run dev
   ```

3. **Setup Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## Environment Variables

The backend requires a `.env` file. See `backend/.env.example` (or create one) with the following structure:
```
PORT=5000
DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5433/sendwise
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
WORKER_CONCURRENCY=5
MIN_EMAIL_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=100
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=<ethereal-user>
SMTP_PASSWORD=<ethereal-password>
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
SLACK_CLIENT_ID=<slack-client-id>
SLACK_CLIENT_SECRET=<slack-client-secret>
SLACK_REDIRECT_URI=http://localhost:5000/api/slack/callback
FRONTEND_URL=http://localhost:5173
JWT_SECRET=super_secret_jwt_key
```

## Architecture

Sendwise uses **PostgreSQL** as the single source of truth for all users, campaigns, and emails.
**BullMQ (Redis)** handles durable, restart-safe job queueing and delayed scheduling. No in-memory timers (like `setInterval` or `cron`) are used.
**Redis Lua scripts** enforce atomic hourly rate limiting per sender.
**Elasticsearch** is used asynchronously as a search index for fast querying, but not for authoritative state.
**Ethereal** is used to mock SMTP email sending safely.

## Testing Instructions

1. **Verify Jobs Survive Restarts**: Schedule a campaign with a start time 10 minutes in the future. Stop the backend Node.js process. Wait 1 minute. Start the backend. The jobs will still be in BullMQ and will process correctly.
2. **Verify Rate Limiting**: Set `MAX_EMAILS_PER_HOUR=2`. Schedule 3 emails. The first 2 will be sent, the 3rd will be correctly rescheduled to the next hour (visible in BullMQ delayed queue and on the dashboard with a future time).
3. **Queue Visibility**: Visit `http://localhost:5000/admin/queues` to see Bull Board and monitor live processing.
