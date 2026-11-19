#!/usr/bin/env bash
# Idempotent provisioning script for:
#   - Regional External Application Load Balancer (EXTERNAL_MANAGED) + Serverless NEG -> Cloud Run agent
#   - Inline Google Cloud Armor (Regional WAF + Rate-Limiting Security Policy on Backend Service)
#   - Inline Google Cloud Model Armor (Service Extensions AuthzExtension + Network Security AuthzPolicy CONTENT_AUTHZ)
#   - Optional Cloud Run ingress lockdown (--ingress=internal-and-cloud-load-balancing)
#
# Usage:
#   PROJECT_ID="my-project" REGION="us-central1" CLOUD_RUN_SERVICE="my-agent" \
#     bash scripts/setup_inline_alb_armor.sh
#
# Optional overrides:
#   PREFIX                 Resource name prefix (defaults to ${CLOUD_RUN_SERVICE})
#   NETWORK                VPC network name (default: "default")
#   PROXY_SUBNET_NAME      Proxy-only subnet name (default: "proxy-only-subnet-${REGION}")
#   PROXY_SUBNET_RANGE     CIDR for proxy-only subnet (default: "192.168.10.0/24")
#   MA_REQ_TEMPLATE_ID     Model Armor request template ID (default: "webtemplate")
#   MA_RESP_TEMPLATE_ID    Model Armor response template ID (default: "${MA_REQ_TEMPLATE_ID}")
#   MA_ENFORCEMENT_TYPE    INSPECT_ONLY (default) or INSPECT_AND_BLOCK
#   ENABLE_CLOUD_ARMOR     true (default) or false
#   ENABLE_MODEL_ARMOR     true (default) or false
#   RATE_LIMIT_RPM         Per-IP requests/min threshold for Cloud Armor throttle (default: 60)
#   WAF_PREVIEW            true (default) or false for Cloud Armor OWASP SQLi/XSS rule
#   LOCK_CLOUD_RUN_INGRESS false (default) or true (sets --ingress=internal-and-cloud-load-balancing)
#   DRY_RUN                false (default) or true (prints commands without executing)

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?ERROR: Set PROJECT_ID environment variable}"
REGION="${REGION:-us-central1}"
CLOUD_RUN_SERVICE="${CLOUD_RUN_SERVICE:?ERROR: Set CLOUD_RUN_SERVICE environment variable}"
PREFIX="${PREFIX:-${CLOUD_RUN_SERVICE}}"
NETWORK="${NETWORK:-default}"
PROXY_SUBNET_NAME="${PROXY_SUBNET_NAME:-proxy-only-subnet-${REGION}}"
PROXY_SUBNET_RANGE="${PROXY_SUBNET_RANGE:-192.168.10.0/24}"

MA_REQ_TEMPLATE_ID="${MA_REQ_TEMPLATE_ID:-webtemplate}"
MA_RESP_TEMPLATE_ID="${MA_RESP_TEMPLATE_ID:-${MA_REQ_TEMPLATE_ID}}"
MA_ENFORCEMENT_TYPE="${MA_ENFORCEMENT_TYPE:-INSPECT_ONLY}"

ENABLE_CLOUD_ARMOR="${ENABLE_CLOUD_ARMOR:-true}"
ENABLE_MODEL_ARMOR="${ENABLE_MODEL_ARMOR:-true}"
RATE_LIMIT_RPM="${RATE_LIMIT_RPM:-60}"
WAF_PREVIEW="${WAF_PREVIEW:-true}"
LOCK_CLOUD_RUN_INGRESS="${LOCK_CLOUD_RUN_INGRESS:-false}"
DRY_RUN="${DRY_RUN:-false}"

NEG_NAME="${PREFIX}-serverless-neg"
BACKEND_NAME="${PREFIX}-reg-backend"
URL_MAP_NAME="${PREFIX}-reg-url-map"
HTTP_PROXY_NAME="${PREFIX}-reg-http-proxy"
FR_NAME="${PREFIX}-reg-fr"
CA_POLICY="${PREFIX}-cloud-armor-policy"
AUTHZ_EXT_NAME="${PREFIX}-authz-ext"
AUTHZ_POLICY_NAME="${PREFIX}-authz-policy"

run_cmd() {
  echo "+ $*"
  if [[ "${DRY_RUN}" != "true" ]]; then
    "$@"
  fi
}

echo "=== [1/8] Enabling required Google Cloud APIs in ${PROJECT_ID} ==="
run_cmd gcloud services enable \
  run.googleapis.com \
  compute.googleapis.com \
  networkservices.googleapis.com \
  networksecurity.googleapis.com \
  modelarmor.googleapis.com \
  dlp.googleapis.com \
  --project="${PROJECT_ID}"

echo "=== [2/8] Verifying Cloud Run backend service (${CLOUD_RUN_SERVICE} in ${REGION}) ==="
if [[ "${DRY_RUN}" != "true" ]]; then
  gcloud run services describe "${CLOUD_RUN_SERVICE}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --format="value(status.url)" >/dev/null
fi

if [[ "${ENABLE_MODEL_ARMOR}" == "true" ]]; then
  echo "=== [3/8] Configuring Service Extensions Service Agent IAM for Model Armor ==="
  run_cmd gcloud beta services identity create \
    --service=networkservices.googleapis.com \
    --project="${PROJECT_ID}" --quiet || true

  if [[ "${DRY_RUN}" == "true" ]]; then
    PROJECT_NUMBER="PROJECT_NUMBER"
  else
    PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
  fi
  DEP_SA="service-${PROJECT_NUMBER}@gcp-sa-dep.iam.gserviceaccount.com"

  for ROLE in roles/modelarmor.calloutUser roles/modelarmor.user roles/serviceusage.serviceUsageConsumer; do
    run_cmd gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
      --member="serviceAccount:${DEP_SA}" \
      --role="${ROLE}" \
      --condition=None \
      --quiet >/dev/null
  done
else
  echo "=== [3/8] Skipping Model Armor IAM (ENABLE_MODEL_ARMOR=${ENABLE_MODEL_ARMOR}) ==="
fi

echo "=== [4/8] Provisioning Regional Proxy-Only Subnet & Serverless NEG ==="
if [[ "${DRY_RUN}" == "true" ]] || ! gcloud compute networks subnets list \
    --project="${PROJECT_ID}" \
    --regions="${REGION}" \
    --filter="network ~ /${NETWORK}$ AND purpose=REGIONAL_MANAGED_PROXY" \
    --format="value(name)" | grep -q .; then
  run_cmd gcloud compute networks subnets create "${PROXY_SUBNET_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --network="${NETWORK}" \
    --range="${PROXY_SUBNET_RANGE}" \
    --purpose=REGIONAL_MANAGED_PROXY \
    --role=ACTIVE
else
  echo "Proxy-only subnet already exists in ${REGION} for network ${NETWORK}; reusing."
fi

if [[ "${DRY_RUN}" == "true" ]] || ! gcloud compute network-endpoint-groups describe "${NEG_NAME}" \
    --project="${PROJECT_ID}" --region="${REGION}" >/dev/null 2>&1; then
  run_cmd gcloud compute network-endpoint-groups create "${NEG_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --network-endpoint-type=SERVERLESS \
    --cloud-run-service="${CLOUD_RUN_SERVICE}"
else
  echo "Serverless NEG ${NEG_NAME} already exists; reusing."
fi

echo "=== [5/8] Provisioning Regional External ALB (Backend, URL Map, Proxy, Forwarding Rule) ==="
if [[ "${DRY_RUN}" == "true" ]] || ! gcloud compute backend-services describe "${BACKEND_NAME}" \
    --project="${PROJECT_ID}" --region="${REGION}" >/dev/null 2>&1; then
  run_cmd gcloud compute backend-services create "${BACKEND_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --protocol=HTTPS

  run_cmd gcloud compute backend-services add-backend "${BACKEND_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --network-endpoint-group="${NEG_NAME}" \
    --network-endpoint-group-region="${REGION}"
else
  echo "Backend service ${BACKEND_NAME} already exists; reusing."
fi

if [[ "${DRY_RUN}" == "true" ]] || ! gcloud compute url-maps describe "${URL_MAP_NAME}" \
    --project="${PROJECT_ID}" --region="${REGION}" >/dev/null 2>&1; then
  run_cmd gcloud compute url-maps create "${URL_MAP_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --default-service="${BACKEND_NAME}"
fi

if [[ "${DRY_RUN}" == "true" ]] || ! gcloud compute target-http-proxies describe "${HTTP_PROXY_NAME}" \
    --project="${PROJECT_ID}" --region="${REGION}" >/dev/null 2>&1; then
  run_cmd gcloud compute target-http-proxies create "${HTTP_PROXY_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --url-map="${URL_MAP_NAME}" \
    --url-map-region="${REGION}"
fi

if [[ "${DRY_RUN}" == "true" ]] || ! gcloud compute forwarding-rules describe "${FR_NAME}" \
    --project="${PROJECT_ID}" --region="${REGION}" >/dev/null 2>&1; then
  run_cmd gcloud compute forwarding-rules create "${FR_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --network-tier=STANDARD \
    --network="${NETWORK}" \
    --ports=80 \
    --target-http-proxy="${HTTP_PROXY_NAME}" \
    --target-http-proxy-region="${REGION}"
fi

if [[ "${ENABLE_CLOUD_ARMOR}" == "true" ]]; then
  echo "=== [6/8] Configuring Regional Cloud Armor Policy & Attaching Inline to Backend Service ==="
  if [[ "${DRY_RUN}" == "true" ]] || ! gcloud compute security-policies describe "${CA_POLICY}" \
      --project="${PROJECT_ID}" --region="${REGION}" >/dev/null 2>&1; then
    run_cmd gcloud compute security-policies create "${CA_POLICY}" \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --type=CLOUD_ARMOR \
      --description="Inline Cloud Armor WAF and rate-limit policy for ${CLOUD_RUN_SERVICE}"

    run_cmd gcloud compute security-policies rules create 900 \
      --project="${PROJECT_ID}" \
      --region="${REGION}" \
      --security-policy="${CA_POLICY}" \
      --expression="true" \
      --action="throttle" \
      --rate-limit-threshold-count="${RATE_LIMIT_RPM}" \
      --rate-limit-threshold-interval-sec=60 \
      --conform-action="allow" \
      --exceed-action="deny-429" \
      --enforce-on-key="IP" \
      --description="Per-IP rate limit (${RATE_LIMIT_RPM} req/min) to protect Cloud Run agent and LLM quota"

    WAF_FLAGS=(
      --project="${PROJECT_ID}"
      --region="${REGION}"
      --security-policy="${CA_POLICY}"
      --expression="evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 2}) || evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 2})"
      --action="deny-403"
      --description="OWASP SQLi and XSS preconfigured WAF protection"
    )
    if [[ "${WAF_PREVIEW}" == "true" ]]; then
      WAF_FLAGS+=(--preview)
    fi
    run_cmd gcloud compute security-policies rules create 1000 "${WAF_FLAGS[@]}"
  else
    echo "Cloud Armor policy ${CA_POLICY} already exists; reusing."
  fi

  run_cmd gcloud compute backend-services update "${BACKEND_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --security-policy="${CA_POLICY}"
else
  echo "=== [6/8] Skipping Cloud Armor setup (ENABLE_CLOUD_ARMOR=${ENABLE_CLOUD_ARMOR}) ==="
fi

if [[ "${ENABLE_MODEL_ARMOR}" == "true" ]]; then
  echo "=== [7/8] Configuring Model Armor Template(s) & Inline ALB Service Extensions ==="
  for TPL in $(printf "%s\n%s\n" "${MA_REQ_TEMPLATE_ID}" "${MA_RESP_TEMPLATE_ID}" | sort -u); do
    if [[ "${DRY_RUN}" == "true" ]] || ! gcloud model-armor templates describe "${TPL}" \
        --project="${PROJECT_ID}" --location="${REGION}" >/dev/null 2>&1; then
      run_cmd gcloud model-armor templates create "${TPL}" \
        --project="${PROJECT_ID}" \
        --location="${REGION}" \
        --pi-and-jailbreak-filter-settings-enforcement=enabled \
        --pi-and-jailbreak-filter-settings-confidence-level=MEDIUM_AND_ABOVE \
        --malicious-uri-filter-settings-enforcement=enabled \
        --basic-config-filter-enforcement=enabled \
        --rai-settings-filters='[{"filterType":"HATE_SPEECH","confidenceLevel":"HIGH"},{"filterType":"HARASSMENT","confidenceLevel":"HIGH"},{"filterType":"DANGEROUS","confidenceLevel":"HIGH"},{"filterType":"SEXUALLY_EXPLICIT","confidenceLevel":"HIGH"}]' \
        --template-metadata-enforcement-type="${MA_ENFORCEMENT_TYPE}" \
        --template-metadata-log-template-operations \
        --template-metadata-log-sanitize-operations \
        --template-metadata-multi-language-detection
    else
      echo "Model Armor template ${TPL} already exists in ${REGION}; reusing."
    fi
  done

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TMP_DIR}"' EXIT

  EXT_YAML="${TMP_DIR}/${AUTHZ_EXT_NAME}.yaml"
  cat <<EOF > "${EXT_YAML}"
name: projects/${PROJECT_ID}/locations/${REGION}/authzExtensions/${AUTHZ_EXT_NAME}
loadBalancingScheme: EXTERNAL_MANAGED
service: modelarmor.${REGION}.rep.googleapis.com
timeout: 1s
failOpen: false
metadata:
  model_armor_settings: '[{"request_template_id": "projects/${PROJECT_ID}/locations/${REGION}/templates/${MA_REQ_TEMPLATE_ID}", "response_template_id": "projects/${PROJECT_ID}/locations/${REGION}/templates/${MA_RESP_TEMPLATE_ID}"}]'
EOF

  POL_YAML="${TMP_DIR}/${AUTHZ_POLICY_NAME}.yaml"
  cat <<EOF > "${POL_YAML}"
name: projects/${PROJECT_ID}/locations/${REGION}/authzPolicies/${AUTHZ_POLICY_NAME}
action: CUSTOM
policyProfile: CONTENT_AUTHZ
customProvider:
  authzExtension:
    resources:
    - projects/${PROJECT_ID}/locations/${REGION}/authzExtensions/${AUTHZ_EXT_NAME}
target:
  loadBalancingScheme: EXTERNAL_MANAGED
  resources:
  - https://www.googleapis.com/compute/v1/projects/${PROJECT_ID}/regions/${REGION}/forwardingRules/${FR_NAME}
EOF

  run_cmd gcloud service-extensions authz-extensions import "${AUTHZ_EXT_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --source="${EXT_YAML}"

  run_cmd gcloud network-security authz-policies import "${AUTHZ_POLICY_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --source="${POL_YAML}"
else
  echo "=== [7/8] Skipping inline Model Armor setup (ENABLE_MODEL_ARMOR=${ENABLE_MODEL_ARMOR}) ==="
fi

echo "=== [8/8] Finalizing Cloud Run Ingress & Summary ==="
if [[ "${LOCK_CLOUD_RUN_INGRESS}" == "true" ]]; then
  run_cmd gcloud run services update "${CLOUD_RUN_SERVICE}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --ingress=internal-and-cloud-load-balancing
fi

if [[ "${DRY_RUN}" != "true" ]]; then
  LB_IP="$(gcloud compute forwarding-rules describe "${FR_NAME}" \
    --project="${PROJECT_ID}" --region="${REGION}" --format='value(IPAddress)')"
  echo ""
  echo "Deployment complete!"
  echo "  Protected Load Balancer Endpoint : http://${LB_IP}/"
  echo "  Cloud Armor Security Policy      : ${CA_POLICY} (WAF preview=${WAF_PREVIEW})"
  echo "  Model Armor Request Template     : projects/${PROJECT_ID}/locations/${REGION}/templates/${MA_REQ_TEMPLATE_ID}"
  echo "  Model Armor Response Template    : projects/${PROJECT_ID}/locations/${REGION}/templates/${MA_RESP_TEMPLATE_ID}"
  echo "  Cloud Run Ingress Locked         : ${LOCK_CLOUD_RUN_INGRESS}"
fi
