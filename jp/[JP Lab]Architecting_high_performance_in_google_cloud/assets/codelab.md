# Building Advanced Agents with Antigravity CLI (`agy`) — Hands-On Codelab

Welcome to this hands-on codelab! In this guide, you will build, test, and deploy a full-featured **Restaurant Discovery Agent** step-by-step using the **Google Antigravity CLI (`agy`)**, **Agent Development Kit (ADK)**, **Gemini 4 Neon**, **Vertex AI Agent Runtime (Sessions & Memory Bank)**, **Google Maps Platform**, and **A2UI (Agent-to-UI)**.

Rather than manually writing every file from scratch, this codelab is **prompt-driven**: at each step, you will open the Antigravity CLI, provide the prompt, and let the agent execute the work while you learn what is happening under the hood.

---

## What You Will Build

By the end of this codelab, your agent will feature:
1. **Self-Maintaining Workspace Rules (`GEMINI.md`, `specs.md`, `codelab.md`)**: Automatic specification tracking and living documentation on every task.
2. **Scoped Google Maps Platform Integration**: Automated provisioning of a restricted `GOOGLE_MAPS_API_KEY` for the **Places API (New)**, **Geocoding API**, and **Maps JavaScript API**.
3. **Remote Vertex AI Agent Runtime Backend (`ReasoningEngine`)**: Managed **Sessions (`VertexAiSessionService`)** and **Memory Bank (`VertexAiMemoryBankService`)** configured with 4 managed topics and 4 custom dining topics (`name`, `preferred_food_type`, `allergies`, `preferred_price_range`).
4. **Multi-Agent ADK Architecture on `gemini-4-neon`**: Root `restaurant_finder` agent combining Google Search grounding (`AgentTool(google_search_agent)`), radius-scoped Google Maps Places lookup (`search_restaurants_on_google_maps`), and cross-session memory (`PreloadMemoryTool`).
5. **Three Interactive A2UI (Agent-to-UI) Experiences in `adk web`**:
   - **Initial-Fill Dining Preferences Form**: Web form card that collects and persists your 4 Memory Bank topics on first use, then stays silently in the background on all future sessions.
   - **Interactive Google Maps Location & Radius (km) Picker**: When you begin a restaurant search, displays an editable starting location, an interactive Google Map where clicking any point sets the starting pin, and a `km` radius dropdown (`0.5 km` – `10 km`) that resizes the map radius circle live.
   - **Side-by-Side Google Maps Results Explorer**: Once the search runs, displays numbered restaurant pin drops on the Google Map alongside a star-rated restaurant list (`★★★★★`) and an interactive details panel next to the map that updates whenever you click a pin drop or restaurant name.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        ADK Web UI (`adk web`) + A2UI                         │
│  ┌─────────────────────┐  ┌──────────────────────┐  ┌─────────────────────┐  │
│  │ 1. Preferences Form │  │ 2. Google Map + km   │  │ 3. Results Explorer │  │
│  │ (Initial Fill Only) │─▶│    Radius Picker     │─▶│ (Map Pins + Stars + │  │
│  │                     │  │ (Click Map Start Pt) │  │  Side Details View) │  │
│  └─────────────────────┘  └──────────────────────┘  └─────────────────────┘  │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                 Root ADK Agent: `restaurant_finder` (gemini-4-neon)          │
│  • `AgentTool(google_search_agent)` (Google Search Grounding)                │
│  • `render_user_preferences_form` & `save_user_preferences_to_memory`        │
│  • `render_restaurant_search_map_form` (Geocoding API + Map Surface)         │
│  • `search_restaurants_on_google_maps` (Places API Circle + Haversine km)    │
│  • `inject_a2ui_form_callback` (Deterministic `<a2ui-json>` Injection)       │
└──────────────────┬────────────────────────────────────────┬──────────────────┘
                   │                                        │
                   ▼                                        ▼
┌─────────────────────────────────────┐  ┌─────────────────────────────────────┐
│   Google Maps Platform APIs         │  │  Vertex AI Agent Runtime Backend    │
│  • Places API (New) `searchText`    │  │  • Remote `VertexAiSessionService`  │
│  • Geocoding API (Forward/Reverse)  │  │  • Remote `VertexAiMemoryBank`      │
│  • Maps JavaScript API (`Map`,      │  │    Topics: `name`, `allergies`,     │
│    `Marker`, `Circle`, `InfoWindow`)│  │    `preferred_food_type`,           │
└─────────────────────────────────────┘  │    `preferred_price_range`          │
                                         └─────────────────────────────────────┘
```

## Table of Contents
- [Prerequisites & Setup](#prerequisites--setup)
- [Step 1: Initialize Persistent Specification & Change Tracking (`specs.md` & `GEMINI.md`)](#step-1-initialize-persistent-specification--change-tracking-specsmd--geminimd)
- [Step 2: Create a Living Codelab Guide (`codelab.md`)](#step-2-create-a-living-codelab-guide-codelabmd)
- [Step 3: Check and Provision a Google Maps Platform API Key](#step-3-check-and-provision-a-google-maps-platform-api-key)
- [Step 4: Create an Agent Runtime Backend for Session and Memory](#step-4-create-an-agent-runtime-backend-for-session-and-memory)
- [Step 5: Add Custom Memory Topics to Memory Bank](#step-5-add-custom-memory-topics-to-memory-bank)
- [Step 6: Create the ADK Restaurant Finder Agent (Google Search + Google Maps + Remote Session & Memory Bank)](#step-6-create-the-adk-restaurant-finder-agent-google-search--google-maps--remote-session--memory-bank)
- [Step 7: Configure `gemini-4-neon` as the Main Model](#step-7-configure-gemini-4-neon-as-the-main-model)
- [Step 8: Test the Agent in the Interactive ADK Web UI (`adk web`)](#step-8-test-the-agent-in-the-interactive-adk-web-ui-adk-web)
- [Step 9: Deploy the ADK Agent to Agent Runtime](#step-9-deploy-the-adk-agent-to-agent-runtime)
- [Step 10: Add an A2UI Web Form Component to Collect User Memory Information (Initial Fill Only)](#step-10-add-an-a2ui-web-form-component-to-collect-user-memory-information-initial-fill-only)
- [Step 11: Add an A2UI Interactive Google Maps Location & Radius (km) Search Component](#step-11-add-an-a2ui-interactive-google-maps-location--radius-km-search-component)
- [Step 12: Show Search Results on Google Maps in A2UI with a Side Restaurant List, Stars, and Interactive Details Panel](#step-12-show-search-results-on-google-maps-in-a2ui-with-a-side-restaurant-list-stars-and-interactive-details-panel)
- [Step 13: End-to-End Testing Walkthrough & Troubleshooting Guide](#step-13-end-to-end-testing-walkthrough--troubleshooting-guide)
- [Step 14: Create Project Agent Skills for Smooth Codelab Execution (`.agents/skills/`)](#step-14-create-project-agent-skills-for-smooth-codelab-execution-agentsskills)

---

## Prerequisites & Setup

1. **Google Cloud Project & Authentication**:
   Ensure you are authenticated with `gcloud` and have a Google Cloud project configured:
   ```bash
   gcloud auth login
   gcloud auth application-default login
   gcloud config set project <YOUR_PROJECT_ID>
   ```
2. **Pre-Loaded Project Agent Skills (`.agents/skills/`)**:
   This repository includes three workspace **Agent Skills** under [`.agents/skills/`](./.agents/skills/) (automatically discovered by `agy` at Priority 1) that encode all architectural patterns and edge-case fixes for this codelab so every prompt below executes smoothly on the first try without re-prompting:
   - [`gcp-maps-api-setup`](./.agents/skills/gcp-maps-api-setup/SKILL.md): Provisions Google Maps Platform APIs and restricted API keys with `--billing-project`.
   - [`adk-agent-runtime-memory-sessions`](./.agents/skills/adk-agent-runtime-memory-sessions/SKILL.md): Configures Agent Runtime (`ReasoningEngine`) sessions & Memory Bank using `agentplatform._genai.types`, enforces remote sessions in `adk web` via `services.py`, and writes structured memories directly via `memories.create`.
   - [`adk-a2ui-google-maps`](./.agents/skills/adk-a2ui-google-maps/SKILL.md): Builds the `gemini-4-neon` restaurant finder agent (`AgentTool` search wrapper) and the three interactive A2UI surfaces in `adk web` (including the `@a2ui/angular` button/select/action bridge and Markdown-safe Google Maps widgets).
3. **Install and Launch Antigravity CLI (`agy`)**:
   Open your terminal in your project workspace (`advancedagents`) and start the interactive CLI:
   ```bash
   mkdir -p ~/advancedagents && cd ~/advancedagents
   agy
   ```
4. **Official Documentation References**:
   - [Antigravity Documentation Home](https://antigravity.google/docs)
   - [Antigravity CLI Reference](https://antigravity.google/docs/cli/reference)
   - [Antigravity CLI Best Practices](https://antigravity.google/docs/cli/best-practices)
   - [Antigravity Rules & Workflows](https://antigravity.google/docs/rules-workflows)
   - [Antigravity Agent Skills Guide](https://antigravity.google/docs/skills)

---

## Step 1: Initialize Persistent Specification & Change Tracking (`specs.md` & `GEMINI.md`)

### Goal
Before building our project, we want the agent to automatically maintain a living specification and changelog (`specs.md`) across every task we run, without us having to remind it each time.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
Create specs.md file and record all the changes happening here, make changes in gemini.md or some file to make sure this happens for all the future tasks.
```

### What Is Happening Under the Hood?
1. **Workspace Rule Discovery (`GEMINI.md`)**:
   Antigravity automatically discovers directory-based rule files named `GEMINI.md` (or `AGENTS.md`) by walking up from the current working directory to the workspace root. Standalone `GEMINI.md` files are **always active** for their directory scope and are injected into the agent's system prompt on every turn.
2. **Living Specification (`specs.md`)**:
   The agent creates `specs.md` at the root of the workspace with two main sections:
   - **Current Specifications**: A single source of truth describing the current state and rules of the project.
   - **Change History**: A chronological log of every task, listing created, modified, or deleted files and architectural decisions.
3. **Self-Enforcing Workflow**:
   Because `GEMINI.md` instructs the agent to read and update `specs.md` on every task, every subsequent prompt you run in `agy` will automatically keep `specs.md` up to date.

### Official Documentation
- [Workspace Rules (`GEMINI.md` / `AGENTS.md`)](https://antigravity.google/docs/rules-workflows) — Learn how hierarchical rules, context budgets, and automatic discovery work in Antigravity.

---

## Step 2: Create a Living Codelab Guide (`codelab.md`)

### Goal
Create a reproducible tutorial (`codelab.md`) that records every prompt we give to the Antigravity CLI, explains the concepts and actions taken in each step, and links to official documentation so other developers can replay the exact workflow.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
Create codelab.md file and then add all the important steps in the file as we go. Edit the bits as we go as well. This file will be used by other users to recreate these steps. The prompts I provide are the most important ones, because they will open antigravity cli and ask antigravity cli to do the task with those prompts. However it is important to explain what exactly we are doing. If you can find official documentation for the particular task make sure to include that as well.
```

### What Is Happening Under the Hood?
1. **Creating `codelab.md`**:
   The agent generates this step-by-step markdown guide capturing both the initial setup (Step 1) and the current task (Step 2), placing the exact prompts front-and-center so any user can copy-paste them into `agy`.
2. **Updating `GEMINI.md` for Continuous Codelab Maintenance**:
   To make sure the agent updates `codelab.md` automatically as we progress through future prompts, the agent expands `GEMINI.md` to require updating **both** `specs.md` (technical changelog & specs) and `codelab.md` (user-facing tutorial with the exact prompt, explanation, and official documentation links) after every task.
3. **Updating `specs.md`**:
   Following the rule established in Step 1, the agent logs the creation of `codelab.md` and the update to `GEMINI.md` inside `specs.md`.

### Official Documentation
- [Antigravity CLI Features](https://antigravity.google/docs/cli/features)
- [Antigravity Rules & Workflows](https://antigravity.google/docs/rules-workflows)

---

## Step 3: Check and Provision a Google Maps Platform API Key

### Goal
Ensure our workspace has a valid, properly scoped **Google Maps Platform API Key** ready to use. If one is not already present in the workspace environment, the agent automatically enables the required Google Maps APIs on Google Cloud, creates an API key restricted to those services, and saves it to a `.env` file.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
We need to use Google Maps API in this codelab, so if the API key for Google Maps API key is not present , create it.
```

### What Is Happening Under the Hood?
1. **Checking Local Environment & Existing GCP Keys**:
   The agent first checks local environment variables and `.env` files for `GOOGLE_MAPS_API_KEY`, and inspects the active Google Cloud project (`gcloud config list` and `gcloud services api-keys list`).
2. **Enabling Google Maps Platform APIs**:
   The agent enables the core Google Maps Platform services and the API Keys service in the active GCP project using `gcloud services enable`:
   ```bash
   gcloud services enable \
     apikeys.googleapis.com \
     maps-backend.googleapis.com \
     places.googleapis.com \
     places-backend.googleapis.com \
     geocoding-backend.googleapis.com \
     routes.googleapis.com \
     directions-backend.googleapis.com \
     distance-matrix-backend.googleapis.com \
     static-maps-backend.googleapis.com \
     --project=$GOOGLE_CLOUD_PROJECT --billing-project=$GOOGLE_CLOUD_PROJECT
   ```
3. **Creating a Restricted Google Maps API Key**:
   Following security best practices, the agent creates a dedicated API key (`Advanced Agents Codelab Maps Key`) restricted specifically to the Google Maps Platform APIs using `gcloud services api-keys create`:
   ```bash
   gcloud services api-keys create \
     --display-name="Advanced Agents Codelab Maps Key" \
     --api-target=service=maps-backend.googleapis.com \
     --api-target=service=places.googleapis.com \
     --api-target=service=places-backend.googleapis.com \
     --api-target=service=geocoding-backend.googleapis.com \
     --api-target=service=routes.googleapis.com \
     --api-target=service=directions-backend.googleapis.com \
     --api-target=service=distance-matrix-backend.googleapis.com \
     --api-target=service=static-maps-backend.googleapis.com \
     --project=$GOOGLE_CLOUD_PROJECT --billing-project=$GOOGLE_CLOUD_PROJECT
   ```
4. **Saving `.env` and Protecting Secrets with `.gitignore`**:
   The agent writes `GOOGLE_MAPS_API_KEY=<YOUR_API_KEY>` (along with `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`) to `.env` in the workspace root, and creates `.gitignore` so `.env` is never accidentally committed to version control.

### Official Documentation
- [Google Maps Platform — Use API Keys](https://developers.google.com/maps/documentation/javascript/get-api-key)
- [Google Cloud — Managing API Keys (`gcloud services api-keys`)](https://cloud.google.com/docs/authentication/api-keys-use)
- [Google Cloud CLI Reference: `gcloud services api-keys create`](https://cloud.google.com/sdk/gcloud/reference/services/api-keys/create)

---

## Step 4: Create an Agent Runtime Backend for Session and Memory

### Goal
Provision a managed **Agent Runtime** (Vertex AI Agent Engine / `ReasoningEngine`) backend instance on Google Cloud configured with **Session storage** and **Memory Bank** so our agent can persist both conversation sessions and long-term cross-session user memories.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
In Agent Runtime Create a new backend to hold Session and Memory that our agent can use.
```

### What Is Happening Under the Hood?
1. **Why a Standalone Agent Runtime Backend?**
   In the Gemini Enterprise Agent Platform (Vertex AI Agent Engine) and Agent Development Kit (ADK), a single `ReasoningEngine` resource can act as a managed backend for:
   - **Managed Sessions (`VertexAiSessionService`)**: Stores multi-turn conversation events and session state (`session.state`).
   - **Managed Cross-Session Memory (`VertexAiMemoryBankService`)**: Automatically extracts, consolidates, and recalls durable facts across separate sessions using **Memory Bank**.
   Even when your agent runs locally during development or in a container on Cloud Run, pointing `session_service_uri` and `memory_service_uri` at `agentengine://projects/<PROJECT>/locations/<LOCATION>/reasoningEngines/<ENGINE_ID>` connects ADK directly to this managed backend.
2. **Configuring Memory Bank Topics (`ReasoningEngineContextSpec`)**:
   To enable Memory Bank on the Agent Runtime instance, we pass a `ReasoningEngineContextSpec` containing a `ReasoningEngineContextSpecMemoryBankConfig` with four managed memory topics:
   - `USER_PERSONAL_INFO` (names, relationships, hobbies, important dates)
   - `USER_PREFERENCES` (likes, dislikes, preferred styles)
   - `KEY_CONVERSATION_DETAILS` (milestones, task outcomes)
   - `EXPLICIT_INSTRUCTIONS` (information the user explicitly asks the agent to remember or forget)
3. **Idempotent Provisioning Script (`scripts/provision_memory_backend.py`)**:
   The agent creates and runs [`scripts/provision_memory_backend.py`](./scripts/provision_memory_backend.py), which:
   - Initializes `agentplatform.Client(project=project_id, location=location)` in `us-central1`.
   - Checks if an Agent Runtime engine named `advancedagents-session-memory-backend` already exists; if not, creates it with `client.agent_engines.create(config=AgentEngineConfig(display_name=..., context_spec=context_spec))`.
   - Writes the resulting resource identifiers and `agentengine://` URIs into `.env` (avoiding reserved `GOOGLE_CLOUD_AGENT_ENGINE_*` prefixes so the same `.env` file can be deployed to Agent Runtime without conflicts):
     - `AGENT_ENGINE_SESSION_NAME=advancedagents-session-memory-backend`
     - `AGENT_ENGINE_LOCATION=us-central1`
     - `AGENT_ENGINE_RESOURCE_NAME=projects/<PROJECT_NUMBER>/locations/us-central1/reasoningEngines/<ENGINE_ID>`
     - `SESSION_SERVICE_URI=agentengine://projects/<PROJECT_NUMBER>/locations/us-central1/reasoningEngines/<ENGINE_ID>`
     - `MEMORY_SERVICE_URI=agentengine://projects/<PROJECT_NUMBER>/locations/us-central1/reasoningEngines/<ENGINE_ID>`

### Official Documentation
- [Vertex AI Agent Engine (Agent Runtime) Overview](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/overview)
- [Agent Engine Sessions Overview (`VertexAiSessionService`)](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/sessions/overview)
- [Vertex AI Memory Bank Overview & Setup](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview)
- [Agent Development Kit (ADK) — Sessions & Memory](https://adk.dev/sessions/)

---

## Step 5: Add Custom Memory Topics to Memory Bank

### Goal
Customize our Agent Runtime Memory Bank configuration by adding domain-specific **Custom Memory Topics** (`Preferred food type`, `Allergies`, `Preferred price range`, and `Name`) alongside the platform's built-in managed topics so Memory Bank extracts and consolidates dining-related facts from conversations.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
Add the following topics to the Memorhy Bank managed topics, Preferred food type
Allergies
Preferred price range
Name
```

### What Is Happening Under the Hood?
1. **Managed vs. Custom Memory Topics in Memory Bank**:
   Vertex AI Memory Bank supports two types of topics inside `MemoryBankCustomizationConfig.memory_topics`:
   - **Managed Memory Topics (`ManagedMemoryTopic`)**: Pre-defined platform enums (`USER_PERSONAL_INFO`, `USER_PREFERENCES`, `KEY_CONVERSATION_DETAILS`, `EXPLICIT_INSTRUCTIONS`).
   - **Custom Memory Topics (`CustomMemoryTopic`)**: Developer-defined topics with a `label` and a natural-language `description` that instructs Memory Bank's extraction model on the exact domain facts to capture and consolidate across turns.
2. **Updating `scripts/provision_memory_backend.py`**:
   The agent updates [`scripts/provision_memory_backend.py`](./scripts/provision_memory_backend.py) to include four `CustomMemoryTopic` entries inside `MEMORY_BANK_CONFIG`:
   - `preferred_food_type`: *"Preferred food type: The user's favorite cuisines, dishes, dietary preferences, or preferred types of food."*
   - `allergies`: *"Allergies: Any food allergies, intolerances, or dietary restrictions the user has mentioned."*
   - `preferred_price_range`: *"Preferred price range: The user's budget or preferred price tier for dining and restaurants (e.g., $, $$, $$$, inexpensive, moderate, fine dining)."*
   - `name`: *"Name: The user's name or preferred way to be addressed."*
3. **Applying the Updated `context_spec` in Place**:
   Running `scripts/provision_memory_backend.py` detects the existing `advancedagents-session-memory-backend` instance and calls `client.agent_engines.update(name=resource_name, config=AgentEngineConfig(display_name=display_name, context_spec=context_spec))` to patch the live Agent Runtime backend with all 8 topics.

### Official Documentation
- [Set Up Vertex AI Memory Bank — Customization Config & Custom Topics](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/set-up#customization-config)
- [Generate & Fetch Memories with Memory Bank](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/generate-memories)

---

## Step 6: Create the ADK Restaurant Finder Agent (Google Search + Google Maps + Remote Session & Memory Bank)

### Goal
Build an **Agent Development Kit (ADK)** agent (`restaurant_finder`) that takes natural-language requests like *"Find me restaurants near shibuya"*, combines **Google Search grounding** with live **Google Maps Places API** lookups, and uses the **remote Agent Runtime Session & Memory Bank** backend created in Step 4 instead of local sessions.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
Create an ADK Agent that can take user input like “Find me restaurants near shibuya”, then do google search and look at google maps and find the restaurants near shibuya. I want the agent to use remote session that was created not local session.
```

### What Is Happening Under the Hood?
1. **Scaffolding the ADK Project with `agents-cli`**:
   The agent scaffolds a standard ADK Python project (`restaurant-finder`) targeting `agent_runtime` and installs dependencies in `.venv` via `uv sync`.
2. **Combining `google_search` Grounding with Custom Function Tools (`AgentTool` Pattern)**:
   In Gemini and ADK, `google_search` is a model-internal grounding tool that cannot be mixed directly in the same `tools=[...]` list with custom Python `FunctionTool`s without disabling Automatic Function Calling (AFC). To use both seamlessly:
   - We define a specialist `google_search_agent` equipped with `tools=[google_search]`.
   - We wrap `google_search_agent` using `AgentTool(agent=google_search_agent)` on the `root_agent` (`restaurant_finder`) alongside our custom `search_restaurants_on_google_maps` function tool and `PreloadMemoryTool()`.
3. **Live Google Maps Places API Lookup (`app/tools.py`)**:
   In [`app/tools.py`](./app/tools.py), `search_restaurants_on_google_maps(location_or_query, cuisine_or_keyword)` calls the **Google Maps Places API (New)** (`POST https://places.googleapis.com/v1/places:searchText`) using the `GOOGLE_MAPS_API_KEY` from `.env`, returning verified restaurant names, formatted addresses, ratings, user review counts, price levels, open status, editorial summaries, and direct Google Maps links (`googleMapsUri`).
4. **Enforcing Remote Agent Runtime Sessions & Memory Bank Everywhere (`services.py` & `app/app_utils/services.py`)**:
   - By default, running `adk web` or `agents-cli run` locally would fall back to local SQLite (`.adk/session.db`) or `InMemorySessionService`.
   - To guarantee the agent **always** uses the remote Agent Runtime backend created in Step 4:
     - We set `ADK_DISABLE_LOCAL_STORAGE=1` in `.env`.
     - [`app/app_utils/services.py`](./app/app_utils/services.py) resolves `SESSION_SERVICE_URI` and `MEMORY_SERVICE_URI` from `.env` (`agentengine://projects/.../reasoningEngines/...`), wiring `VertexAiSessionService` and `VertexAiMemoryBankService` across FastAPI, A2A, and `agents-cli run`.
     - Root [`services.py`](./services.py) (which `adk web` automatically imports via `load_services_module(agents_dir)`) overrides ADK's default service factory functions so `adk web` also routes all session and memory operations to the remote Agent Runtime backend out of the box.
   - `root_agent` includes `PreloadMemoryTool()` in `tools` (to recall user memories at the start of each turn) and `after_agent_callback=generate_memories_callback` (`await callback_context.add_session_to_memory()`).

### Official Documentation
- [Agent Development Kit (ADK) Documentation](https://adk.dev/)
- [ADK Built-in Tools — Google Search Grounding](https://adk.dev/tools/built-in-tools/)
- [ADK Multi-Agent & `AgentTool` Pattern](https://adk.dev/agents/multi-agents/)
- [Google Maps Platform — Places API (New) Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)

---

## Step 7: Configure `gemini-4-neon` as the Main Model

### Goal
Update our ADK Restaurant Finder agent (`restaurant_finder` and its `google_search_agent` sub-agent) to use **Gemini 4 Neon (`gemini-4-neon`)** as the main model.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
Use gemini 4 Neon as the main model.
```

### What Is Happening Under the Hood?
1. **Verifying Model Availability on Vertex AI (`global` endpoint)**:
   The agent queries `genai.Client(vertexai=True, location="global").models.list()` to confirm the exact publisher model ID (`publishers/google/models/gemini-4-neon` → `gemini-4-neon`).
2. **Updating `app/agent.py` & `.env`**:
   - In [`app/agent.py`](./app/agent.py), `MODEL = os.environ.get("MODEL_NAME", "gemini-4-neon")` sets `gemini-4-neon` as the default model for both `root_agent` (`restaurant_finder`) and `google_search_agent`.
   - In [`.env`](./.env), `MODEL_NAME=gemini-4-neon` and `GOOGLE_CLOUD_LOCATION=global` ensure Vertex AI routes model inference requests to the global endpoint where `gemini-4-neon` is served, while `SESSION_SERVICE_URI` and `MEMORY_SERVICE_URI` continue routing session and memory operations to our regional `us-central1` Agent Runtime backend.

### Official Documentation
- [ADK — Google Gemini Models Configuration](https://adk.dev/agents/models/google-gemini/)
- [Gemini Enterprise Agent Platform — Model Endpoint Locations](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations#google-models)

---

## Step 8: Test the Agent in the Interactive ADK Web UI (`adk web`)

### Goal
Open a new terminal, activate the project virtual environment, launch the **ADK Developer Web UI (`adk web`)**, and test the agent's Google Search, Google Maps, and remote Agent Runtime Session & Memory Bank capabilities interactively.

### Prompts to Run in `agy`
Copy and paste the following prompts into the Antigravity CLI:

```text
source /home/user/advancedagents/.venv/bin/activate
```

```text
Refine and add these steps for user testing of agents. Open new terminal and go to the correct folder
cd ~/advancedagents
Enter this command,
adk web --allow_origins "*"
```

### Commands to Run in a New Terminal
1. **Open a new terminal and navigate to the project folder**:
   ```bash
   cd ~/advancedagents
   ```
2. **Activate the Python virtual environment**:
   ```bash
   source /home/user/advancedagents/.venv/bin/activate
   ```
3. **Start the ADK Web UI server**:
   ```bash
   adk web --allow_origins "*"
   ```

### What Is Happening Under the Hood?
1. **Activating `.venv`**:
   `source /home/user/advancedagents/.venv/bin/activate` puts the project's virtual environment (`/home/user/advancedagents/.venv/bin`) on your `PATH` so the `adk` CLI and all installed packages (`google-adk`, `google-cloud-aiplatform`, etc.) are active.
2. **Remote Session & Memory Bank Connection via `services.py`**:
   When you run `adk web --allow_origins "*"` from `~/advancedagents`:
   - ADK scans the workspace and discovers our `app` agent package (`restaurant_finder`).
   - ADK automatically imports [`services.py`](./services.py) from the workspace root (`load_services_module`), which disables local `.adk/session.db` storage and connects both `VertexAiSessionService` and `VertexAiMemoryBankService` to the remote Agent Runtime backend configured in `.env` (e.g., `agentengine://projects/<PROJECT_NUMBER>/locations/us-central1/reasoningEngines/<ENGINE_ID>`).
   - You can verify a remote session is active in the UI by checking the **Session ID**: remote Agent Runtime sessions use 64-bit integer IDs (e.g., `7962629501450452992`) rather than local UUIDs.
3. **Why `--allow_origins "*"`?**
   Passing `--allow_origins "*"` configures FastAPI CORS middleware to accept requests from any origin, which is essential when accessing the ADK Web UI through Cloud Workstations, Cloud Shell Web Preview, or port-forwarded browser URLs.

### Official Documentation
- [ADK Developer Web UI (`adk web`)](https://adk.dev/runtime/web/)
- [ADK CLI Reference (`--allow_origins`, `--session_service_uri`, `--memory_service_uri`)](https://adk.dev/runtime/command-line-interface/)
- [Astral `uv` — Managing Project Environments](https://docs.astral.sh/uv/concepts/projects/layout/)

---

## Step 9: Deploy the ADK Agent to Agent Runtime

### Goal
Package and deploy our containerized ADK Restaurant Finder agent directly to **Vertex AI Agent Runtime** (`advancedagents-session-memory-backend`) so it runs as a fully managed cloud service with built-in Session storage, Memory Bank, A2A endpoints, and Google Cloud Console Playground support.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
Deploy this agent to agent runtime.
```

### What Is Happening Under the Hood?
1. **Container-Based Agent Runtime Deployment (`agents-cli deploy`)**:
   The agent runs `agents-cli deploy` targeting our existing Agent Runtime resource (`advancedagents-session-memory-backend` in `us-central1`):
   ```bash
   agents-cli deploy \
     --project $GOOGLE_CLOUD_PROJECT \
     --region us-central1 \
     --service-name advancedagents-session-memory-backend \
     --no-confirm-project
   ```
2. **Packaging & Environment Variable Propagation**:
   - `agents-cli deploy` packages the project source files (`Dockerfile`, `pyproject.toml`, `uv.lock`, `app/`) honoring `.gcloudignore`.
   - It reads [`.env`](./.env) and injects `GOOGLE_MAPS_API_KEY`, `MODEL_NAME=gemini-4-neon`, `GOOGLE_CLOUD_LOCATION=global`, `SESSION_SERVICE_URI`, and `MEMORY_SERVICE_URI` into the Agent Runtime deployment specification (automatically omitting reserved `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_AGENT_ENGINE_*` variables that the platform injects itself).
3. **Unified Serving Contract (`app/fast_api_app.py` & `reasoning_engine_adapter.py`)**:
   - Agent Runtime builds the container image from [`Dockerfile`](./Dockerfile) and starts `uvicorn app.fast_api_app:app --host 0.0.0.0 --port 8080`.
   - [`app/app_utils/reasoning_engine_adapter.py`](./app/app_utils/reasoning_engine_adapter.py) wires `session_service_builder=services.get_session_service` and `memory_service_builder=services.get_memory_service` into `AdkApp`, so queries from the Google Cloud Console Playground (`:streamQuery`), ADK HTTP routes, and A2A (`/a2a/app`) all share the same Agent Runtime Session & Memory Bank backend.
4. **Recording Deployment Metadata (`deployment_metadata.json`)**:
   Once the deployment operation finishes, `agents-cli deploy` writes `deployment_metadata.json` with the deployed `remote_agent_runtime_id` and prints the Console Playground URL.

### Official Documentation
- [Deploy an ADK Agent to Vertex AI Agent Runtime](https://adk.dev/deploy/agent-engine/)
- [Vertex AI Agent Engine — Deploy and Manage Agents](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/deploy)

---

## Step 10: Add an A2UI Web Form Component to Collect User Memory Information (Initial Fill Only)

### Goal
Add an interactive **A2UI (Agent-to-UI)** web form component to our ADK agent so users can enter and submit all four Memory Bank topics (**Name**, **Preferred food type**, **Allergies**, and **Preferred price range**) on initial setup, persist them directly into Vertex AI Memory Bank, and keep them silently in the background on all subsequent turns and sessions.

### Prompts to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
Add a component to ask for all the user information to be included in the memory, It should look a bit like a web form, this is in A2UI.
```

> **Note (Iterative Refinements Applied)**: During development, we also ran these two follow-up prompts to ensure the A2UI button styled/submitted properly in `adk web` and wrote topic-tagged memories synchronously into Vertex AI Memory Bank:
> ```text
> I tried but the UI came back without a functioning button. First the button is blank and then when I click it it does nothing.
> ```
> ```text
> Now the A2UI is giving me good UI but the saved preferences is not saved. In my last session I got following ack but in the memory itself, I cannot find the data in Gemini Platform.
> ```

### What Is Happening Under the Hood?
1. **How A2UI Works in ADK (`<a2ui-json>`)**:
   **A2UI (Agent-to-UI)** allows ADK agents to return declarative UI definitions (`beginRendering`, `surfaceUpdate`, and `dataModelUpdate`) wrapped in `<a2ui-json>...</a2ui-json>` blocks (or A2A `DataPart`s). The ADK Web UI (`adk web`) includes a built-in Angular `<app-a2ui-canvas>` / `<a2ui-surface>` renderer that automatically parses `<a2ui-json>` blocks and renders interactive components (`Card`, `Column`, `Text`, `Divider`, `TextField`, `MultipleChoice`, and `Button`) inside the chat message bubble.
2. **Building the Declarative A2UI Web Form (`app/tools.py`)**:
   In [`app/tools.py`](./app/tools.py), `build_user_preferences_a2ui_payload(...)` and `render_user_preferences_form(...)` construct a complete A2UI surface (`surfaceId: "@default"`, `root: "preferences-card"`) containing:
   - **`Card` & `Column` Layout**: Header (`"Dining Preferences & Memory Profile"`), descriptive subtitle, and `Divider`.
   - **Three `TextField` Inputs**:
     - `name-field` bound to `/name` (**Name**)
     - `food-type-field` bound to `/preferredFoodType` (**Preferred Food Type**)
     - `allergies-field` bound to `/allergies` (**Allergies / Dietary Restrictions**)
   - **One `MultipleChoice` Dropdown**:
     - `price-range-field` bound to `/preferredPriceRange` (**Preferred Price Range**: `$`, `$$`, `$$$`, `$$$$`)
   - **Submit `Button` (`Save Preferences to Memory`)**:
     - Dispatches `action.name = "save_user_preferences"` with a `context` binding `/name`, `/preferredFoodType`, `/allergies`, and `/preferredPriceRange`.
   - **Initial-Fill Guard**: Before attaching the form, `render_user_preferences_form` checks whether the user's preferences are already stored in Memory Bank (`_load_preferences_from_memory_bank`). Once filled, it returns `status: "already_configured"` so the form is never shown again on future greetings or searches.
3. **Deterministic A2UI Injection (`inject_a2ui_form_callback` in `app/agent.py`)**:
   Rather than relying on the LLM to hand-write 200 lines of JSON without syntax errors, `render_user_preferences_form` saves the validated A2UI JSON in `tool_context.state["temp:a2ui_form_json"]`, and `inject_a2ui_form_callback` (`after_model_callback` on `root_agent`) strips any LLM-written `<a2ui-json>` tags and appends the verified `<a2ui-json>...</a2ui-json>` payload to the final response text.
4. **Persisting Submitted Form Data to Memory Bank (`save_user_preferences_to_memory` & `services.py`)**:
   - In [`services.py`](./services.py), `_ensure_a2ui_button_action_bridge()` automatically configures the ADK Web UI's `@a2ui/angular` surface and button renderer (`index.html`, `main-KSQARI5D.js`, `chunk-2SRK2U7X.js`, `chunk-Q6H4XMU7.js`, `chunk-BPUQWVAT.js`) so that:
     1. The neutral CSS palette (`--n-100`..`--n-0`) and button text styles (`#ffffff` on `#1a73e8`) are explicitly defined (preventing `<a2ui-text>` inside `<a2ui-button>` from inheriting the button's background color `--p-30`/`--p-70`).
     2. Clicking **Save Preferences to Memory** reads the live form inputs (**Name**, **Preferred Food Type**, **Allergies**, and **Preferred Price Range**), shows instant visual confirmation (`"✓ Saving Preferences to Memory..."`), and directly invokes `app-chat.sendMessage(...)` on the Angular chat component.
   - The agent receives the submitted preferences and invokes `save_user_preferences_to_memory(name, preferred_food_type, allergies, preferred_price_range)` in [`app/tools.py`](./app/tools.py), which calls `_persist_preferences_to_memory_bank(...)` using `client.agent_engines.memories.create(..., wait_for_completion=True)` with explicit `MemoryTopicId(custom_memory_topic_label=...)` and `MemoryTopicId(managed_memory_topic=...)` tags. This synchronously writes all four topic-tagged memories (`name`, `preferred_food_type`, `allergies`, `preferred_price_range`) directly into the remote **Agent Runtime Memory Bank** so they are immediately visible in the Google Cloud Console and retrievable by `PreloadMemoryTool` across sessions!

### Official Documentation
- [ADK — A2UI (Agent-to-UI) Integration Guide](https://adk.dev/integrations/a2ui/)
- [A2UI Official Specification & Component Catalog (`a2ui.org`)](https://a2ui.org/)
- [Google A2UI GitHub Repository & ADK Samples](https://github.com/google/A2UI/tree/main/samples/agent/adk)

---

## Step 11: Add an A2UI Interactive Google Maps Location & Radius (km) Search Component

### Goal
When a user begins a search for restaurants (for example, `"Find me restaurants near shibuya"`), present an interactive **A2UI Location & Radius Search UI** that:
1. Pre-fills the approximate location requested by the user in an editable text field.
2. Displays the location and search radius on an interactive **Google Map** where clicking **any location on the map** sets the new starting point (moving the marker/circle and reverse-geocoding the clicked point).
3. Includes a **Search Radius (km) dropdown (`MultipleChoice`)** (`0.5 km`, `1 km`, `2 km`, `3 km`, `5 km`, `10 km`) that dynamically resizes the radius circle on the Google Map.
4. Pre-populates the user's **Budget (`preferred_price_range`)** and **Preferences (`preferred_food_type`, `allergies`)** from the remote **Agent Runtime Memory Bank** and searches for matching restaurants within that exact kilometer radius.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
When the user begins search for restaurants, A2UI should come with a UI that has approximate location that user has asked that can be edited and within how many kms. It should also show this in google maps and user should be able to click on any location and that will be start point. There should be a dropdown that sets how many kms from the starting point should be searched for the restaurants in users budget and users preferences.
```

### What Is Happening Under the Hood?
1. **Geocoding the Approximate Location (`render_restaurant_search_map_form` in `app/tools.py`)**:
   - When the user begins a search (e.g., `"Find me restaurants near shibuya"`), `root_agent` calls `render_restaurant_search_map_form(approximate_location="Shibuya, Tokyo", default_radius_km="2")`.
   - `geocode_location(...)` calls the **Google Maps Geocoding API** (`https://maps.googleapis.com/maps/api/geocode/json`) to resolve `"Shibuya, Tokyo"` into its formatted address (`"Shibuya, Tokyo, Japan"`) and coordinates (`latitude: 35.661971, longitude: 139.703795`).
   - Once the user's preferences have been filled on initial setup, `render_user_preferences_form` skips re-rendering (`status: "already_configured"`) and the agent never displays or repeats the user's preferences again—instead, preferences are kept in the background.
2. **Interactive Google Map & Radius Circle Inside the A2UI Surface (`services.py` / `index.html`)**:
   - `build_restaurant_search_map_a2ui_payload(...)` emits an A2UI `Card` (`location-search-card` on `map_search_surface`) containing **only**:
     - `search-map-widget` (`@@ADK_GOOGLE_MAP@@<lat>@@<lng>@@<radius>@@`)
     - `search-location-field` (`TextField` bound to `/location`)
     - `search-radius-field` (`MultipleChoice` dropdown for `0.5 km`, `1 km`, `2 km`, `3 km`, `5 km`, `10 km` bound to `/radiusKm`)
     - `search-submit-button` (`🔍 Search Restaurants Within Radius`)
   - In [`app/agent.py`](./app/agent.py), `inject_a2ui_form_callback` strips any LLM-written `<a2ui-json>` blocks so only the verified tool payload from `callback_context.state["temp:a2ui_form_json"]` is rendered.
   - In [`services.py`](./services.py), `enhanceA2uiMaps()` loads the **Google Maps JavaScript API** (`google.maps.Map`, `google.maps.Marker`, `google.maps.Circle`, and `google.maps.Geocoder`) inside the A2UI card:
     - **Click anywhere on the map**: Clicking any point on the map moves the starting point marker and shaded `km` circle to that coordinate and reverse-geocodes the clicked address into the editable Starting Location input field.
     - **Edit the Starting Location text field**: Pressing Enter or clicking **Locate Typed Address on Map** geocodes the typed address and pans the marker and radius circle.
     - **Change the Search Radius (km) dropdown**: Dynamically resizes the `google.maps.Circle` (`radiusKm * 1000` meters) and fits the map zoom to the selected radius.
3. **Radius-Scoped Google Maps Places Search with Background Preferences (`search_restaurants_on_google_maps` in `app/tools.py`)**:
   - Clicking **🔍 Search Restaurants Within Radius** submits the starting location, `(latitude, longitude)`, and `radius_km` to the agent.
   - `search_restaurants_on_google_maps` automatically loads the user's saved preferences (`preferred_food_type`, `allergies`, `preferred_price_range`) in the background from the remote **Agent Runtime Memory Bank**, queries `https://places.googleapis.com/v1/places:searchText` with `locationBias.circle` (`center: {latitude, longitude}`, `radius: radius_km * 1000`), computes the exact Haversine distance (`distance_km`) from the starting point to each restaurant, filters to restaurants within `radius_km`, and prioritizes restaurants matching the user's budget and preferences.

### Official Documentation
- [Google Maps JavaScript API — Shapes & Circles (`google.maps.Circle`)](https://developers.google.com/maps/documentation/javascript/examples/circle-simple)
- [Google Maps Geocoding API Overview](https://developers.google.com/maps/documentation/geocoding/overview)
- [Google Maps Places API (New) — Text Search & `locationBias`](https://developers.google.com/maps/documentation/places/web-service/text-search#location-bias)
- [ADK — A2UI (Agent-to-UI) Integration Guide](https://adk.dev/integrations/a2ui/)

---

## Step 12: Show Search Results on Google Maps in A2UI with a Side Restaurant List, Stars, and Interactive Details Panel

### Goal
Once the restaurant search is executed, display the search results inside an interactive **A2UI Google Maps Results Explorer** featuring:
1. **Google Map with Pin Drops (Left)**: Displays the starting point, the search radius circle, and numbered pin drops (`1`..`N`) for every restaurant found.
2. **Restaurant List with Stars (Right — Top)**: Lists all found restaurants alongside the map with their star ratings (`4.9 ★★★★★`), review counts, distance in km, and price level.
3. **Interactive Restaurant Details Panel (Right — Bottom, Next to Google Maps)**: Clicking any **pin drop on the Google Map** or any **restaurant name in the list** highlights that restaurant and displays its full details (name, open/closed status, stars & reviews, distance, cuisine type, summary, address, and direct Google Maps / Website links) right next to the map.

### Prompt to Run in `agy`
Copy and paste the following prompt into the Antigravity CLI:

```text
Once the search is executed, show the search results in google maps in A2UI along with restaurant list and number of stars on the side of the map and once you click the pin drops or the name of the restaurant in the list, the details about that particular restaurant should be visible in A2UI interface, next to google maps.
```

### What Is Happening Under the Hood?
1. **Automatic A2UI Results Explorer Attachment (`search_restaurants_on_google_maps` in `app/tools.py`)**:
   - When `search_restaurants_on_google_maps(...)` finishes querying the Google Maps Places API (`places:searchText`), it calls `build_restaurant_results_map_a2ui_payload(starting_point, radius_km, restaurants)` and stores the A2UI surface (`surfaceId: "map_results_surface"`, `root: "results-explorer-card"`) in `tool_context.state["temp:a2ui_form_json"]`.
   - `inject_a2ui_form_callback` in [`app/agent.py`](./app/agent.py) automatically appends the `<a2ui-json>...</a2ui-json>` block to the agent's final response.
2. **Side-by-Side Map, Star-Rated Restaurant List & Details View (`enhanceA2uiResultsExplorers` in `services.py`)**:
   - In [`services.py`](./services.py) (`ADK_A2UI_FORM_BRIDGE_V5`), `enhanceA2uiResultsExplorers()` decodes the base64-encoded restaurant list (`@@ADK_GOOGLE_MAP_RESULTS@@<base64>@@`) and renders a two-column layout (`max-width: 980px`) inside the A2UI card:
     - **Left Column (`.adk-results-map-col`)**: Mounts a `google.maps.Map` with the starting point marker, the `km` radius circle, and numbered `google.maps.Marker` pin drops (`1`..`N`) for each restaurant.
     - **Right Column — Top (`.adk-results-list-box`)**: Renders the scrollable restaurant list with numbered badges, restaurant names, numeric star ratings + visual gold stars (`★★★★★`), review counts, distance (`km`), and price levels.
     - **Right Column — Bottom (`.adk-results-detail-card`, next to the Google Map)**: Renders the full details of the selected restaurant. Clicking **any pin drop on the map** (`marker.addListener("click", ...)`) or **any restaurant row in the list** (`row.addEventListener("click", ...)`) calls `selectRestaurant(idx, true)`, which pans the map, opens the marker's `InfoWindow`, highlights the list item, and updates the details panel next to the map!

### Official Documentation
- [Google Maps JavaScript API — Markers & InfoWindows](https://developers.google.com/maps/documentation/javascript/markers)
- [Google Maps Places API (New) — Place Details & Fields](https://developers.google.com/maps/documentation/places/web-service/place-details)
- [ADK — A2UI (Agent-to-UI) Integration Guide](https://adk.dev/integrations/a2ui/)

---

## Step 13: End-to-End Testing Walkthrough & Troubleshooting Guide

### 1. End-to-End Interactive Testing in `adk web`
Make sure your ADK Web UI server is running in a terminal:
```bash
cd ~/advancedagents
source /home/user/advancedagents/.venv/bin/activate
adk web --allow_origins "*"
```
Open `http://127.0.0.1:8000` in your browser (use **`Ctrl+Shift+R`** / **`Cmd+Shift+R`** to ensure the latest A2UI bridge is loaded) and walk through the three stages:

1. **Stage 1 — Initial-Fill Dining Preferences Form (First-Time User)**:
   - When no preferences exist yet in Memory Bank, type `hi`.
   - The agent displays the **A2UI Dining Preferences & Memory Profile** form.
   - Enter your **Name** (e.g., `Haren`), **Preferred Food Type** (e.g., `Ramen, Wagyu`), **Allergies** (e.g., `Peanuts`), and **Preferred Price Range** (e.g., `$$ (Moderate)`), then click **Save Preferences to Memory**.
   - Verify in the **Google Cloud Console → Vertex AI → Agent Engine → `advancedagents-session-memory-backend` → Memory Bank** tab that all four topic-tagged memories (`name`, `preferred_food_type`, `allergies`, `preferred_price_range`) are persisted.
2. **Stage 2 — Interactive Google Maps Location & Radius (km) Picker**:
   - Click **+ New Session** in `adk web` and type:
     ```text
     I am looking for restaurants around Shibuya area.
     ```
   - Notice that your preferences are **not** re-displayed (they are now kept silently in the background).
   - Instead, the **A2UI Select Starting Point & Search Radius** card renders with an interactive **Google Map** centered on Shibuya (`35.6620, 139.7038`) and a shaded `2 km` radius circle.
   - Click **any location on the Google Map** to move the starting point pin and reverse-geocode the clicked coordinate into the editable **Approximate Starting Location** box.
   - Choose a search radius (e.g., `1 km` or `2 km`) from the **Search Radius (km)** dropdown and watch the blue circle resize on the map.
   - Click **🔍 Search Restaurants Within Radius**.
3. **Stage 3 — Side-by-Side Google Maps Results Explorer**:
   - Once the search completes, the **A2UI Restaurants Results Explorer** card renders side-by-side:
     - **Left**: Interactive Google Map with numbered pin drops (`1`..`N`) inside your chosen `km` radius.
     - **Right (Top)**: Scrollable list of restaurants matching your background preferences (`Ramen, Wagyu`, `$$ (Moderate)`, peanut-allergy aware) with star ratings (`4.9 ★★★★★`) and distance in `km`.
     - **Right (Bottom — Next to Google Maps)**: Full details panel for the selected restaurant.
   - Click **any numbered pin drop on the Google Map** OR **any restaurant name in the list** to pan the map and inspect that restaurant's rating, summary, address, and direct Google Maps / Website links right next to the map.

### 2. Redeploying the Final Agent to Agent Runtime
After completing all A2UI enhancements in Steps 10–12, you can redeploy the updated agent container to Vertex AI Agent Runtime at any time by prompting `agy` with `Deploy this agent to agent runtime.` or running:
```bash
agents-cli deploy \
  --project $GOOGLE_CLOUD_PROJECT \
  --region us-central1 \
  --service-name advancedagents-session-memory-backend \
  --no-confirm-project
```

### 3. Key Engineering Takeaways & Troubleshooting

| Symptom / Challenge | Root Cause | Solution Implemented in This Codelab |
| :--- | :--- | :--- |
| **`google_search` fails when mixed with custom Python tools** | Gemini's built-in `google_search` grounding tool cannot be combined in the same `tools=[...]` array with custom `FunctionTool`s under Automatic Function Calling (AFC). | Wrap a dedicated `google_search_agent` inside `AgentTool(agent=google_search_agent)` on `root_agent` ([`app/agent.py`](./app/agent.py)). |
| **`adk web` uses local `.adk/session.db` instead of remote Agent Runtime sessions** | `adk web` defaults to local SQLite storage unless overridden at startup. | Set `ADK_DISABLE_LOCAL_STORAGE=1` and add a root [`services.py`](./services.py) module that routes `create_session_service_from_options` and `create_memory_service_from_options` to `SESSION_SERVICE_URI` and `MEMORY_SERVICE_URI`. |
| **A2UI `<a2ui-button>` renders blank or does nothing on click** | `@a2ui/angular` omits `--n-100`..`--n-0` CSS variables on `<a2ui-surface>` (causing button text to inherit the button's background color `--p-30`/`--p-70`) and does not wire `A2uiMessageProcessor.dispatch` to `app-chat.sendMessage`. | `_ensure_a2ui_button_action_bridge()` in [`services.py`](./services.py) defines `--n-*` variables, forces `#ffffff` on `#1a73e8` button contrast, and connects button clicks directly to `app-chat.sendMessage(...)`. |
| **Background `add_session_to_memory()` leaves Memory Bank empty** | Server-side LLM memory extraction (`memories.generate`) runs as the Reasoning Engine service agent (`service-<PROJECT_NUMBER>@gcp-sa-aiplatform-re.iam.gserviceaccount.com`), which may lack `aiplatform.endpoints.predict` IAM permissions in restricted projects. | `_persist_preferences_to_memory_bank()` in [`app/tools.py`](./app/tools.py) calls `client.agent_engines.memories.create(..., wait_for_completion=True)` with explicit `MemoryTopicId`s under application credentials. |
| **Map widget fails to render on subsequent turns** | The LLM sees `<a2ui-json>` in earlier conversation turns and hallucinates its own `<a2ui-json>` block with fake component names (e.g., `"GoogleMapPicker"`). | `inject_a2ui_form_callback` in [`app/agent.py`](./app/agent.py) strips any LLM-written `<a2ui-json>` blocks via regex before appending the verified payload from `tool_context.state["temp:a2ui_form_json"]`. |

---

## Step 14: Create Project Agent Skills for Smooth Codelab Execution (`.agents/skills/`)

### Goal
Package all of the project's specialized runbooks, SDK workarounds, and A2UI frontend bridges into reusable **Antigravity Agent Skills** inside [`.agents/skills/`](./.agents/skills/) so that when lab participants execute the prompts in this codelab, `agy` activates the matching skill automatically and completes each step cleanly on the first try without needing follow-up corrective prompts.

### Prompt to Run in `agy`
```text
Create new Agent Skills for this project so that when the lab audience executes this lab things , especially the prompts run smoothly without too much re prompting.
```

### What Happens Under the Hood
1. **Antigravity Skill Discovery (`.agents/skills/<skill-name>/SKILL.md`)**:
   - In the Antigravity Customization System, workspace skills located in `.agents/skills/` have **Priority 1 (Highest)** loading precedence and use **progressive disclosure**: `agy` reads each skill's YAML frontmatter (`name` and `description`) at session start and automatically loads the full `SKILL.md` instructions whenever a user's prompt matches the skill's domain.
2. **Three Purpose-Built Project Skills Created**:
   - **[`.agents/skills/gcp-maps-api-setup/SKILL.md`](./.agents/skills/gcp-maps-api-setup/SKILL.md)** (*Trigger: Step 3*):
     - Ensures `gcloud services enable` and `gcloud services api-keys create` always pass `--billing-project=$GOOGLE_CLOUD_PROJECT` alongside `--project=$GOOGLE_CLOUD_PROJECT` (avoiding ADC quota project `PERMISSION_DENIED` errors) and enables all 4 Maps/Places/Geocoding services (`maps-backend.googleapis.com`, `places.googleapis.com`, `places-backend.googleapis.com`, `geocoding-api.googleapis.com`).
   - **[`.agents/skills/adk-agent-runtime-memory-sessions/SKILL.md`](./.agents/skills/adk-agent-runtime-memory-sessions/SKILL.md)** (*Trigger: Steps 4, 5, 6, 7, 9, 10*):
     - Enforces importing `MemoryBankConfig`, `CustomMemoryTopic`, and `MemoryTopicId` from `agentplatform._genai.types` (preventing Pydantic validation errors from `vertexai._genai.types`).
     - Prevents adding reserved `GOOGLE_CLOUD_AGENT_ENGINE_*` variables to `.env` (which otherwise cause `agents-cli deploy` to fail with `400 FAILED_PRECONDITION`).
     - Separates `GOOGLE_CLOUD_LOCATION=global` (for `gemini-4-neon` with `load_dotenv(override=True)`) from `AGENT_ENGINE_LOCATION=us-central1`.
     - Provides the root [`services.py`](./services.py) pattern (`ADK_DISABLE_LOCAL_STORAGE=1`) so `adk web` uses remote `VertexAiSessionService` and `VertexAiMemoryBankService` immediately.
     - Instructs `save_user_preferences_to_memory` to write topic-tagged memories synchronously via `client.agent_engines.memories.create(..., wait_for_completion=True)` so memories appear immediately in the Gemini Agent Platform Memory Bank UI.
   - **[`.agents/skills/adk-a2ui-google-maps/SKILL.md`](./.agents/skills/adk-a2ui-google-maps/SKILL.md)** (*Trigger: Steps 6, 10, 11, 12*):
     - Wraps `google_search` inside `AgentTool(agent=google_search_agent)` so it coexists cleanly with custom Python `FunctionTool`s.
     - Enforces stripping LLM-hallucinated `<a2ui-json>` blocks via regex inside `inject_a2ui_form_callback` before appending `tool_context.state["temp:a2ui_form_json"]`.
     - Enforces initial-fill-only behavior for the preferences form (`status: "already_configured"` once saved) so preferences are never re-displayed on the map search card and are applied silently in the background.
     - Documents the `_ensure_a2ui_button_action_bridge()` patch in [`services.py`](./services.py) for `@a2ui/angular` (fixing `--n-100`..`--n-0` CSS variables and `#1a73e8`/`#ffffff` button contrast, passing `this.surfaceId()` in `MultipleChoice.handleChange`, and wiring button clicks to `window.__adkChatInstance.sendMessage`), as well as Markdown-safe tokens (`@@ADK_GOOGLE_MAP@@` and `@@ADK_GOOGLE_MAP_RESULTS@@`) and sibling DOM mounting inside `<a2ui-text>` for the interactive Google Maps picker and side-by-side Results Explorer.
3. **Referenced in [`GEMINI.md`](./GEMINI.md) & Global Skills Directory (`~/.gemini/skills/`)**:
   - Linked in Section 3 of [`GEMINI.md`](./GEMINI.md) and symlinked into `~/.gemini/skills/` so both workspace-level and user-level `agy` invocations discover them automatically.
4. **Exporting Skills for Publishing (`agentskills/`)**:
   If you want to publish these skills in a top-level `agentskills/` folder for distribution to lab attendees or a shared skills repository, run:
   ```text
   I need to publish the skills so put the skills in agentskills folder
   ```
   This copies all three skill directories into [`agentskills/`](./agentskills/):
   - [`agentskills/gcp-maps-api-setup/SKILL.md`](./agentskills/gcp-maps-api-setup/SKILL.md)
   - [`agentskills/adk-agent-runtime-memory-sessions/SKILL.md`](./agentskills/adk-agent-runtime-memory-sessions/SKILL.md)
   - [`agentskills/adk-a2ui-google-maps/SKILL.md`](./agentskills/adk-a2ui-google-maps/SKILL.md)

### Official Documentation
- [Antigravity Documentation — Agent Skills](https://antigravity.google/docs/skills)
- [Antigravity Documentation — Rules & Customizations](https://antigravity.google/docs/rules-workflows)
