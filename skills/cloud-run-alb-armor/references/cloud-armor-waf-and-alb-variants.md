# Cloud Armor WAF Rules, Rate Limiting & Global HTTPS ALB Variants

This reference provides production rule sets for **Google Cloud Armor**, Global External HTTPS Application Load Balancer configurations, Cloud Run ingress hardening, and troubleshooting for inline edge deployments.

---

## 1. Cloud Armor Rule Recipes for AI Agents on Cloud Run

AI agent endpoints are uniquely vulnerable to **cost-amplification / token-exhaustion floods** (each HTTP request can trigger multiple LLM calls and tool invocations) in addition to standard web exploits. Attach these rules to your Regional (`--region=${REGION}`) or Global (`--global`) Cloud Armor security policy.

> **Scope Note:** For a **Regional External ALB**, pass `--region="${REGION}"` (and `--type=CLOUD_ARMOR` on policy creation). For a **Global External ALB**, omit `--region` (or pass `--global` on `backend-services update`).

### 1.1 Endpoint-Scoped LLM Rate Limiting (`throttle` & `rate-based-ban`)

Apply stricter rate limits to expensive agent generation routes (e.g., `/chat`, `/api/invoke`, `/run_sse`) while allowing higher limits on static UI assets:

```bash
# Throttle /chat or /api/ agent invocations to 20 requests/min per client IP (HTTP 429)
gcloud compute security-policies rules create 800 \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}" \
    --expression="request.path.matches('^/(chat|api|run|run_sse)')" \
    --action="throttle" \
    --rate-limit-threshold-count=20 \
    --rate-limit-threshold-interval-sec=60 \
    --conform-action="allow" \
    --exceed-action="deny-429" \
    --enforce-on-key="IP" \
    --description="Strict per-IP throttle on LLM agent invocation endpoints"

# Ban aggressive scrapers/flooders for 10 minutes (600s) if they exceed 120 req/min
gcloud compute security-policies rules create 850 \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}" \
    --expression="true" \
    --action="rate-based-ban" \
    --rate-limit-threshold-count=120 \
    --rate-limit-threshold-interval-sec=60 \
    --ban-duration-sec=600 \
    --conform-action="allow" \
    --exceed-action="deny-429" \
    --enforce-on-key="IP" \
    --description="Temporary 10-minute ban for high-rate abusive IPs"
```

### 1.2 Comprehensive OWASP ModSecurity CRS WAF Rules

Protect Flask/FastAPI/ADK web frontends and backend tool parameters against SQLi, XSS, Remote Code Execution (RCE), Local File Inclusion (LFI), and automated vulnerability scanners:

```bash
# SQL Injection & Cross-Site Scripting
gcloud compute security-policies rules create 1000 \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}" \
    --expression="evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 2}) || evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 2})" \
    --action="deny-403" \
    --preview \
    --description="Block OWASP SQLi and XSS"

# Remote Code Execution (RCE) & Local File Inclusion (LFI)
gcloud compute security-policies rules create 1100 \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}" \
    --expression="evaluatePreconfiguredWaf('rce-v33-stable', {'sensitivity': 2}) || evaluatePreconfiguredWaf('lfi-v33-stable', {'sensitivity': 2})" \
    --action="deny-403" \
    --preview \
    --description="Block OWASP RCE and LFI"

# Automated Scanner & Protocol Attack Detection
gcloud compute security-policies rules create 1200 \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}" \
    --expression="evaluatePreconfiguredWaf('scannerdetection-v33-stable', {'sensitivity': 2}) || evaluatePreconfiguredWaf('protocolattack-v33-stable', {'sensitivity': 2})" \
    --action="deny-403" \
    --preview \
    --description="Block vulnerability scanners and HTTP protocol attacks"
```

> **Important Tuning Tip for Prompt Payloads:** Free-form natural language prompts in JSON bodies (for example, users asking coding questions containing SQL snippets like `SELECT * FROM users` or HTML tags) can trigger `sqli` or `xss` WAF signatures at high sensitivity! Always test Cloud Armor WAF rules in `--preview` mode first, inspect `jsonPayload.previewSecurityPolicy` in Cloud Logging, and either scope SQLi/XSS rules away from pure prompt fields or rely on **inline Model Armor** for semantic prompt inspection while keeping Cloud Armor focused on rate limiting, DDoS, IP/Geo, scanner detection, and non-prompt routes.

### 1.3 IP Allowlist / Denylist & Geo-Fencing Rules

```bash
# Block known malicious CIDR
gcloud compute security-policies rules create 500 \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}" \
    --src-ip-ranges="203.0.113.0/24" \
    --action="deny-403" \
    --description="Block denylisted CIDR"

# Geo-restrict access (example: allow only JP and US)
gcloud compute security-policies rules create 600 \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}" \
    --expression="!(origin.region_code in ['JP', 'US'])" \
    --action="deny-403" \
    --description="Allow traffic only from Japan and United States"
```

### 1.4 Cloud Armor Logging & Telemetry Verification

Enable verbose request logging on the Backend Service so Cloud Armor rule matches appear in Cloud Logging:

```bash
gcloud compute backend-services update "${PREFIX}-reg-backend" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --enable-logging \
    --logging-sample-rate=1.0
```

Query Cloud Logging (Logs Explorer) for enforced or preview Cloud Armor hits:

```text
resource.type="http_load_balancer"
(jsonPayload.enforcedSecurityPolicy.name:"cloud-armor-policy" OR jsonPayload.previewSecurityPolicy.name:"cloud-armor-policy")
```

---

## 2. Variant: Global External HTTPS Application Load Balancer + Cloud Armor + Inline Model Armor

When serving global users over HTTPS with a custom domain and Google-managed SSL certificate, use the **Global External Application Load Balancer (`EXTERNAL_MANAGED`)**:

```bash
export DOMAIN="agent.example.com"

# 1. Serverless NEG (still created in the Cloud Run service's region)
gcloud compute network-endpoint-groups create "${PREFIX}-serverless-neg" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --network-endpoint-type=SERVERLESS \
    --cloud-run-service="${CLOUD_RUN_SERVICE}"

# 2. Global Backend Service + Serverless NEG
gcloud compute backend-services create "${PREFIX}-global-backend" \
    --project="${PROJECT_ID}" \
    --global \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --protocol=HTTPS

gcloud compute backend-services add-backend "${PREFIX}-global-backend" \
    --project="${PROJECT_ID}" \
    --global \
    --network-endpoint-group="${PREFIX}-serverless-neg" \
    --network-endpoint-group-region="${REGION}"

# 3. Global Cloud Armor Security Policy + Attachment
gcloud compute security-policies create "${PREFIX}-global-ca-policy" \
    --project="${PROJECT_ID}" \
    --description="Global Cloud Armor WAF & DDoS policy for ${CLOUD_RUN_SERVICE}"

gcloud compute backend-services update "${PREFIX}-global-backend" \
    --project="${PROJECT_ID}" \
    --global \
    --security-policy="${PREFIX}-global-ca-policy"

# 4. Global Static IP, Managed SSL Certificate, URL Map, Target HTTPS Proxy & Forwarding Rule
gcloud compute addresses create "${PREFIX}-global-ip" \
    --project="${PROJECT_ID}" \
    --ip-version=IPV4 \
    --global

gcloud compute ssl-certificates create "${PREFIX}-ssl-cert" \
    --project="${PROJECT_ID}" \
    --domains="${DOMAIN}" \
    --global

gcloud compute url-maps create "${PREFIX}-global-url-map" \
    --project="${PROJECT_ID}" \
    --default-service="${PREFIX}-global-backend"

gcloud compute target-https-proxies create "${PREFIX}-global-https-proxy" \
    --project="${PROJECT_ID}" \
    --ssl-certificates="${PREFIX}-ssl-cert" \
    --url-map="${PREFIX}-global-url-map"

gcloud compute forwarding-rules create "${PREFIX}-global-https-fr" \
    --project="${PROJECT_ID}" \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --network-tier=PREMIUM \
    --address="${PREFIX}-global-ip" \
    --global \
    --target-https-proxy="${PREFIX}-global-https-proxy" \
    --ports=443
```

For inline Model Armor on a **Global External ALB**, import the `AuthzExtension` and `AuthzPolicy` in `--location=global` referencing the multi-regional or supported Model Armor endpoint and the global forwarding rule URI (`https://www.googleapis.com/compute/v1/projects/${PROJECT_ID}/global/forwardingRules/${PREFIX}-global-https-fr`).

---

## 3. Troubleshooting Common Issues

| Symptom | Root Cause | Resolution |
| :--- | :--- | :--- |
| **`500` / `403` from ALB immediately after attaching `AuthzPolicy` (when `failOpen: false`)** | Missing IAM roles on the Service Extensions service agent (`gcp-sa-dep`), or `AuthzExtension.service` region does not match the Model Armor template region. | Grant `roles/modelarmor.calloutUser`, `roles/modelarmor.user`, and `roles/serviceusage.serviceUsageConsumer` to `service-${PROJECT_NUMBER}@gcp-sa-dep.iam.gserviceaccount.com` and confirm `modelarmor.${REGION}.rep.googleapis.com` matches the template's `${REGION}`. |
| **Regional Forwarding Rule creation fails with `subnetwork ... REGIONAL_MANAGED_PROXY required`** | No active proxy-only subnet exists in `${REGION}` for the target VPC network. | Create a subnet with `--purpose=REGIONAL_MANAGED_PROXY --role=ACTIVE` in `${REGION}` (minimum `/26`, recommended `/23` or `/24`). |
| **Cloud Armor blocks legitimate coding/SQL questions sent to the AI agent (`403`)** | Preconfigured `sqli-v33-stable` or `xss-v33-stable` WAF rule matched code snippets inside the user's natural-language prompt. | Keep Cloud Armor focused on rate limiting, scanner/protocol defense, and IP/Geo filtering (or add path/JSON exclusions), and let inline **Model Armor** evaluate semantic prompt safety. |
| **Direct `*.run.app` URL still accepts uninspected prompts** | Cloud Run service ingress is still set to `all`. | Run `gcloud run services update ${CLOUD_RUN_SERVICE} --region=${REGION} --ingress=internal-and-cloud-load-balancing`. |
| **Template creation/update rejected with Floor Setting violation error** | Requested filter confidence level is less strict than Organization/Folder/Project Floor Settings (e.g., `HIGH` when floor requires `MEDIUM_AND_ABOVE`). | Inspect `gcloud model-armor floorsettings describe --full-uri="projects/${PROJECT_ID}/locations/global/floorSetting"` and raise template strictness (`LOW_AND_ABOVE` > `MEDIUM_AND_ABOVE` > `HIGH`). |
