---
name: adk-agent-runtime-memory-sessions
description: >-
  Provisions and configures Vertex AI Agent Runtime (ReasoningEngine) backends for
  remote Session Service and Memory Bank, custom Memory Bank topics, direct topic-tagged
  memory persistence, and adk web remote session enforcement. Use this skill whenever
  the user asks to set up a session and memory backend, add custom memory topics,
  disable local sessions in adk web, fix unsaved preferences in Gemini Platform Memory Bank,
  or deploy an ADK agent to Agent Runtime.
---

# Vertex AI Agent Runtime Sessions & Memory Bank Runbook

Follow this runbook to provision, configure, and wire Vertex AI Agent Runtime (`ReasoningEngine`) sessions (`VertexAiSessionService`) and Memory Bank (`VertexAiMemoryBankService`) cleanly on the first attempt.

## Critical Rules (Avoid Re-Prompting)

1. **Use `agentplatform._genai.types` (NOT `vertexai._genai.types`)**:
   When calling `agentplatform.Client(project=..., location=...).agent_engines.create()` or `.update()`, always construct `AgentEngineConfig`, `ReasoningEngineContextSpec`, `MemoryBankConfig`, `MemoryBankCustomizationConfig`, `MemoryTopic`, `CustomMemoryTopic`, `ManagedMemoryTopic`, `MemoryTopicId`, and `ManagedTopicEnum` from `agentplatform._genai.types`. Passing `vertexai._genai.types` raises a Pydantic validation error.
2. **Never put `GOOGLE_CLOUD_AGENT_ENGINE_*` in `.env`**:
   `GOOGLE_CLOUD_AGENT_ENGINE_*` are reserved system environment variable names inside Vertex AI Agent Runtime containers. Including them in `.env` causes `agents-cli deploy` to fail with `400 FAILED_PRECONDITION: EnvVar name 'GOOGLE_CLOUD_AGENT_ENGINE_ID' is reserved`. Always use `AGENT_ENGINE_ID`, `AGENT_ENGINE_RESOURCE_NAME`, and `AGENT_ENGINE_LOCATION` in `.env` instead.
3. **Separate Model Location (`global`) from Agent Engine Location (`us-central1`)**:
   Preview models like `gemini-4-neon` are served on the `global` endpoint (`GOOGLE_CLOUD_LOCATION=global`), whereas Vertex AI Agent Runtime (`ReasoningEngine`) resources are regional (`AGENT_ENGINE_LOCATION=us-central1`). Always call `load_dotenv(override=True)` in `app/agent.py` before initializing `Agent(...)` because `adk web` defaults `GOOGLE_CLOUD_LOCATION` to `us-central1` if not overridden.
4. **Enforce Remote Sessions in `adk web` via Root `services.py`**:
   `adk web` defaults to local SQLite (`.adk/session.db`) and `InMemoryMemoryService` unless overridden. Create a root [`services.py`](../../services.py) (loaded automatically by `adk web` before agent discovery) that sets `os.environ["ADK_DISABLE_LOCAL_STORAGE"] = "1"` and monkey-patches `google.adk.cli.utils.service_factory.create_session_service_from_options` and `create_memory_service_from_options` to return `VertexAiSessionService` and `VertexAiMemoryBankService`.
5. **Persist Preferences Directly via `client.agent_engines.memories.create()`**:
   Background session ingestion (`add_session_to_memory` -> `memories.ingest_events`) runs asynchronously under the Reasoning Engine service agent (`service-<PROJECT_NUMBER>@gcp-sa-aiplatform-re.iam.gserviceaccount.com`), which often lacks `aiplatform.endpoints.predict` IAM permissions in lab environments and silently drops memories. Always write structured user preferences directly using `client.agent_engines.memories.create(..., wait_for_completion=True)` with explicit `MemoryTopicId` tags under the user's application credentials.

## Procedure: Provisioning & Custom Memory Topics

Use [`scripts/provision_memory_backend.py`](../../scripts/provision_memory_backend.py) to create or update the `ReasoningEngine` instance with 4 managed topics and 4 custom restaurant topics:

- **Managed Topics (`ManagedTopicEnum`)**:
  - `USER_PERSONAL_INFO`
  - `USER_PREFERENCES`
  - `KEY_CONVERSATION_DETAILS`
  - `EXPLICIT_INSTRUCTIONS`
- **Custom Topics (`CustomMemoryTopic`)**:
  - `preferred_food_type`: User's preferred cuisines, dishes, ingredients, or dietary styles.
  - `allergies`: User's food allergies, intolerances, or strict dietary restrictions.
  - `preferred_price_range`: User's preferred restaurant budget or price tier (`$`, `$$`, `$$$`, `$$$$`).
  - `name`: User's name or preferred form of address.

## Procedure: Direct Topic-Tagged Memory Bank Writes

Inside `save_user_preferences_to_memory` in [`app/tools.py`](../../app/tools.py), persist each preference fact directly to the Agent Runtime Memory Bank:

```python
import agentplatform
from agentplatform._genai import types as ap_types

client = agentplatform.Client(project=project, location=location)
scope = {"app_name": app_name, "user_id": user_id}

operation = client.agent_engines.memories.create(
    name=reasoning_engine_name,
    fact=f"User's preferred food types and cuisines: {preferred_food_type}",
    scope=scope,
    config=ap_types.AgentEngineMemoryConfig(
        display_name="preferred_food_type",
        topics=[
            ap_types.MemoryTopicId(custom_memory_topic_label="preferred_food_type"),
            ap_types.MemoryTopicId(
                managed_memory_topic=ap_types.ManagedTopicEnum.USER_PREFERENCES
            ),
        ],
    ),
    wait_for_completion=True,
)
```

## Validation

Verify memories exist in the Gemini Agent Platform Memory Bank at any time:

```python
import agentplatform
client = agentplatform.Client(project=PROJECT_ID, location="us-central1")
for mem in client.agent_engines.memories.list(name=AGENT_ENGINE_RESOURCE_NAME):
    print(mem.name, mem.fact, mem.topics)
```
