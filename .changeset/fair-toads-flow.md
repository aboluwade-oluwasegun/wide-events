---
"@wide-events/collector": patch
---

Fix container healthchecks on slim Node images by installing curl and adding a collector Docker smoke test in CI so `/health` probes keep working in Coolify-style HTTP checks.
