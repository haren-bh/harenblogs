---
name: gcp-maps-api-setup
description: >-
  Provisions Google Maps Platform APIs (Maps JavaScript, Places API New, Geocoding API)
  and a restricted API key in Google Cloud, saving GOOGLE_MAPS_API_KEY to .env.
  Use this skill whenever the user asks to enable Google Maps APIs, create a Google Maps
  API key, or configure Google Maps credentials for an agent project.
---

# Google Maps Platform API & Key Setup

Follow this runbook to enable Google Maps Platform APIs and create a restricted API key in a single pass without encountering quota project permission errors.

## Critical Rules (Avoid Re-Prompting)

1. **Always pass `--billing-project=$GOOGLE_CLOUD_PROJECT`**:
   In shared or Cloud Shell environments, the default ADC quota project often differs from the active GCP project, causing `apikeys.googleapis.com` and `serviceusage.googleapis.com` calls to fail with `PERMISSION_DENIED`. Always include both `--project` and `--billing-project`.
2. **Prepend Antigravity telemetry environment variable**:
   Always prefix `gcloud` commands with:
   ```bash
   CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity"
   ```

## Step-by-Step Procedure

### 1. Enable Required Google Maps & API Keys Services

Enable `apikeys.googleapis.com` plus the four Maps/Places/Geocoding backend services:

```bash
export PROJECT_ID=$(gcloud config get-value project)
CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud services enable \
    apikeys.googleapis.com \
    maps-backend.googleapis.com \
    places.googleapis.com \
    places-backend.googleapis.com \
    geocoding-api.googleapis.com \
    --project="$PROJECT_ID" \
    --billing-project="$PROJECT_ID"
```

### 2. Create a Restricted Google Maps API Key

Create an API key restricted purely to the four Maps/Places/Geocoding targets and capture the `keyString`:

```bash
CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
  gcloud services api-keys create \
    --display-name="Advanced Agents Codelab Maps Key" \
    --api-target=service=maps-backend.googleapis.com \
    --api-target=service=places.googleapis.com \
    --api-target=service=places-backend.googleapis.com \
    --api-target=service=geocoding-api.googleapis.com \
    --project="$PROJECT_ID" \
    --billing-project="$PROJECT_ID"
```

Retrieve the key string using `gcloud services api-keys get-key-string <KEY_UID> --project="$PROJECT_ID" --billing-project="$PROJECT_ID"` and write `GOOGLE_MAPS_API_KEY=<keyString>` into `.env`.

### 3. Validation

Verify the key works against both Places API (New) and Geocoding API:
- `POST https://places.googleapis.com/v1/places:searchText` with header `X-Goog-Api-Key: $GOOGLE_MAPS_API_KEY` and `X-Goog-FieldMask: places.displayName,places.formattedAddress,places.location,places.rating`.
- `GET https://maps.googleapis.com/maps/api/geocode/json?address=Tokyo+Station&key=$GOOGLE_MAPS_API_KEY`.
