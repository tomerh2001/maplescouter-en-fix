# External connectivity investigation, September 7, 2026

## Confirmed cloud failure

Cloudflare's Geoblock custom rule rejected a Firefox HEAD request to the character API before it reached Traefik or Fastify. The browser also reported a missing CORS header because the firewall response did not contain the application's headers.

The existing rule now excludes only `scouter.tomerh2001.com`. It remains active for other hostnames, with the existing country and source-address conditions retained. No Authentik, CrowdSec, TLS, or backend rate-limit changes were made.

The local network uses split DNS: the cloud hostname resolves to `10.40.0.9` here. A successful local request alone cannot verify the public Cloudflare route.

After the change, independent Globalping probes in Mexico City, Falkenstein, and London sent HEAD requests with `Origin: https://maplescouter.com` to `/v1/characters/msfixnetprobe`. All three received the expected application 404 for that nonexistent character and `Access-Control-Allow-Origin: *`, instead of a firewall 403. Measurement ID: `2NXwsauJhhlVQzaPJ000215po`.

## Calculation comparison

The affected character's older cloud preset was tested on the native live site without the extension, then with the shipped 1.7.0 code through the local test proxy. Normal, HEXA, Boss 300, and Boss 380 agreed in both runs and were positive. The same results remained positive with the 1.7.1 changes.

This does not reproduce the reported calculation failure: the saved cloud copy predates the screenshot and several visible input values differ. The JSON downloaded from the failing input page is still needed. Cloud connectivity does not supply MapleScouter's calculation results; those come from `api.maplescouter.com`.

## Client fixes in 1.7.1

- Load the preset's region into the site's live region store before loading its draft. Previously, the form's mount effect could rewrite a GMS preset to the browser's default KMS region.
- Treat readable 401/403, server failures, and invalid or interrupted successful responses as unavailable, rather than reporting a successful cloud check.
- Keep avatar failures and cached avatar successes independent of character sync status.
- Show unavailable status for linked characters even if they have never been uploaded. A failed retry no longer produces a success toast.

Validation: `node --test test/cloud-connectivity.test.cjs` passes 27 checks. The internal browser verified a GMS import from a KMS starting state, automatic GMS selection, and the unchanged calculation values. Builds produce both Chrome and Firefox packages. These checks do not establish that every class or input combination calculates correctly.
