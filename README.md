# CourtIQ · Badminton Training Analytics

**English** | [简体中文](README.zh-CN.md)

A bilingual badminton movement and statistical research workbench. Analyze real recordings locally, then publish reviewed results as an interactive static website. The public edition needs no video upload service, inference server, login, database or model downloads. The complete local analysis workstation remains available.

## Publish the results website (default hosted edition)

```sh
npm ci --include=dev
npm run build:site
npm run site:dev
```

The site displays the real, precomputed five-second upstream example included in `published/`: a downloadable H.264 animation, interactive trajectory replay, heatmaps, spatial statistics, time-block bootstrap intervals, calibration and threshold sensitivity, and CSV/JSON/chart exports. The example is labeled and excluded from venue pilot counts. No student recordings or student performance claims are included. No original video or broadcast frames are published.

Connect this repository to Cloudflare Workers Builds: branch `main`, root `/`, build command `npm ci --include=dev`, deploy command `npm run cloud:deploy:git`. The target is an assets-only Worker using `wrangler.site.jsonc`. No `COURTIQ_*` variables, Access signup, R2, D1, Queues, Containers or paid Workers plan are required by this configuration. Existing cloud secrets are never read or bundled by the static build. See the [deployment guide](CLOUD_DEPLOY.md).

To publish a completed local run after reviewing publication rights and public metadata:

```sh
.venv/bin/python publish.py SESSION_ID --title "Public training title" --venue "Public venue label" --animation --confirm-public
npm run build:site
```

Replace `SESSION_ID` with the actual completed record ID. Commit the resulting `published/` files and push `main`. The exporter uses anonymous near/far player labels and excludes original videos, original filenames, frame images, private names, coach notes, manual assessments, logs and weights. `--animation` renders a 720p H.264 court animation and poster locally from actual observed positions; it includes no source footage. Omit that flag for data-only publication. Every exported metric and animation remains tied to its actual run and trajectory hash; animation files are also hashed. Publication makes the derived coordinates and statistics public; review them before committing. Local analysis and statistical export need the Python dependencies below; Cloudflare only packages the already-published files using Node.js.

## Start the local analysis workbench

For a fresh checkout, complete [Installation](#installation) and restore the files listed under [Source code and local assets](#source-code-and-local-assets) first.

On a Mac already configured with `.venv`, both model weights, and FFmpeg, double-click **启动CourtIQ.command**, then open <http://127.0.0.1:8765>. Keep the terminal running; press Control+C to stop the service. If CourtIQ is already running on that port, open the URL directly.

Use **中文 / EN** in the top-right corner to switch languages. The import dialog also has a language switch. Interface labels, chart labels, forms, and status messages update while preserving video playback position, analysis settings, player selection, and unsaved notes. User-entered names, notes, filenames, and original upstream logs retain their original text. The language preference is remembered in the browser.

You can also start the service from the project directory:

```sh
.venv/bin/python app.py
```

## Workflow

1. Select **Import video**, choose a real match or training clip, and enter a session name, venue, and player names. Files and results stay on the local computer.
2. Open **Court calibration** and select the four **outer doubles-court corners** in this order: far left, far right, near right, near left. Save the calibration. The coordinate origin is the far-left corner in the camera view; the full court measures 6.1 × 13.4 m. Use the doubles sidelines even when analyzing singles.
3. Analyze the first 5–30 seconds to review detection quality before processing a longer clip. Shuttle tracking adds processing time. Automatic device selection prefers an available GPU for player tracking; the upstream TrackNet stage runs on CPU in this integration and has no added MPS backend.
4. Review the original or analyzed video, near/far player heatmaps, trajectories, convex hulls, zone occupancy, zone transitions, speed profiles, and observation quality.
5. Export trajectory CSV, charts, and the analysis video. Download run parameters and methods from **Quality & methods**, and save manual observations under **Coach notes**.

**Demo video** creates a clearly labeled record from the upstream public match sample. It is neither student footage nor simulated tracking data. Check its calibration before running it. A five-second segment was used for local end-to-end validation; the source footage remains local; reviewed derived results from that run are included in `published/` for the static showcase.

Reference corners for that specific upstream sample are `(352,342), (628,343), (944,527), (52,532)`. They do not apply to other recordings.

## Statistical research and task evaluation

Open <http://127.0.0.1:8765/#research> or select **Statistical research**. Calculations read the complete trajectory CSV saved for each run, without rerunning the tracking models.

- **Single-session analysis:** speed quantiles, a speed histogram, six-zone Shannon entropy, mean-speed bootstrap intervals using 0.5 / 1 / 2 s time blocks, and sensitivity to 6 / 8 / 10 m/s motion filters.
- **Calibration error propagation:** hold detections fixed, invert the original homography to recover image positions, perturb the four corner coordinates independently with Gaussian noise at σ = 0 / 1 / 2 / 5 px, and project again. Each scenario uses 200 simulations and up to 2,500 evenly sampled positions. Outputs include mean/P95 displacement and the fraction of positions changing zones. These are sensitivity scenarios under specified errors, not measured calibration accuracy.
- **Task performance evaluation:** enter the task, attempts, successes, source-video interval, and optional review time. Manual observations are stored separately for each player. Success rates include Wilson 95% intervals; observations are not generated automatically.
- **Group comparison:** select one player per real recording and assign group A or B. For paired designs, enter matching pair IDs. Outcomes include task success rate, review time, mean speed, observed distance per minute, valid observation rate, and position hull area. **Record outcomes** opens the observation form when a task outcome is missing.
- **Comparison methods:** independent groups use Welch mean-difference intervals and Cliff’s δ; paired data use paired t intervals and Cohen’s dz. Differences are always B − A. Units are recordings or matched recording pairs, not repeated video frames. Public demos, repeated session IDs, identical source recordings, and identical trajectories cannot be counted as separate samples.
- **Exports:** statistics CSV, comparison CSV with individual recording values, and research JSON. JSON preserves run IDs, source/trajectory SHA-256 hashes, parameters, the random seed, methods, and manual-observation provenance. Research questions and group selections are stored in the browser.

The time-block bootstrap uses seed `20261026` and 2,000 resamples. Its intervals describe the distance/time ratio conditional on valid observations, assuming approximately independent blocks and a reasonably stable motion distribution. They do not include systematic detection or calibration errors. Independence between recordings or pairs must come from the study design. Small samples are flagged; unsupported intervals or p-values are omitted when sample size or variance is insufficient. P-values are two-sided and unadjusted for multiple comparisons. Wilson intervals assume binomial trials; correlated attempts require an appropriate design. Task-outcome comparisons require matching task names.

### Research workflow

The research theme is **spatial statistics and uncertainty quantification in badminton training evaluation**. Three questions can guide a study:

| Research question | Data collection and analysis | Outputs |
| --- | --- | --- |
| Are conclusions stable under calibration error? | Independently repeat four-corner annotations on the same recording, estimate annotation variation, and examine its effect with the perturbation experiment. | Annotation differences, displacement and zone-change curves, and a comparison of assumed versus observed annotation errors. |
| Does temporal dependence change the interval estimate? | Compare 0.5 / 1 / 2 s blocks on the same trajectories, accounting for continuous movement and missing observations. | Three interval estimates, valid block counts, and a stability assessment. |
| How do task performance and review efficiency change? | Define a common task, success criterion, and filming protocol; record before/after successes and review time, matching by athlete and task. | Success rates and Wilson intervals, paired differences/effect sizes, and coach review. |

Pilot data should check the workflow and estimate variability before setting a formal sample size. For a group study, prefer one predefined pair per athlete. Repeated pairs from one person are not additional independent athletes. Before/after differences support exploration; causal claims about feedback interventions need suitable randomization, controls, and execution records. The meaning of a metric depends on the task: greater speed, more movement, or higher entropy does not automatically mean better performance.

Research records should identify contributions to question definition, annotation criteria, data collection and verification, counterexample analysis, and interpretation, separately from upstream recognition models, development assistance, and statistical tooling.

Method references: [time-series block bootstrap](https://www.stat.cmu.edu/~cshalizi/uADA/16/lectures/26.pdf), [Welch test and intervals](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html), [paired t test](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_rel.html), [Wilson interval](https://docs.scipy.org/doc/scipy-1.16.1/reference/generated/scipy.stats._result_classes.BinomTestResult.proportion_ci.html), and [OpenCV homography](https://docs.opencv.org/4.x/da/d54/group__imgproc__transform.html).

## Venue upgrades and city sports research

Select **City sports planning** or open <http://127.0.0.1:8765/#city> to explore the progression from athlete feedback to venue pilots and wider sports services, with an evaluation framework for training quality and service expansion.

Venue summaries group training records available in the current workspace by their venue field and show registered venues, training records, completed analyses, and sessions with coach notes. Public demos are excluded. Records without a venue are listed separately and do not increase the registered-venue count. **Import a venue training video** opens the import dialog with the venue field focused; existing venue rows open their latest session.

These counts describe service documentation, not demonstrated training improvement. Pilot evaluation covers review efficiency, feedback comprehension, performance on standardized tasks, and service costs. City-scale expansion additionally requires multi-venue booking, utilization, demand, and transport-accessibility data. Automated facility siting, resource optimization, and causal evaluation of training effects are not implemented. This page also supports both interface languages.

## Capabilities and scope

- Designed for fixed-camera singles clips with the complete court visible. Doubles identity tracking, multiple courts, and moving cameras have not been validated.
- Outputs include descriptive statistics and exploratory intervals/comparisons under explicit assumptions. Optimal recovery positions, dynamic reachability, automatic training-quality scores, and city resource-planning models are not implemented.
- Player recognition/tracking uses the upstream pipeline. Statistics use actual detector observations; optical-flow predictions and held positions are excluded.
- Distance sums consecutive valid detections only. Frame gaps, time gaps above 0.2 s, and estimated speeds above 8 m/s are excluded. The 8 m/s cutoff is an inspectable filtering assumption, not a research finding. Localization jitter can still affect distance.
- Convex hulls describe the envelope of observed positions, and mean positions describe the selected clip. Neither establishes tactical control or optimal recovery.
- Zone transitions are empirical adjacent-frame frequencies, including self-transitions, and depend on frame rate. Standardize frame rates before comparing recordings.
- Shuttle trajectories are drawn only in the original camera view. An airborne shuttle is not mapped to the ground plane through the court homography; the software does not estimate true 3D trajectories, shuttle speed, or landing positions.
- The upstream movement-statistics overlay is disabled so that predicted/held-position metrics do not conflict with the exported observation-based report.
- The analyzed duration is explicitly displayed. Short-clip statistics do not represent a whole match.
- Intended for single-computer local use. The service listens on `127.0.0.1` and should not be exposed directly to the internet.

## Project layout

```text
app.py                 Local API, uploads, queue, records, and file downloads
pipeline.py            FFmpeg / TrackNet / player tracking / analytics workflow
analysis.py            Shared observation/motion filters, court statistics, chart exports
research.py            Time blocks, calibration perturbations, outcomes, group statistics
static/                Bilingual UI and research workspace; no frontend build or CDN
tests/                 Behavioral unit and API tests
vendor/                Upstream source and licensing notices; local weights when restored
data/sessions/<id>/    Local videos, previews, calibration, and coach notes
  runs/<run-id>/       Separate run artifacts and logs; reruns preserve earlier runs
THIRD_PARTY.md         Source attribution, integration changes, and method adaptations
```

The second upstream project’s program/notebook source, documentation, and license are retained, without its large training datasets, demo videos, or training weights. CourtIQ adapts its statistical methods rather than running its detection model. The original notebook has no `.ipynb` extension and is preserved at `vendor/Badminton_Analytics_Project/notebooks/Badminton Analysis`.

The main pipeline is based on [badminton-pipeline-repro](https://github.com/ychenfen/badminton-pipeline-repro); spatial methods are adapted from [Badminton_Analytics_Project](https://github.com/muhammadyasin79/Badminton_Analytics_Project). Their code, model weights, media, and dependencies retain their respective terms. The main upstream README states MIT for its code, but supplies no separate LICENSE file; the second project includes its MIT license. See [source attribution and integration notes](THIRD_PARTY.md) and [recorded upstream versions](UPSTREAM_VERSIONS.json).

## Source code and local assets

Git tracks the application, tests, upstream source, and provenance documents. Model weights, videos, training records, virtual environments, and local preview exports remain on the local computer. After cloning onto a new machine, obtain the following files from the [main upstream repository](https://github.com/ychenfen/badminton-pipeline-repro) and restore these paths:

- `vendor/badminton-pipeline-repro/weights/TrackNet_best.pt`
- `vendor/badminton-pipeline-repro/weights/yolov8s-pose.pt`
- `vendor/badminton-pipeline-repro/short.mp4` — needed for the public demo and related API tests.

The original upstream Git history is backed up locally in `.upstream-git/` and is not committed. Current third-party source is tracked directly in the main repository; provenance is recorded in `UPSTREAM_VERSIONS.json`.

## Installation

The validated environment uses Python 3.13 and FFmpeg. Inference requires the model weights listed above. Clone the source:

```sh
git clone https://github.com/edison0719-cxy/CourtIQ.git
cd CourtIQ
```

The following commands use macOS/Linux shell syntax. Create a separate environment:

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements/analysis.txt
.venv/bin/python app.py
```

`requirements/analysis.txt` records the direct dependency versions used for validation. API tests additionally require `httpx`, installed with `.venv/bin/python -m pip install httpx`, and the upstream `short.mp4` for the related tests. JavaScript checks require Node.js. FFmpeg is an external executable and is not installed by pip requirements.

## Validation

```sh
.venv/bin/python -m unittest discover -s tests -v
node --check static/app.js
node --check static/research.js
node --test tests/*.test.cjs
```

Encoded videos used by unit tests are temporary fixtures and never appear as training records in the workbench. Real end-to-end validation used the public upstream sample and covered shuttle tracking, player tracking, CSV, charts, and H.264 output. Successful inference alone does not establish research-grade tactical accuracy; review camera geometry, calibration, and observation quality when introducing new training footage.

## Cloudflare edition

The default deployment publishes static results only. The previous authenticated upload/inference backend remains optional under `npm run cloud:deploy:full` and requires separate paid resources and identity configuration. It is not used by the showcase. See the [Cloudflare deployment guide](CLOUD_DEPLOY.md) ([中文](CLOUD_DEPLOY.zh-CN.md)).
