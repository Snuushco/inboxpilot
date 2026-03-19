# InboxPilot MVP — Vercel Deployment

Inbox automation for teams. Serverless deployment on Vercel.

## Architecture
- **Static frontend:** `public/index.html` (landing), `public/app.html` (workspace), `public/app.js`
- **API routes:** `api/` — Vercel serverless functions
- **Shared lib:** `lib/` — demo engine, storage adapter, helpers, workspace builder

## Environment Variables
Set in Vercel dashboard:
- `RESEND_API_KEY` — Resend API key for transactional emails
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `ENCRYPTION_KEY` — 32-byte hex key for credential encryption

## Endpoints
- `GET /` — Landing page
- `GET /app` — Workspace UI
- `GET /health` — Health check
- `GET /api/status` — System status
- `GET /api/demo?plan=team` — Demo data
- `POST /api/signup` — Lead signup
- `GET /api/workspace?leadId=...` — Workspace data
- `GET /api/priority-queue?leadId=...` — Priority queue
- `GET /api/summaries?leadId=...` — Email summaries
- `GET /api/drafts?leadId=...` — Draft replies
- `GET /api/follow-ups?leadId=...` — Follow-ups
- `GET /api/trial-status?leadId=...` — Trial info
- `POST /api/stripe/webhook` — Stripe webhook
- `GET /api/billing/status?leadId=...` — Billing status
- `POST /api/triage/action` — Triage actions
- `GET /api/triage/history` — Triage history
- `GET /api/imap/detect?email=...` — IMAP provider detection


<!-- deployment trigger 2026-03-19T16:05:21.4250170+01:00 -->
