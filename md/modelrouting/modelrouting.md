# Step-by-Step Guide: Google Cloud API Gateway with Vertex AI Model Routing

This guide documents all configurations, architectural design decisions, and commands executed to build, deploy, and verify an AI Model Routing API Gateway in Google Cloud.

---

## 1. Environment & Target Specifications

| Parameter | Value |
| :--- | :--- |
| **GCP Project ID** | `haren-main` |
| **GCP Project Number** | `78833623456` |
| **Region** | `us-central1` |
| **API Gateway API ID** | `modelrouting` |
| **Managed Service Hostname** | `modelrouting-14tqei0csqh0g.apigateway.haren-main.cloud.goog` |
| **Active API Config ID** | `test-cfg-full` (`test-cfg-full-371xthanvb1kc`) |
| **API Gateway Resource ID** | `modelrouting-gateway` |
| **Public Gateway URL** | `https://modelrouting-gateway-78833623456.us-central1.gateway.dev` |
| **Backend Service Account** | `78833623456-compute@developer.gserviceaccount.com` |
| **Streaming Mode** | `EFFECTIVE_STREAMING_MODE_ENABLED` |

---

## 2. Step-by-Step Deployment Instructions

### Step 1: Set Active Project & Enable Google Cloud APIs

Ensure your local gcloud CLI context is pointed to project `haren-main` and enable the necessary service APIs:

```bash
# Set project
gcloud config set project haren-main

# Enable required GCP APIs
gcloud services enable \
  apigateway.googleapis.com \
  servicemanagement.googleapis.com \
  servicecontrol.googleapis.com \
  aiplatform.googleapis.com \
  --project=haren-main
```

---

### Step 2: Verify API Resource & Enable Managed Service

The API resource `modelrouting` must exist under API Gateway, and its auto-generated service management hostname must be enabled in Service Management:

```bash
# Describe the existing API resource
gcloud api-gateway apis describe modelrouting --project=haren-main

# Enable the managed service DNS for this API
gcloud services enable modelrouting-14tqei0csqh0g.apigateway.haren-main.cloud.goog \
  --project=haren-main
```

---

### Step 3: Configure Backend Service Account IAM Permissions

API Gateway uses a service account to sign OAuth identity tokens when proxying calls to Vertex AI (`aiplatform.googleapis.com`). Ensure the service account has Vertex AI User permissions:

```bash
gcloud projects add-iam-policy-binding haren-main \
  --member="serviceAccount:78833623456-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

---

### Step 4: Prepare the OpenAPI 3.0.3 Specification (`openapi.yaml`)

Create the OpenAPI 3.0.3 specification file with `x-google-api-management` AI Model Routing extensions.

> [!IMPORTANT]
> **Model Routing Protocol Grouping Rule:**
> In API Gateway's Envoy AI management filter, a single router cannot mix divergent backend protocols (such as Gemini `:generateContent`, Anthropic `:rawPredict`, and OpenAI `/endpoints/openapi/chat/completions`). 
> Separate them into protocol-compatible routers:
> 1. `gemini-claude-router`: Translates between Gemini (`generateContent`) and Anthropic Claude (`rawPredict`).
> 2. `maas-models-router`: Proxies Vertex AI OpenAI-compatible Model-as-a-Service (MaaS) endpoints.

Save the following specification as `openapi.yaml`:

```yaml
openapi: 3.0.3

info:
  title: OpenAPI 3.x spec using Model Routing
  description: Using Model Routing in an OAS 3.x spec
  version: 1.0.0

x-google-api-management:
  backends:
    # ---------------------------------------------------------
    # Google Gemini Backend (generateContent)
    # ---------------------------------------------------------
    gemini-38-flash:
      address: "https://aiplatform.googleapis.com/v1/projects/haren-main/locations/global/publishers/google/models/gemini-3.8-flash:generateContent"
      deadline: 60.0
      pathTranslation: CONSTANT_ADDRESS

    # ---------------------------------------------------------
    # Anthropic Claude Backends (rawPredict)
    # ---------------------------------------------------------
    anthropic-claude-opus-47:
      address: "https://aiplatform.googleapis.com/v1/projects/haren-main/locations/global/publishers/anthropic/models/claude-opus-4-7:rawPredict"
      deadline: 60.0
      pathTranslation: CONSTANT_ADDRESS

    anthropic-claude-sonnet-5:
      address: "https://aiplatform.googleapis.com/v1/projects/haren-main/locations/global/publishers/anthropic/models/claude-sonnet-5:rawPredict"
      deadline: 60.0
      pathTranslation: CONSTANT_ADDRESS

    anthropic-claude-haiku-45:
      address: "https://aiplatform.googleapis.com/v1/projects/haren-main/locations/global/publishers/anthropic/models/claude-haiku-4-5:rawPredict"
      deadline: 60.0
      pathTranslation: CONSTANT_ADDRESS

    # ---------------------------------------------------------
    # Vertex AI OpenAI-Compatible MaaS Endpoint
    # ---------------------------------------------------------
    vertex-maas-openapi:
      address: "https://aiplatform.googleapis.com/v1/projects/haren-main/locations/global/endpoints/openapi/chat/completions"
      deadline: 60.0
      pathTranslation: CONSTANT_ADDRESS

  ai:
    models:
      routing:
        routers:
          gemini-claude-router:
            defaultModel:
              backend: gemini-38-flash
              targetModel: google/gemini-3.8-flash
            rules:
              - model: "claude-opus-4-7"
                backend: anthropic-claude-opus-47
                targetModel: anthropic/claude-opus-4-7
              - model: "claude-sonnet-5"
                backend: anthropic-claude-sonnet-5
                targetModel: anthropic/claude-sonnet-5
              - model: "claude-haiku-4-5"
                backend: anthropic-claude-haiku-45
                targetModel: anthropic/claude-haiku-4-5

          maas-models-router:
            defaultModel:
              backend: vertex-maas-openapi
              targetModel: openai/gpt-oss-120b-maas
            rules:
              - model: "gpt-oss-120b-maas"
                backend: vertex-maas-openapi
                targetModel: openai/gpt-oss-120b-maas
              - model: "deepseek-v4.1"
                backend: vertex-maas-openapi
                targetModel: openai/deepseek-v4.1-flash-maas
              - model: "grok-4.7"
                backend: vertex-maas-openapi
                targetModel: openai/grok-4.7
              - model: "glm-5.2"
                backend: vertex-maas-openapi
                targetModel: openai/glm-5.2-maas
              - model: "codestral-2"
                backend: vertex-maas-openapi
                targetModel: openai/codestral-2
              - model: "llama-4-maverick"
                backend: vertex-maas-openapi
                targetModel: openai/llama-4-maverick-17b-128e-instruct-maas

servers:
  - url: "https://modelrouting-14tqei0csqh0g.apigateway.haren-main.cloud.goog"

paths:
  /v1/chat/gemini-claude:
    post:
      summary: "Router for Gemini and Anthropic Claude models"
      operationId: "chatGeminiClaude"
      x-google-model-router: gemini-claude-router
      responses:
        "200":
          description: "OK"

  /v1/chat/maas-models:
    post:
      summary: "Router for Vertex AI MaaS OpenAI-compatible models"
      operationId: "chatMaasModels"
      x-google-model-router: maas-models-router
      responses:
        "200":
          description: "OK"
```

---

### Step 5: Deploy the API Config

Submit the OpenAPI specification to create and compile the API Config in Service Management:

```bash
gcloud api-gateway api-configs create test-cfg-full \
  --api=modelrouting \
  --openapi-spec=openapi.yaml \
  --backend-auth-service-account=78833623456-compute@developer.gserviceaccount.com \
  --project=haren-main
```

Wait until the configuration status transitions to `ACTIVE`:

```bash
# Check status
gcloud api-gateway api-configs describe test-cfg-full \
  --api=modelrouting \
  --project=haren-main \
  --format="value(state)"
```

---

### Step 6: Create the API Gateway Resource

Deploy the API Gateway in region `us-central1` using the active API Config:

```bash
gcloud api-gateway gateways create modelrouting-gateway \
  --api=modelrouting \
  --api-config=test-cfg-full \
  --location=us-central1 \
  --project=haren-main
```

Wait for the deployment to complete and verify the assigned hostname:

```bash
gcloud api-gateway gateways describe modelrouting-gateway \
  --location=us-central1 \
  --project=haren-main
```

Expected output confirms:
```text
state: ACTIVE
defaultHostname: modelrouting-gateway-78833623456.us-central1.gateway.dev
effectiveStreamingMode: EFFECTIVE_STREAMING_MODE_ENABLED
```

---

## 3. Verification & Testing Commands

Export the required environment variables:

```bash
export GATEWAY_URL="https://modelrouting-gateway-78833623456.us-central1.gateway.dev"
export TOKEN="$(gcloud auth print-access-token)"
```

### Test 1: Gemini 3.8 Flash (Default Route)

Call the Gemini endpoint using standard OpenAI-format chat messages. The gateway automatically translates the request to Gemini `generateContent` and returns an OpenAI-compatible completion:

```bash
curl -s -X POST "${GATEWAY_URL}/v1/chat/gemini-claude" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Say hello in 5 words."}
    ]
  }'
```

**Response:**
```json
{
  "id": "chatcmpl-52d66ecc-fa78-4d32-abb4-a43c23c69bd8",
  "object": "chat.completion",
  "created": 1793845952,
  "model": "default",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello, how are you today?" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 7, "completion_tokens": 7, "total_tokens": 228 }
}
```

---

### Test 2: OpenAI MaaS Endpoint (`gpt-oss-120b-maas`)

Call the MaaS endpoint. The gateway routes to `openai/gpt-oss-120b-maas` on Vertex AI:

```bash
curl -s -X POST "${GATEWAY_URL}/v1/chat/maas-models" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Say hello in 5 words."}
    ]
  }'
```

**Response:**
```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello there, nice to meet.",
        "reasoning_content": "User wants: \"Say hello in 5 words.\"..."
      },
      "finish_reason": "stop"
    }
  ],
  "model": "default",
  "object": "chat.completion",
  "usage": { "prompt_tokens": 74, "completion_tokens": 116, "total_tokens": 190 }
}
```

---

### Test 3: Streaming Chat Response (Server-Sent Events)

Streaming is enabled on the gateway (`EFFECTIVE_STREAMING_MODE_ENABLED`). Add `"stream": true` and pass `-N` to curl:

```bash
curl -N -s -X POST "${GATEWAY_URL}/v1/chat/gemini-claude" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Count from 1 to 5."}
    ],
    "stream": true
  }'
```

---

### Test 4: Model Parameter Routing

Override the default model by specifying the model identifier in the request body:

```bash
curl -s -X POST "${GATEWAY_URL}/v1/chat/gemini-claude" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-7",
    "messages": [
      {"role": "user", "content": "Hello Claude Opus"}
    ]
  }'
```
