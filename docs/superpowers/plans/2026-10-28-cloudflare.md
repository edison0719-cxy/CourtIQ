# CourtIQ Cloudflare Implementation Plan

> Execute inline, using the existing approved architecture and preserving the local workstation.

**Goal:** Authenticated uploads, durable analysis and research on Cloudflare.
**Architecture:** Access-verified Worker serves assets and owns D1 session metadata and private R2 objects. Queues poll idempotent per-run Containers; long inference does not hold a queue invocation open. Container processes reuse Python analysis and statistics. A scheduled watchdog recovers undelivered tasks and expires abandoned multipart uploads.
**Tech Stack:** Workers, Access, R2, D1, Queues, Containers; FastAPI/PyTorch/OpenCV/FFmpeg; vanilla frontend.
**Spec:** User-approved Cloudflare proposal in this conversation.

## Constraints
- Local mode and both UI languages continue to work; no simulated runtime/results.
- JWT verification and owner filtering apply to every private API and asset request.
- Original recordings/models/results never enter Git; container disk is disposable.
- Cloud resources and billing are not activated during implementation.
- Existing statistical calculations remain shared with the local implementation.

## Review focus
Cross-user reads/writes; replayed/stale run updates; incomplete uploads and client retries; container restart before publication; completed results surviving fresh processes.

## Tasks
- [x] 1. Gateway/storage: real Miniflare R2/D1 integration tests for isolation, multipart resume/validation, byte ranges, invalid JWTs and concurrent mutations. Implement cloud/gateway.js, cloud/auth.js, migrations, configuration and locked tooling. Test tests fail before gateway exists, then pass.
- [x] 2. Runner/shared research: Python tests for path/capability restrictions, verified model hashes, actual video probing and real statistics after hydration. Refactor shared research services without changing calculations. Add cloud_runner.py and Dockerfile. Validate local tests remain green.
- [x] 3. Orchestration: test duplicate deliveries, failed queue sends, stale run fencing, restarts and completion gates. Connect queue polling and watchdog with bounded retries/runtime; publish artifacts to R2 before D1 completion.
- [x] 4. Frontend: resumable 8 MiB chunk upload, progress/cancel, signed-in account/logout, cloud runtime status; preserve local flow. Verify through browser in both languages and mobile.
- [x] 5. Deployment: validate config and seed commands, bilingual deployment guide, full regression checks and fresh independent review. Record Docker/production validation limitations precisely.

## Decisions
- Work in the requested application directory so the user's existing launch and push workflow continues to apply.
- No separate authentication database: Cloudflare Access verifies identity; stable JWT subject keys each owner's metadata and storage.
- Chunk bytes stream through the Worker in bounded 8 MiB requests, avoiding S3 credentials in the browser and account request-size limits.
- Queue messages carry identifiers only. Polls reschedule using a new delayed message; the 15-minute queue invocation limit does not bound video processing.
- Each run has one named Container; crash retries restart from R2. Watchdog and queue retries are at-least-once; state transitions must be conditional on the current run ID.

## Verification and deployment boundary
- Python regression suite and real Miniflare D1/R2 integration run locally.
- Native integration uses actual upstream footage, both existing models (COURTIQ_TEST_SHUTTLE=1), scoped model downloads, multipart uploads/downloads, process restart recovery and research APIs.
- Playwright validated authenticated Chinese/English views at 1440×1000 and 390×844; no console errors. Browser plugin not available; installed Chrome/Playwright used.
- Worker Wrangler dry run passed with container rollout disabled. Docker is not installed; no Linux image build or real Cloudflare deployment is claimed. Account configuration and billing remain outside this implementation run.
- Independent review found and resolved multipart output limits, durable completion recovery, queue admission, CPU activity keepalive and terminal VM reclamation.
