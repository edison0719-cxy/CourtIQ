# CourtIQ · Static results deployment

[简体中文](CLOUD_DEPLOY.zh-CN.md) · [Project README](README.md)

The default edition computes locally and publishes reviewed results. It serves real JSON, CSV and charts with bilingual visualizations and observed trajectory replay. It has no upload API, online inference or login dependency.

## Reuse the existing GitHub connection

| Setting | Value |
| --- | --- |
| Repository | `edison0719-cxy/CourtIQ` |
| Production branch / root | `main` / `/` |
| Build command | `npm ci --include=dev` |
| Deploy command | `npm run cloud:deploy:git` |

Push the latest code, save these settings, disable Preview builds, and retry the latest commit. All old `COURTIQ_*` build variables are unused and may be removed. `SKIP_DEPENDENCY_INSTALL=1` may remain; the explicit build command installs JavaScript tools. Python analysis requirements now live under `requirements/analysis.txt` to prevent automatic root-level pip installation.

The assets-only `wrangler.site.jsonc` enables **https://courtiq.edisonruby419.workers.dev**. No purchased domain, Zero Trust signup, payment details, D1 ID, Access team/AUD, internal secret, R2, Queues, models, Containers or Docker are required by this configuration. Existing database resources are untouched. If a separate Access application already protects this hostname, remove that showcase restriction in your own dashboard. [Cloudflare documents free static asset requests](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/); asset size/count and build quotas still apply.

## Validate and publish data

```sh
npm ci --include=dev
npm test
npm run build:site
npm run site:dev
```

`dist/` is generated, not committed. The build never reads local credentials, recordings or models. `published/` contains the clearly labeled upstream example: its explicitly approved 30-second original, a five-second overlay, animation and statistics. It makes no student performance claims. Follow the README's explicit `publish.py` command to export reviewed local results; push the generated publication files to update the site. Original footage is excluded by default; `--videos` explicitly includes reviewed match MP4s. Cohort editing and manual outcome entry remain in the local workstation.

---

# Optional appendix: full cloud uploads and inference (not currently deployed)

The following instructions apply only if online processing is deliberately enabled later. They involve paid resources and identity configuration; the static site uses none of them.

The local `python app.py` workstation remains available. The cloud edition uses Workers static assets, Cloudflare Access, private R2, D1, Queues and Python Containers. Uploading `static/` to Pages alone does not deploy analysis.

## Recommended: deploy directly from GitHub

Workers Builds can build this Dockerfile directly from GitHub; local Docker is unnecessary for this route. GitHub sign-in authenticates the Cloudflare account, while connecting the repository separately enables builds. See [Cloudflare’s official container build instructions](https://developers.cloudflare.com/containers/guides/deploy/).

1. Push the latest code to `edison0719-cxy/CourtIQ`.
2. Enable Workers Paid and R2 after the account owner confirms billing. Create D1 `courtiq`, private R2 `courtiq-private` and Queue `courtiq-analysis`; retain the D1 UUID.
3. Choose/view the account’s `workers.dev` subdomain. The Worker name is `courtiq`, so the production origin is `https://courtiq.<account-subdomain>.workers.dev`; no purchased domain is required.
4. Create a hostname-based Access application allowing only the intended user emails. Record the team domain and AUD. Create the more specific `/internal/storage/*` Bypass application described below.
5. In Workers & Pages → Create application → GitHub, import the repository. Set Worker name `courtiq`, production branch `main`, root `/`, build command `npm ci --include=dev`, deploy command `npm run cloud:deploy:full`.
6. Set these under Settings → Builds → Variables and secrets before retrying the initial build:

| Build variable | Value |
| --- | --- |
| `COURTIQ_PUBLIC_ORIGIN` | Actual full `https://courtiq.<account-subdomain>.workers.dev` origin |
| `COURTIQ_ACCESS_TEAM_DOMAIN` | Actual `https://<team>.cloudflareaccess.com` domain |
| `COURTIQ_ACCESS_AUD` | Main Access application’s AUD tag |
| `COURTIQ_D1_DATABASE_ID` | Actual D1 database UUID |
| `COURTIQ_INTERNAL_SECRET` | Random value of at least 32 characters; save as a build Secret |

The script validates settings, generates configuration, applies D1 migrations and runs full `wrangler deploy`. It passes the runtime secret via a temporary file that is excluded from Git and Docker and removed afterwards. Do not commit local configuration, passwords or OAuth tokens. Missing settings stop deployment with an actionable error.

7. Upload the two genuine models once to private R2 keys `models/TrackNet_best.pt` and `models/yolov8s-pose.pt`, through the R2 dashboard or the optional existing seed command. Keep weights outside Git.
8. Run/retry the production build, inspect its logs, wait for container provisioning and complete the five-second real-video acceptance test below. Later pushes to `main` deploy automatically.

The local Docker/CLI prerequisites below apply only if choosing local deployment instead.

## Runtime

Access JWTs are verified before every private request. D1 records are scoped to the token subject; the R2 bucket stays private. Source videos upload in 8 MiB parts, with per-part SHA-256 checks when resuming and a server-computed final source hash. Select the same file again after pausing.

Queues contain identifiers only. A D1 admission slot permits one CPU inference at a time; the second container serves metadata, previews and statistics. Up to 20 records can wait. Polling sends a new delayed message rather than keeping a queue invocation open during inference. A two-minute watchdog recovers missing messages. A closed browser does not stop processing.

Container disks are disposable. Interrupted runs restart from R2, with at most three starts. Outputs also upload in 8 MiB parts. A final `completion.json` commits the artifact set before D1 becomes completed, allowing a fresh process to recover completed work without rerunning inference. Existing math, statistics, bilingual controls and city-planning views share the local implementation.

Defaults: 4 GiB sources, the first 300 seconds per analysis, and a two-hour deadline including queue time. Begin with a five-second recording to benchmark CPU runtime and cost before changing `MAX_ANALYSIS_SECONDS` or `MAX_JOB_SECONDS` (maximum 7,200 seconds). These limits are not a real-time performance guarantee.

## Account and resources

You need a Cloudflare-managed custom domain, Workers Paid and Containers availability, Node 22+, Python 3.13 and a running Docker daemon. Containers incur usage charges in addition to the Workers plan; see [official pricing](https://developers.cloudflare.com/containers/platform/pricing/). The configuration caps the deployment at two `standard-4` instances. Preparing this code does not enable billing.

From the project directory:

```sh
npm ci
npm test
.venv/bin/python -m unittest discover -s tests -q
npm run cloud:check
npx wrangler login
npx wrangler d1 create courtiq
npx wrangler r2 bucket create courtiq-private
npx wrangler queues create courtiq-analysis
```

Keep the returned D1 database UUID. Cloudflare authentication is separate from your existing GitHub accounts and SSH keys. Download the original model weights as described in the README; do not commit them.

## Access and storage callbacks

In Zero Trust → Access controls → Applications, create a self-hosted application for the custom domain. Allow only the intended student/coach email addresses, using email PINs or your identity provider. Copy its AUD tag and `https://TEAM.cloudflareaccess.com` team domain.

**Create a second, more specific Access application on the same host for `/internal/storage/*`, with a Bypass → Everyone policy.** Containers need this path for storage callbacks. The Worker still requires a short-lived, signed HS256 capability scoped to an owner, session, run, filename and operation. Requests without a capability return 401. Do not bypass the whole host or `/api/*`.

Do not enable R2 public access, `r2.dev` or a public bucket domain. Browsers use the same-origin Worker; bucket CORS is unnecessary.

## Configure

Replace every argument with your real account value:

```sh
npm run cloud:configure -- \
  --origin https://YOUR_DOMAIN \
  --team-domain https://YOUR_TEAM.cloudflareaccess.com \
  --aud YOUR_ACCESS_AUD \
  --db-id YOUR_D1_UUID
```

This writes ignored `wrangler.local.jsonc`, including the custom-domain route. `workers.dev` and preview URLs remain disabled. The blank fields in the committed template intentionally require account-specific setup.

```sh
npx wrangler d1 migrations apply courtiq --remote --config wrangler.local.jsonc
npx wrangler secret put INTERNAL_SECRET --config wrangler.local.jsonc
```

Enter a random secret of at least 32 characters in the terminal. `openssl rand -hex 32` can generate one. Do not paste it into Git or chat. The Worker forwards it to the private container environment.

```sh
npm run cloud:seed
npm run cloud:seed -- --remote
npx wrangler r2 bucket lifecycle add courtiq-private courtiq-incomplete sessions/ --abort-multipart-days 1 --force
```

The first command only verifies pinned hashes. The second uploads the two real models. Optionally run `npm run cloud:seed -- --remote --example` to add the actual upstream sample for authenticated users. No student recordings are published. The lifecycle rule aborts abandoned multipart uploads after one day; the watchdog removes abandoned imports.

## Build and deploy

```sh
docker build --platform linux/amd64 -t courtiq .
npm run cloud:check -- --configured
npm run cloud:deploy
```

The Linux image installs CPU PyTorch and FFmpeg. It contains no recordings or model files; tasks download models from R2 and verify their pinned SHA-256 hashes. Two instances support one inference job and one utility service; other jobs wait.

## Acceptance

1. The main domain redirects unsigned users to Access login. Unsigned `/internal/storage/source.mp4` requests return 401.
2. Sign in and refresh the system status to inspect actual dependencies and stored models.
3. Upload authorized footage, pause/resume, inspect the preview and switch languages.
4. Calibrate the court and analyze five seconds. Close/reopen the browser and check that processing continues.
5. Play and seek the result, export files, calculate statistics and save manual training observations.
6. Sign in as another allowed user and verify that the first user's records and file links remain inaccessible.
7. Restart a test container during processing and after artifact publication. Verify retry/recovery, inspect logs and benchmark production cost.

Additional local integration validation:

```sh
npm run test:integration
# Include the real shuttle-tracking model as well:
COURTIQ_TEST_SHUTTLE=1 npm run test:integration
```

It uses temporary D1/R2, a real Python process, the actual upstream sample and existing models. It checks resumable upload, calibration, inference, durable outputs, lost-process recovery, statistics and video ranges, without modifying the local training library.

## Validation boundary

Worker compilation, emulated D1/R2 integration and native Python regression can be tested without a Cloudflare account. The Linux Docker image, live Access rules, Containers quotas and production performance require Docker and your real account. A successful local test does not establish a successful deployment.

Private sessions are not anonymous application-portfolio links. Record a demonstration or create a separate explicitly authorized public showcase; this version does not publish personal footage. Local `data/` is not migrated or synchronized automatically; re-import source recordings. Back up both D1 metadata and R2 objects.

For an existing production database, add migrations rather than editing applied ones. A 403 or login HTML during storage access usually requires checking the specific internal-path Access bypass and `PUBLIC_ORIGIN`, while retaining main-application authentication. Reupload models if checksums fail. Timeouts and exhausted restarts surface as failed jobs, never fabricated results.
