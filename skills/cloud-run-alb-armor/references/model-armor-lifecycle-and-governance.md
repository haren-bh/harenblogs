# Model Armor Deep Dive: Templates, SDK Fallback, Floor Settings & Operational Lifecycle

This reference covers the complete Google Cloud Model Armor architecture, template tuning, organization-wide governance via Floor Settings, observability, and application-level SDK integration for Cloud Run agents.

---

## 1. Dual Integration Patterns for Cloud Run Agents

| Pattern | Mechanism | Best Use Case |
| :--- | :--- | :--- |
| **Inline Edge Protection (Recommended Perimeter)** | Application Load Balancer (`EXTERNAL_MANAGED`) + Serverless NEG + Network Security `AuthzPolicy` (`CONTENT_AUTHZ`) + Service Extensions `AuthzExtension` calling `modelarmor.<LOCATION>.rep.googleapis.com`. | Zero-code perimeter security. Stops prompt injections and jailbreaks at the Google edge before Cloud Run scales up or downstream LLM tokens are billed; decouples security template updates from container redeployments. |
| **Application-Level SDK (`google-cloud-modelarmor`)** | Python/Go/Node container invokes `SanitizeUserPrompt` and `SanitizeModelResponse` inside the Cloud Run service. | Inspecting internal multi-agent handoffs, RAG chunks retrieved from Cloud Storage/databases, or MCP/tool outputs that do not traverse the external Load Balancer, or rendering custom UX fallback cards. |

### Decoupling Request & Response Templates in `AuthzExtension`

User inputs and LLM responses carry asymmetric risks. Always support distinct `request_template_id` and `response_template_id` values in `metadata.model_armor_settings` when needed:

* **Input Template (`request_template_id`):** Strict `piAndJailbreakFilterSettings` (`MEDIUM_AND_ABOVE` or `LOW_AND_ABOVE`), `maliciousUriFilterSettings` (`ENABLED`), and SDP de-identification for accidental customer PII uploads.
* **Output Template (`response_template_id`):** Strict Sensitive Data Protection (blocking leaked API keys, GCP credentials, or RAG PII) and `maliciousUriFilterSettings` (blocking hallucinated or poisoned links), with tuned `raiSettings`.

---

## 2. Anatomy of a Model Armor Template

1. **Location & Data Residency (`data_residency_compliant`):**
   * **Regional (`us-central1`, `asia-northeast1`, etc.):** Lowest latency when co-located in the same region as your Regional External ALB and Cloud Run service.
   * **Multi-region (`us`, `eu`):** Highest availability; **required** if inspecting **Image** modalities.
   * Location is immutable once created, and `AuthzExtension.service` must target the matching `modelarmor.<LOCATION>.rep.googleapis.com` endpoint.
   * Setting `data_residency_compliant: true` restricts transient processing strictly within the selected jurisdiction.
2. **Filter Version:**
   * `Stable`: Vetted production detector alias (90-day retirement window on promotion).
   * `Latest`: Tracks newest detector signatures immediately.
   * Pinned version: Deterministic regression testing before manual upgrades.
3. **Modalities:**
   * Text (including text inside PDF, DOCX, XLSX, PPTX, CSV, TXT up to 4 MB) and Images (JPEG, PNG, BMP up to 4 MB via OCR + visual SDP in `us`/`eu`).
4. **Core Detectors:**
   * **Prompt Injection & Jailbreak (`piAndJailbreakFilterSettings`):** Detects direct and indirect instruction-hijacking attempts.
   * **Malicious URL (`maliciousUriFilterSettings`):** Extracts up to 256 URLs per payload and checks them against Google threat intelligence.
   * **Sensitive Data Protection (`sdpSettings`):**
     * *Basic Config:* Credit card numbers, US SSNs, financial account numbers, US ITINs, GCP credentials, and GCP API keys.
     * *Advanced Config:* Links to Cloud DLP `inspectTemplate` (150+ global infoTypes & custom regexes) plus optional `deidentifyTemplate` to mask/redact/tokenize PII inline (`deidentifyResult.data.text`) without breaking user sessions.
   * **Responsible AI (`raiSettings`):** Configurable thresholds for `HATE_SPEECH`, `DANGEROUS`, `SEXUALLY_EXPLICIT`, and `HARASSMENT` (CSAM is always enforced and cannot be disabled).

### Understanding Confidence Level Strictness

Model Armor confidence thresholds define the **minimum likelihood** that triggers a violation match:

| Threshold | Flagged Likelihoods | Strictness | False Positive Risk | Typical Use |
| :--- | :--- | :--- | :--- | :--- |
| `LOW_AND_ABOVE` | Low + Medium + High | **Strictest** | High | Regulated / high-security prompt-injection boundaries |
| `MEDIUM_AND_ABOVE` | Medium + High | **Balanced** | Moderate | Standard enterprise prompt-injection & safety baseline |
| `HIGH` | High certainty only | **Least Restrictive** | Very Low | Customer-facing workflows minimizing false blocks |
| `NONE` | Disabled | Off | None | Explicitly unused category (if allowed by Floor Settings) |

> **Strictness Ordering:** `LOW_AND_ABOVE` (strictest) > `MEDIUM_AND_ABOVE` > `HIGH` > `NONE` (least strict).

---

## 3. Organization, Folder, and Project Floor Settings

**Floor Settings** establish an enterprise-wide minimum security baseline across `Organization -> Folder -> Project`:

* **Preventive Governance:** When template conformance is enabled, developers cannot create or update any Model Armor template with weaker confidence thresholds than the active floor setting.
* **Detective Governance (Security Command Center):** Pre-existing templates that fall below updated floor settings generate high-severity **Floor Setting Violation** findings in SCC Premium/Enterprise.
* **Inline Platform Screening:** Floor settings can also directly screen Gemini requests in **Agent Platform** and **Google Managed MCP Servers** (`Inspect only` or `Inspect and block`).
* **Precedence:** Project (`Custom`) overrides Folder, which overrides Organization (`Inherit parent` propagates downward).

### Inspecting Floor Settings via `gcloud`

```bash
# Project level
gcloud model-armor floorsettings describe \
    --full-uri="projects/${PROJECT_ID}/locations/global/floorSetting"

# Folder or Organization level
gcloud model-armor floorsettings describe \
    --full-uri="folders/${FOLDER_ID}/locations/global/floorSetting"
gcloud model-armor floorsettings describe \
    --full-uri="organizations/${ORG_ID}/locations/global/floorSetting"
```

---

## 4. Monitoring, Logging, and the 4-Phase Operational Lifecycle

### Phase 1: Apply (`INSPECT_ONLY`)
Deploy templates with `enforcement_type: INSPECT_ONLY` and `log_sanitize_operations: true`. Prompts and responses are evaluated and logged without blocking live Cloud Run traffic.

### Phase 2: Monitor & Analyze
* **Console Dashboard:** Open **Security > Model Armor > Monitoring** (`roles/monitoring.viewer` required). Filter by `Template`, `Location`, `Integration point` (`Cloud Load Balancing / Service Extensions`), and `Input type` (`Prompts` vs. `Responses`). Confirm `Interactions flagged` vs. `Interactions blocked = 0`.
* **Cloud Logging Query (`SanitizeOperationLogEntry`):**
  ```text
  resource.type="audited_resource"
  protoPayload.serviceName="modelarmor.googleapis.com"
  ```
* **Cloud Monitoring Metrics (for Alerting Policies):**
  * `modelarmor.googleapis.com/template/request_count`
  * `modelarmor.googleapis.com/template/pi_jb_request_count`
  * `modelarmor.googleapis.com/template/rai_request_count`
  * `modelarmor.googleapis.com/template/sdp_request_count`
  * `modelarmor.googleapis.com/template/malicious_uri_request_count`
  * `modelarmor.googleapis.com/template/used_token_count`

### Phase 3: Tune & Eliminate False Positives
* **Benign Imperative Commands Flagged (e.g., `"ignore empty rows"`, `"kill process 1234"`):** Add **Template-Specific Exclusion Rules** (dictionary or regex with `PARTIAL_MATCH` or `FULL_MATCH` scope) or relax that specific filter from `LOW_AND_ABOVE` to `MEDIUM_AND_ABOVE` / `HIGH`.
* **Accidental User PII Uploads:** Configure Advanced SDP with both an `inspectTemplate` and a `deidentifyTemplate` to mask PII inline rather than rejecting the chat.
* **High Response Violations Only:** Split `request_template_id` and `response_template_id` in `AuthzExtension` so output SDP/URI rules are tuned independently.

### Phase 4: Enforce (`INSPECT_AND_BLOCK`)
Once false positives reach zero on representative traffic, promote enforcement without touching Cloud Run code:

```bash
gcloud model-armor templates update "${MA_TEMPLATE_ID}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --template-metadata-enforcement-type=INSPECT_AND_BLOCK
```

---

## 5. Optional Application-Level Python SDK Pattern (Inside Cloud Run)

When you also want in-container inspection (e.g., auditing intermediate subagent/RAG steps or running `detect` mode prior to attaching the Load Balancer):

1. Add `google-cloud-modelarmor>=0.7.2` to `requirements.txt` and grant `roles/modelarmor.user` to the Cloud Run service account.
2. Call the regional endpoint (`modelarmor.<REGION>.rep.googleapis.com`):

```python
import os
from google.api_core.client_options import ClientOptions
from google.cloud import modelarmor_v1

class ModelArmorGuard:
    def __init__(self, project_id: str, location: str, template_id: str, mode: str = "detect"):
        self.mode = mode  # "detect" or "block"
        self.template_name = f"projects/{project_id}/locations/{location}/templates/{template_id}"
        self.client = modelarmor_v1.ModelArmorClient(
            client_options=ClientOptions(
                api_endpoint=f"modelarmor.{location}.rep.googleapis.com"
            )
        )

    def check_prompt(self, text: str) -> tuple[bool, str]:
        req = modelarmor_v1.SanitizeUserPromptRequest(
            name=self.template_name,
            user_prompt_data=modelarmor_v1.DataItem(text=text),
        )
        resp = self.client.sanitize_user_prompt(request=req)
        matched = (
            resp.sanitization_result.filter_match_state
            == modelarmor_v1.FilterMatchState.MATCH_FOUND
        )
        if matched and self.mode == "block":
            return False, "Prompt blocked by Model Armor security policy."
        return True, text

    def check_response(self, text: str) -> tuple[bool, str]:
        req = modelarmor_v1.SanitizeModelResponseRequest(
            name=self.template_name,
            model_response_data=modelarmor_v1.DataItem(text=text),
        )
        resp = self.client.sanitize_model_response(request=req)
        matched = (
            resp.sanitization_result.filter_match_state
            == modelarmor_v1.FilterMatchState.MATCH_FOUND
        )
        if matched and self.mode == "block":
            return False, "Response withheld by Model Armor safety policy."
        return True, text
```
