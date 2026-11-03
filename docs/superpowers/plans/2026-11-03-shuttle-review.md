# Shuttle review and heatmap upgrade

Goal: expose actual camera-space shuttle observations, reviewable hit candidates,
manual rally boundaries, and a high-contrast occupancy heatmap in the existing
local workbench and static publication. Keep the current inference models.

Architecture: a new pure Python shuttle analysis module consumes TrackNet CSV
and preserves missing observations. Its report lives in summary.json, with a
CSV fingerprint in the report; publication verifies the fingerprint. The local
API stores frame-based manual decisions against the current run, separately
from raw detections. The existing video displays a synchronized canvas overlay.
Static publications are read-only. Existing publications without ball data
remain valid. Shared heatmap color interpolation uses Node-testable functions.

Constraints: no copying from the unlicensed reference repository; no inferred
landing, score or 3-D speed. Automatic events remain candidates. A partial clip
or one observed player must work. No cross-gap trails, no fabricated ball data.
No new runtime dependencies. Detectable visibility is not detection accuracy.

- [x] Add tests and Python shuttle report, seconds/normalized-image thresholds,
  explicit missing states, provenance, reviewed events and manually bounded rallies.
- [x] Integrate report generation, local review endpoint and public export;
  preserve older datasets and cloud read-only results.
- [x] Add camera-space trail toggle, event timeline/review, bilingual labels and
  blue/cyan/yellow/red heatmap with an explicit scale; update static asset packaging.
- [x] Test actual sample and student data, missing detections, partial/short clips,
  one player, FPS invariance, manual validation and publication fingerprints.
- [x] Browser-test playback/seek/switch/language/review, run regression tests,
  review the diff, publish eligible real results and verify the live deployment.

Validation: 51 Python tests and 36 Node tests passed. Isolated browser verified real heatmap colors, exact video seek, synchronized observed shuttle points, bilingual/mobile layout and local review persistence. Public student detections remain sparse and unconfirmed. Static media range transport streams without whole-video buffering.
