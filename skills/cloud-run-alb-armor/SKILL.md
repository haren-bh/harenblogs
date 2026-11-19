---
name: cloud-run-alb-armor
description: >-
  Configures Google Cloud Armor (WAF, DDoS, rate limiting, IP/geo security policies)
  and Google Cloud Model Armor (prompt injection, jailbreak, Sensitive Data Protection,
  malicious URL, and Responsible AI guardrails) inline with an Application Load Balancer
  (Serverless NEG, Backend Security Policy, Service Extensions AuthzExtension, and
  Network Security AuthzPolicy CONTENT_AUTHZ) fronting a Cloud Run AI agent backend,
  including full audit-to-block lifecycle management and Floor Settings governance.
  Use when securing Cloud Run agents at the network edge with Cloud Armor, inline Model Armor,
  Application Load Balancers, or Service Extensions.
---

# Cloud Armor & Inline Model Armor with Application Load Balancer for Cloud Run Agents

This skill configures a zero-code, defense-in-depth edge perimeter in front of a **Google Cloud Run** AI agent using an **External Application Load Balancer (`EXTERNAL_MANAGED`)**, **Google Cloud Armor**, and **inline Google Cloud Model Armor** via **Service Extensions**.

## Architecture Overview

Traffic destined for the Cloud Run agent passes through two complementary inline security planes on the Application Load Balancer before reaching the container:

```text
Client HTTP(S) Request
  │
  ▼
[1] ALB Forwarding Rule ──► Network Security AuthzPolicy (CONTENT_AUTHZ)
  │                           └──► Service Extensions AuthzExtension
  │                                  └──► Model Armor (Request Prompt Inspection)
  ▼
[2] Target Proxy & URL Map
  │
  ▼
[3] ALB Backend Service ──► Cloud Armor Security Policy (DDoS, OWASP WAF, Rate Limiting, IP/Geo)
  │
  ▼
[4] Serverless NEG ───────► Cloud Run Agent (--ingress=internal-and-cloud-load-balancing)
  │                           └──► (Optional) App-level Model Armor SDK for internal subagent/tool steps
  ▼
[5] Agent HTTP Response ──► AuthzPolicy / AuthzExtension ──► Model Armor (Response Inspection) ──► Client
```

| Security Layer | Attachment Target | Threats Mitigated |
| :--- | :--- | :--- |
| **Cloud Armor (`security-policies`)** | **ALB Backend Service** | Volumetric DDoS, OWASP Top 10 (`sqli`, `xss`, `rce`, `lfi`), bot scanners, IP/Geo restrictions, and per-IP request floods (`throttle` / `rate-based-ban` protecting LLM token budgets). |
| **Inline Model Armor (`AuthzExtension` + `AuthzPolicy`)** | **ALB Forwarding Rule** (`CONTENT_AUTHZ`) | Adversarial natural-language **prompt injections & jailbreaks**, **PII / credential leaks (SDP)**, **malicious/phishing URLs**, and **Responsible AI** content violations in full HTTP request and response bodies—with zero application code changes. |
| **Cloud Run Ingress Lockdown** | **Cloud Run Service** | Blocks direct internet access to `*.run.app` (`--ingress=internal-and-cloud-load-balancing`) so attackers cannot bypass Cloud Armor or inline Model Armor. |

### Choosing Regional vs. Global External ALB

* **Regional External ALB (`EXTERNAL_MANAGED` — Default Workflow Below):** Co-locates the Envoy proxy, Cloud Armor regional policy, Service Extension callout, Model Armor regional template (`modelarmor.<REGION>.rep.googleapis.com`), and Cloud Run service in the **same region** for lowest single-region latency and strict regional data residency.
* **Global External ALB (`EXTERNAL_MANAGED`):** Use when you need a global Anycast IP, Google-managed multi-region TLS certificates, or global Cloud Armor edge policies. See [cloud-armor-waf-and-alb-variants.md](references/cloud-armor-waf-and-alb-variants.md) for the Global HTTPS ALB commands.

---

## Step-by-Step Implementation Workflow

> **Automated Helper:** You can execute the full workflow via [setup_inline_alb_armor.sh](scripts/setup_inline_alb_armor.sh) (supports `DRY_RUN=true` to preview commands) or run each phase step-by-step below to customize resources.

### Step 0: Set Environment Variables & Enable APIs

Confirm the target project, region, existing (or planned) Cloud Run service name, and VPC network with the user before running mutating commands:

```bash
export PROJECT_ID="your-project-id"
export PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
export REGION="us-central1"
export CLOUD_RUN_SERVICE="my-agent-service"
export PREFIX="${CLOUD_RUN_SERVICE}"
export NETWORK="default"
export PROXY_SUBNET_RANGE="192.168.10.0/24"
export MA_TEMPLATE_ID="agent-web-template"

gcloud services enable \
    run.googleapis.com \
    compute.googleapis.com \
    networkservices.googleapis.com \
    networksecurity.googleapis.com \
    modelarmor.googleapis.com \
    dlp.googleapis.com \
    --project="${PROJECT_ID}"
```

### Step 1: Provision & Authorize the Service Extensions Service Agent (IAM)

Service Extensions uses a dedicated Google-managed service agent (`gcp-sa-dep`) to invoke Model Armor inline on behalf of the Load Balancer. Always ensure this identity exists and holds the required roles:

```bash
gcloud beta services identity create \
    --service=networkservices.googleapis.com \
    --project="${PROJECT_ID}"

export DEP_SA="service-${PROJECT_NUMBER}@gcp-sa-dep.iam.gserviceaccount.com"

for ROLE in roles/modelarmor.calloutUser roles/modelarmor.user roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
      --member="serviceAccount:${DEP_SA}" \
      --role="${ROLE}" \
      --condition=None
done
```

### Step 2: Verify (or Deploy) the Cloud Run Agent Backend

1. Check that the Cloud Run agent service is deployed and healthy in `${REGION}`:
   ```bash
   gcloud run services describe "${CLOUD_RUN_SERVICE}" \
       --region="${REGION}" \
       --project="${PROJECT_ID}" \
       --format="yaml(status.url,metadata.annotations)"
   ```
2. *(Optional)* If the agent is not yet deployed or also needs in-app SDK audit telemetry (`google-cloud-modelarmor`), follow the containerization & SDK guide in [model-armor-lifecycle-and-governance.md](references/model-armor-lifecycle-and-governance.md).
3. **Important:** Keep `--allow-unauthenticated` (`roles/run.invoker` for `allUsers`) if the public web/API client accesses the ALB without Cloud IAM tokens, and **restrict network ingress** in Step 7 (`--ingress=internal-and-cloud-load-balancing`) once the ALB is live so only the Load Balancer and internal VPC can reach Cloud Run.

### Step 3: Provision the Regional External Application Load Balancer & Serverless NEG

1. **Create the Regional Proxy-Only Subnet** (required once per VPC/region for `EXTERNAL_MANAGED` Envoy proxies):
   ```bash
   gcloud compute networks subnets create "proxy-only-subnet-${REGION}" \
       --project="${PROJECT_ID}" \
       --region="${REGION}" \
       --network="${NETWORK}" \
       --range="${PROXY_SUBNET_RANGE}" \
       --purpose=REGIONAL_MANAGED_PROXY \
       --role=ACTIVE
   ```
2. **Create a Serverless NEG pointing to the Cloud Run service:**
   ```bash
   gcloud compute network-endpoint-groups create "${PREFIX}-serverless-neg" \
       --project="${PROJECT_ID}" \
       --region="${REGION}" \
       --network-endpoint-type=SERVERLESS \
       --cloud-run-service="${CLOUD_RUN_SERVICE}"
   ```
3. **Create the Regional Backend Service and attach the Serverless NEG:**
   ```bash
   gcloud compute backend-services create "${PREFIX}-reg-backend" \
       --project="${PROJECT_ID}" \
       --region="${REGION}" \
       --load-balancing-scheme=EXTERNAL_MANAGED \
       --protocol=HTTPS

   gcloud compute backend-services add-backend "${PREFIX}-reg-backend" \
       --project="${PROJECT_ID}" \
       --region="${REGION}" \
       --network-endpoint-group="${PREFIX}-serverless-neg" \
       --network-endpoint-group-region="${REGION}"
   ```
4. **Create the Regional URL Map, Target HTTP(S) Proxy, and Forwarding Rule:**
   ```bash
   gcloud compute url-maps create "${PREFIX}-reg-url-map" \
       --project="${PROJECT_ID}" \
       --region="${REGION}" \
       --default-service="${PREFIX}-reg-backend"

   gcloud compute target-http-proxies create "${PREFIX}-reg-http-proxy" \
       --project="${PROJECT_ID}" \
       --region="${REGION}" \
       --url-map="${PREFIX}-reg-url-map" \
       --url-map-region="${REGION}"

   gcloud compute forwarding-rules create "${PREFIX}-reg-fr" \
       --project="${PROJECT_ID}" \
       --region="${REGION}" \
       --load-balancing-scheme=EXTERNAL_MANAGED \
       --network-tier=STANDARD \
       --network="${NETWORK}" \
       --ports=80 \
       --target-http-proxy="${PREFIX}-reg-http-proxy" \
       --target-http-proxy-region="${REGION}"
   ```
   *(For production HTTPS termination with SSL certificates, substitute `target-https-proxies` on port `443`; see [cloud-armor-waf-and-alb-variants.md](references/cloud-armor-waf-and-alb-variants.md).)*

### Step 4: Configure Cloud Armor & Attach Inline to the ALB Backend Service

Create a Regional Cloud Armor security policy (`--type=CLOUD_ARMOR`) with OWASP WAF defenses and per-IP rate limiting (to protect downstream Cloud Run compute and LLM token spend), then bind it inline to the Backend Service:

```bash
export CA_POLICY="${PREFIX}-cloud-armor-policy"

# 4a. Create the Regional Cloud Armor policy
gcloud compute security-policies create "${CA_POLICY}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --type=CLOUD_ARMOR \
    --description="Inline Cloud Armor WAF and rate-limiting policy for ${CLOUD_RUN_SERVICE}"

# 4b. Rate-limit abusive client IPs (e.g., 60 requests/min/IP -> HTTP 429) to prevent LLM token exhaustion
gcloud compute security-policies rules create 900 \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}" \
    --expression="true" \
    --action="throttle" \
    --rate-limit-threshold-count=60 \
    --rate-limit-threshold-interval-sec=60 \
    --conform-action="allow" \
    --exceed-action="deny-429" \
    --enforce-on-key="IP" \
    --description="Per-IP rate limit to protect Cloud Run agent and LLM token quota"

# 4c. Block OWASP SQLi & XSS exploits (use --preview first if auditing production traffic)
gcloud compute security-policies rules create 1000 \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}" \
    --expression="evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 2}) || evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 2})" \
    --action="deny-403" \
    --preview \
    --description="OWASP SQLi and XSS WAF defense (preview audit mode)"

# 4d. Attach Cloud Armor inline to the Regional Backend Service
gcloud compute backend-services update "${PREFIX}-reg-backend" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}"
```

> **Tip:** Passing `--preview` logs WAF matches without blocking until you verify zero false positives; remove `--preview` via `gcloud compute security-policies rules update 1000 ... --no-preview` to enforce active `403` blocking. See [cloud-armor-waf-and-alb-variants.md](references/cloud-armor-waf-and-alb-variants.md) for LFI/RCE/scanner rules and IP/Geo filters.

### Step 5: Create Model Armor Template(s) in Audit Mode (`INSPECT_ONLY`)

Always start new Model Armor deployments in **`INSPECT_ONLY`** mode with `log_sanitize_operations` enabled (Phase 1 of the operational lifecycle), unless the user already provides an existing template URI or explicitly requests immediate `INSPECT_AND_BLOCK`:

```bash
gcloud model-armor templates create "${MA_TEMPLATE_ID}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --pi-and-jailbreak-filter-settings-enforcement=enabled \
    --pi-and-jailbreak-filter-settings-confidence-level=MEDIUM_AND_ABOVE \
    --malicious-uri-filter-settings-enforcement=enabled \
    --basic-config-filter-enforcement=enabled \
    --rai-settings-filters='[{"filterType":"HATE_SPEECH","confidenceLevel":"HIGH"},{"filterType":"HARASSMENT","confidenceLevel":"HIGH"},{"filterType":"DANGEROUS","confidenceLevel":"HIGH"},{"filterType":"SEXUALLY_EXPLICIT","confidenceLevel":"HIGH"}]' \
    --template-metadata-enforcement-type=INSPECT_ONLY \
    --template-metadata-log-template-operations \
    --template-metadata-log-sanitize-operations \
    --template-metadata-multi-language-detection
```

*(Reference JSON payload: [model-armor-template-audit.json](resources/model-armor-template-audit.json). Best practice: create separate `input` and `output` templates when user prompts and agent responses have different SDP/URL sensitivity requirements.)*

### Step 6: Configure Inline Model Armor on the ALB via Service Extensions

Bind Model Armor inline to the ALB Forwarding Rule using [authz-extension.yaml.tmpl](resources/authz-extension.yaml.tmpl) and [authz-policy.yaml.tmpl](resources/authz-policy.yaml.tmpl):

1. **Create and import the `AuthzExtension`** pointing to `modelarmor.${REGION}.rep.googleapis.com`:
   ```bash
   cat <<EOF > "${PREFIX}-authz-ext.yaml"
   name: projects/${PROJECT_ID}/locations/${REGION}/authzExtensions/${PREFIX}-authz-ext
   loadBalancingScheme: EXTERNAL_MANAGED
   service: modelarmor.${REGION}.rep.googleapis.com
   timeout: 1s
   failOpen: false
   metadata:
     model_armor_settings: '[{"request_template_id": "projects/${PROJECT_ID}/locations/${REGION}/templates/${MA_TEMPLATE_ID}", "response_template_id": "projects/${PROJECT_ID}/locations/${REGION}/templates/${MA_TEMPLATE_ID}"}]'
   EOF

   gcloud service-extensions authz-extensions import "${PREFIX}-authz-ext" \
       --project="${PROJECT_ID}" \
       --location="${REGION}" \
       --source="${PREFIX}-authz-ext.yaml"
   ```

2. **Create and import the Network Security `AuthzPolicy` (`CONTENT_AUTHZ`)** targeting the Forwarding Rule:
   ```bash
   cat <<EOF > "${PREFIX}-authz-policy.yaml"
   name: projects/${PROJECT_ID}/locations/${REGION}/authzPolicies/${PREFIX}-authz-policy
   action: CUSTOM
   policyProfile: CONTENT_AUTHZ
   customProvider:
     authzExtension:
       resources:
       - projects/${PROJECT_ID}/locations/${REGION}/authzExtensions/${PREFIX}-authz-ext
   target:
     loadBalancingScheme: EXTERNAL_MANAGED
     resources:
     - https://www.googleapis.com/compute/v1/projects/${PROJECT_ID}/regions/${REGION}/forwardingRules/${PREFIX}-reg-fr
   EOF

   gcloud network-security authz-policies import "${PREFIX}-authz-policy" \
       --project="${PROJECT_ID}" \
       --location="${REGION}" \
       --source="${PREFIX}-authz-policy.yaml"
   ```

### Step 7: Verify End-to-End Routing & Lock Down Cloud Run Ingress

1. **Test routing through the Load Balancer IP** (allow 1–3 minutes for Envoy proxy & extension propagation):
   ```bash
   export LB_IP="$(gcloud compute forwarding-rules describe "${PREFIX}-reg-fr" \
       --region="${REGION}" --project="${PROJECT_ID}" --format='value(IPAddress)')"
   echo "Protected Agent Endpoint: http://${LB_IP}/"
   curl -i "http://${LB_IP}/"
   ```
   Or run the full diagnostic verifier:
   ```bash
   PROJECT_ID="${PROJECT_ID}" REGION="${REGION}" CLOUD_RUN_SERVICE="${CLOUD_RUN_SERVICE}" \
       PREFIX="${PREFIX}" MA_TEMPLATE_ID="${MA_TEMPLATE_ID}" \
       bash scripts/verify_armor_stack.sh
   ```

2. **Lock down Cloud Run ingress** so external callers cannot bypass Cloud Armor and inline Model Armor via `*.run.app`:
   ```bash
   gcloud run services update "${CLOUD_RUN_SERVICE}" \
       --project="${PROJECT_ID}" \
       --region="${REGION}" \
       --ingress=internal-and-cloud-load-balancing
   ```

---

## Phased Lifecycle Management (Audit → Monitor → Tune → Block)

Never jump straight to aggressive blocking (`LOW_AND_ABOVE` + `INSPECT_AND_BLOCK`) on Day 1 without baseline telemetry. Guide users through this 4-phase lifecycle (detailed in [model-armor-lifecycle-and-governance.md](references/model-armor-lifecycle-and-governance.md)):

1. **Phase 1 — Apply in Audit Mode:** Start Model Armor templates in `INSPECT_ONLY` (`log_sanitize_operations=true`) and new Cloud Armor WAF rules with `--preview`.
2. **Phase 2 — Monitor Detections:**
   * Inspect **Security > Model Armor > Monitoring** (`Flagged > 0`, `Blocked = 0` while in audit mode) and Cloud Logging (`protoPayload.serviceName="modelarmor.googleapis.com"`).
   * Inspect Cloud Armor logs (`resource.type="http_load_balancer" AND jsonPayload.previewSecurityPolicy.name="${CA_POLICY}"`).
3. **Phase 3 — Tune & Eliminate False Positives:**
   * Adjust noisy Model Armor filter thresholds (`LOW_AND_ABOVE` [strictest] → `MEDIUM_AND_ABOVE` → `HIGH` [least noisy], subject to Organization/Folder/Project **Floor Settings**).
   * Add dictionary or regex **Template Exclusion Rules** for benign domain terms (e.g., `"ignore empty rows"`).
   * Use Advanced SDP **De-identify templates** to redact/mask PII inline rather than failing user chats, and decouple `request_template_id` vs. `response_template_id` in `AuthzExtension` when output rules differ from input rules.
4. **Phase 4 — Enforce Active Blocking:**
   ```bash
   # Promote Model Armor template from audit to active inline edge blocking
   gcloud model-armor templates update "${MA_TEMPLATE_ID}" \
       --project="${PROJECT_ID}" \
       --location="${REGION}" \
       --template-metadata-enforcement-type=INSPECT_AND_BLOCK

   # Promote Cloud Armor WAF rule from preview to active 403 blocking
   gcloud compute security-policies rules update 1000 \
       --project="${PROJECT_ID}" \
       --region="${REGION}" \
       --security-policy="${CA_POLICY}" \
       --no-preview
   ```

---

## Bundled Files & References

* **Automation & Diagnostics:**
  * [setup_inline_alb_armor.sh](scripts/setup_inline_alb_armor.sh) — Idempotent end-to-end provisioning script (`DRY_RUN=true` supported).
  * [verify_armor_stack.sh](scripts/verify_armor_stack.sh) — Inspects Cloud Run ingress, Serverless NEG, Backend Service, Cloud Armor policy, Forwarding Rule, `AuthzExtension`, `AuthzPolicy`, Model Armor templates, and Floor Settings, plus optional HTTP smoke checks.
* **Resource Templates:**
  * [model-armor-template-audit.json](resources/model-armor-template-audit.json) — Starter `INSPECT_ONLY` Model Armor template JSON.
  * [authz-extension.yaml.tmpl](resources/authz-extension.yaml.tmpl) — Service Extensions `AuthzExtension` YAML template.
  * [authz-policy.yaml.tmpl](resources/authz-policy.yaml.tmpl) — Network Security `AuthzPolicy` (`CONTENT_AUTHZ`) YAML template.
* **Deep-Dive References:**
  * [model-armor-lifecycle-and-governance.md](references/model-armor-lifecycle-and-governance.md) — Template anatomy, Floor Settings hierarchy & SCC compliance, Cloud Monitoring metrics, Python SDK (`ModelArmorDetector`) integration, and 4-phase lifecycle tuning.
  * [cloud-armor-waf-and-alb-variants.md](references/cloud-armor-waf-and-alb-variants.md) — Complete Cloud Armor WAF rule sets, AI rate-limiting patterns, Global External HTTPS ALB setup, and troubleshooting.
