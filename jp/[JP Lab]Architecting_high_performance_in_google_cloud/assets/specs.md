# Project Specifications & Change Log

This document serves as the central specification and chronological change log for the `advancedagents` workspace. All tasks and modifications made in this repository are recorded here.

---

## Current Specifications

- **Change Tracking Enforcement (`specs.md`)**: Configured via [`GEMINI.md`](./GEMINI.md) at the workspace root so that the agent automatically records all changes and updates specifications in `specs.md` for every task.
- **Living Codelab Guide (`codelab.md`)**: Configured via [`GEMINI.md`](./GEMINI.md) so that every task and user prompt is documented step-by-step in [`codelab.md`](./codelab.md), complete with the exact user prompt for the Antigravity CLI (`agy`), an explanation of what happens under the hood, and links to official documentation.
- **Project Agent Skills (`.agents/skills/`, `agentskills/`, & `~/.gemini/skills/`)**:
  - Publishable copies are stored in [`agentskills/`](./agentskills/) alongside the workspace-discovered copies in [`.agents/skills/`](./.agents/skills/).
  - [`gcp-maps-api-setup`](./agentskills/gcp-maps-api-setup/SKILL.md): Runbook for enabling Google Maps Platform APIs (`maps-backend`, `places`, `places-backend`, `geocoding-api`) and creating a restricted API key using `--billing-project=$GOOGLE_CLOUD_PROJECT`.
  - [`adk-agent-runtime-memory-sessions`](./.agents/skills/adk-agent-runtime-memory-sessions/SKILL.md): Runbook for provisioning Vertex AI Agent Runtime (`ReasoningEngine`) sessions & Memory Bank using `agentplatform._genai.types`, avoiding reserved `GOOGLE_CLOUD_AGENT_ENGINE_*` env vars, separating `GOOGLE_CLOUD_LOCATION=global` (`gemini-4-neon`) from `AGENT_ENGINE_LOCATION=us-central1`, enforcing remote sessions in `adk web` via [`services.py`](./services.py), and persisting topic-tagged memories synchronously via `client.agent_engines.memories.create`.
  - [`adk-a2ui-google-maps`](./.agents/skills/adk-a2ui-google-maps/SKILL.md): Runbook for building the ADK restaurant finder agent (`AgentTool(google_search_agent)`) and the three interactive A2UI (`<a2ui-json>`) components in `adk web` (regex-stripping LLM-hallucinated `<a2ui-json>` blocks in `inject_a2ui_form_callback`, initial-fill-only preferences form, `@a2ui/angular` button contrast / `MultipleChoice` / `sendMessage` bridge, clickable Google Maps location & `km` radius picker, and side-by-side Google Maps search results explorer with pin drops, stars, and restaurant details panel).
- **Google Maps Platform Integration**:
  - **GCP Project**: `haren-main` (`us-central1`)
  - **Enabled APIs**:
    - `apikeys.googleapis.com` (API Keys API)
    - `maps-backend.googleapis.com` (Maps JavaScript API)
    - `places.googleapis.com` (Places API (New))
    - `places-backend.googleapis.com` (Places API)
    - `geocoding-backend.googleapis.com` (Geocoding API)
    - `routes.googleapis.com` (Routes API)
    - `directions-backend.googleapis.com` (Directions API)
    - `distance-matrix-backend.googleapis.com` (Distance Matrix API)
    - `static-maps-backend.googleapis.com` (Maps Static API)
  - **Provisioned API Key**: `Advanced Agents Codelab Maps Key` (UID: `a59ce08c-fede-463b-872f-af58e2fdec43`), restricted to the above Maps Platform services and stored in [`.env`](./.env) under `GOOGLE_MAPS_API_KEY`.
- **Agent Runtime Session, Memory & Deployed Agent Backend**:
  - **Display Name**: `advancedagents-session-memory-backend`
  - **Location**: `us-central1`
  - **Resource Name**: `projects/78833623456/locations/us-central1/reasoningEngines/3114911218809176064`
  - **Agent Engine ID**: `3114911218809176064`
  - **Session & Memory Service URI**: `agentengine://projects/78833623456/locations/us-central1/reasoningEngines/3114911218809176064`
  - **Memory Bank Managed Topics**: `USER_PERSONAL_INFO`, `USER_PREFERENCES`, `KEY_CONVERSATION_DETAILS`, `EXPLICIT_INSTRUCTIONS`
  - **Memory Bank Custom Topics (`CustomMemoryTopic`)**: `preferred_food_type`, `allergies`, `preferred_price_range`, `name`
  - **Provisioning Script**: [`scripts/provision_memory_backend.py`](./scripts/provision_memory_backend.py)
  - **Deployment Target**: Deployed container-based ADK agent via `agents-cli deploy --project haren-main --region us-central1 --service-name advancedagents-session-memory-backend`.
- **ADK Restaurant Finder Agent (`restaurant-finder`)**:
  - **Framework & Model**: Google Agent Development Kit (`google-adk`), main model **`gemini-4-neon`** (`MODEL_NAME=gemini-4-neon`, `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_LOCATION=global`, `AGENT_ENGINE_LOCATION=us-central1`).
  - **Python Virtual Environment & Local Web UI Testing**:
    - Virtual environment at `/home/user/advancedagents/.venv` (Python 3.12.3).
    - Interactive testing via `cd ~/advancedagents && source /home/user/advancedagents/.venv/bin/activate && adk web --allow_origins "*"`.
  - **Root Agent (`restaurant_finder` in [`app/agent.py`](./app/agent.py))**:
    - Uses `AgentTool(agent=google_search_agent)` to perform Google Search grounding (`google_search`) for local dining guides, popular restaurants, and culinary context without disabling Automatic Function Calling on custom tools.
    - Uses `search_restaurants_on_google_maps` ([`app/tools.py`](./app/tools.py)) to query the Google Maps Places API (New) (`https://places.googleapis.com/v1/places:searchText`) using `GOOGLE_MAPS_API_KEY`, `locationBias.circle` (`latitude`, `longitude`, `radius_km * 1000`), and Haversine distance (`distance_km`) filtering, returning verified restaurant names, distances in km from the starting point, addresses, ratings, review counts, price levels (`$ / $$ / $$$ / $$$$`), budget match flags, open status, and Google Maps URLs, and **automatically attaches the A2UI Interactive Google Maps Results Explorer** (`build_restaurant_results_map_a2ui_payload` on `map_results_surface`).
    - Uses **A2UI Interactive Google Maps Results Explorer** (`build_restaurant_results_map_a2ui_payload` in [`app/tools.py`](./app/tools.py) + `enhanceA2uiResultsExplorers()` in [`services.py`](./services.py)): once the search is executed, displays a side-by-side A2UI card with:
      1. **Left**: An interactive Google Map showing the starting point, `km` radius circle, and numbered pin drops (`1`..`N`) for every restaurant.
      2. **Right (Top)**: A scrollable restaurant list showing each restaurant's name, star rating (`4.9 ★★★★★`), review count, distance in km, and price level.
      3. **Right (Bottom — Next to Google Maps)**: A live restaurant details panel that updates whenever the user clicks any **pin drop on the map** or any **restaurant name in the list**, displaying full details (name, open/closed badge, stars & reviews, price level, distance in km, cuisine type, editorial summary, address, and direct Google Maps / Website links).
    - Uses **A2UI Interactive Google Maps Location & Radius Search UI** (`render_restaurant_search_map_form` + `build_restaurant_search_map_a2ui_payload` in [`app/tools.py`](./app/tools.py)) when the user begins a restaurant search: geocodes the approximate location via the Google Maps Geocoding API, embeds an interactive Google Map (`google.maps.Map` + clickable/draggable `Marker` + dynamic `Circle` radius in km) where clicking any location sets the starting point, provides ONLY the editable starting location field and km radius dropdown (`0.5 km`, `1 km`, `2 km`, `3 km`, `5 km`, `10 km`) without displaying user preference fields, and applies the user's saved preferences (`preferred_food_type`, `allergies`, `preferred_price_range`) silently in the background when executing `search_restaurants_on_google_maps`.
    - Uses **A2UI User Memory Form** (`render_user_preferences_form` + `save_user_preferences_to_memory` in [`app/tools.py`](./app/tools.py) and `inject_a2ui_form_callback` in [`app/agent.py`](./app/agent.py)) ONLY on initial fill (when preferences are not yet saved in Memory Bank): once filled, `render_user_preferences_form` skips re-displaying the form and keeps preferences in the background.
    - Uses `PreloadMemoryTool()` and `after_agent_callback=generate_memories_callback` (`callback_context.add_session_to_memory()`) to automatically recall and persist user preferences across sessions via the Agent Runtime Memory Bank backend.
  - **Remote Session & Memory Bank Enforcement ([`services.py`](./services.py), [`app/app_utils/services.py`](./app/app_utils/services.py), [`app/fast_api_app.py`](./app/fast_api_app.py), [`app/app_utils/reasoning_engine_adapter.py`](./app/app_utils/reasoning_engine_adapter.py))**:
    - Disables local SQLite storage (`ADK_DISABLE_LOCAL_STORAGE=1`, `use_local_storage=False`) and wires `VertexAiSessionService` and `VertexAiMemoryBankService` across `adk web`, `agents-cli run`, FastAPI, A2A, and `AdkApp` (`reasoning_engine_adapter.py`).

---

## Change History

### 2026-11-26 — Copy Agent Skills to `agentskills/` Folder for Publishing
- **Created [`agentskills/`](./agentskills/)**: Copied all three project Agent Skills into a top-level `agentskills/` directory ready for publishing:
  - [`agentskills/gcp-maps-api-setup/SKILL.md`](./agentskills/gcp-maps-api-setup/SKILL.md)
  - [`agentskills/adk-agent-runtime-memory-sessions/SKILL.md`](./agentskills/adk-agent-runtime-memory-sessions/SKILL.md)
  - [`agentskills/adk-a2ui-google-maps/SKILL.md`](./agentskills/adk-a2ui-google-maps/SKILL.md)
- **Modified [`codelab.md`](./codelab.md)**: Updated Step 14 to record the user prompt and document the publishable `agentskills/` folder.
- **Modified [`specs.md`](./specs.md)**: Updated Current Specifications and logged this change entry.

### 2026-11-26 — Create Project Agent Skills (`.agents/skills/`) for Smooth Codelab Execution
- **Created [`.agents/skills/gcp-maps-api-setup/SKILL.md`](./.agents/skills/gcp-maps-api-setup/SKILL.md)**: Added workspace Agent Skill for enabling Google Maps Platform APIs (`maps-backend`, `places`, `places-backend`, `geocoding-api`) and provisioning a restricted API key with `--billing-project=$GOOGLE_CLOUD_PROJECT` so Step 3 succeeds without ADC quota project permission errors.
- **Created [`.agents/skills/adk-agent-runtime-memory-sessions/SKILL.md`](./.agents/skills/adk-agent-runtime-memory-sessions/SKILL.md)**: Added workspace Agent Skill covering `agentplatform._genai.types` usage for `MemoryBankConfig` and `CustomMemoryTopic`, avoiding reserved `GOOGLE_CLOUD_AGENT_ENGINE_*` env vars in `.env`, separating `GOOGLE_CLOUD_LOCATION=global` (`gemini-4-neon`) from `AGENT_ENGINE_LOCATION=us-central1`, enforcing remote sessions in `adk web` via [`services.py`](./services.py), and persisting topic-tagged memories synchronously via `client.agent_engines.memories.create`.
- **Created [`.agents/skills/adk-a2ui-google-maps/SKILL.md`](./.agents/skills/adk-a2ui-google-maps/SKILL.md)**: Added workspace Agent Skill covering `AgentTool(google_search_agent)` wrapping, stripping LLM-hallucinated `<a2ui-json>` blocks in `inject_a2ui_form_callback`, initial-fill-only preferences form (`status: "already_configured"`), the `@a2ui/angular` button/select/action bridge in [`services.py`](./services.py), and Markdown-safe sibling DOM mounting (`@@ADK_GOOGLE_MAP@@` and `@@ADK_GOOGLE_MAP_RESULTS@@`) for the interactive Google Maps location/radius picker and side-by-side Results Explorer.
- **Symlinked Skills into `~/.gemini/skills/`**: Created symlinks in `/home/user/.gemini/skills/` so the skills are discovered in both workspace and user scopes.
- **Modified [`GEMINI.md`](./GEMINI.md)**: Added Section 3 referencing the three workspace skills in `.agents/skills/`.
- **Modified [`codelab.md`](./codelab.md)**: Updated Prerequisites and added Step 14 documenting the prompt, how the three Agent Skills eliminate re-prompting across the codelab, and official Antigravity Skills documentation links.
- **Modified [`specs.md`](./specs.md)**: Updated Current Specifications and logged this change entry.

### 2026-11-26 — Review and Enhance `codelab.md` with Architecture Diagram, Table of Contents, Iterative Prompts, and End-to-End Walkthrough
- **Modified [`codelab.md`](./codelab.md)**:
  - Added a **What You Will Build** summary, ASCII architecture diagram, and linked **Table of Contents** at the top of the guide.
  - Added `gcloud auth login` / `gcloud auth application-default login` prerequisites and replaced hardcoded project identifiers in CLI snippets with `$GOOGLE_CLOUD_PROJECT` / `<PROJECT_NUMBER>` placeholders so any user can run the commands in their own project.
  - Added the verbatim iterative refinement prompts in Steps 8, 10, and 11 (covering `.venv` activation, A2UI button fix, synchronous topic-tagged Memory Bank persistence, and keeping preferences in the background after initial fill).
  - Added **Step 13: End-to-End Testing Walkthrough & Troubleshooting Guide** covering the 3-stage interactive test flow in `adk web`, final redeployment to Agent Runtime, and a reference table of key engineering takeaways.
- **Modified [`specs.md`](./specs.md)**: Logged this review and enhancement entry.

### 2026-11-26 — Re-Activate Project Virtual Environment (`.venv`)
- **Verified `.venv` Activation**: Executed `source /home/user/advancedagents/.venv/bin/activate` and confirmed `/home/user/advancedagents/.venv/bin/python` (`Python 3.12.3`) and `/home/user/advancedagents/.venv/bin/adk` (`adk, version 2.8.0`).
- **Modified [`specs.md`](./specs.md)**: Logged this environment activation check.

### 2026-11-26 — Add A2UI Interactive Google Maps Search Results Explorer (Map Pins + Star-Rated List + Side Details Panel)
- **Modified [`app/tools.py`](./app/tools.py)**:
  - Added `build_restaurant_results_map_a2ui_payload(starting_point, radius_km, restaurants)` encoding the search results into a Markdown-safe `@@ADK_GOOGLE_MAP_RESULTS@@<base64>@@` widget on `map_results_surface`.
  - Updated `search_restaurants_on_google_maps` to accept `tool_context: ToolContext | None = None` and automatically populate `tool_context.state["temp:a2ui_form_json"]` with the A2UI Results Explorer whenever search results are returned.
- **Modified [`app/agent.py`](./app/agent.py)**:
  - Updated Section 3 of `root_agent` instructions so the agent knows `search_restaurants_on_google_maps` automatically attaches the A2UI Results Explorer and keeps the text intro brief.
- **Modified [`services.py`](./services.py)**:
  - Upgraded to `ADK_A2UI_FORM_BRIDGE_V5` with `enhanceA2uiResultsExplorers()`, which renders a side-by-side A2UI layout (`max-width: 980px`):
    - **Left**: Interactive Google Map with starting point, radius circle, and numbered restaurant pin drops (`1`..`N`).
    - **Right**: Scrollable restaurant list with star ratings (`★` + visual `★★★★★`) and review counts on top, and a live Restaurant Details card right below it (next to the map) that updates whenever a map pin drop or restaurant name in the list is clicked.
- **Modified [`tests/unit/test_dummy.py`](./tests/unit/test_dummy.py)**: Added `test_a2ui_restaurant_results_map_payload`.
- **Modified [`codelab.md`](./codelab.md) & [`specs.md`](./specs.md)**: Added Step 12 to `codelab.md` and logged this change entry.

### 2026-11-26 — Fix Map Rendering in A2UI Search Card and Keep Saved Preferences in Background After Initial Fill
- **Root Cause Analysis**:
  1. **Why the Map Was Not Displayed**: In session `6790290621497081856`, the LLM imitated the `<a2ui-json>` tag from Turn 1 and emitted its own hallucinated `<a2ui-json>` block containing a non-existent `"GoogleMapPicker"` component, and `inject_a2ui_form_callback` skipped replacing it because `if "<a2ui-json>" in part.text: return None` returned early. Additionally, markdown characters (`_`, `[`, `|`) in the map token could be altered by `markdown-it`.
  2. **Why Preferences Were Displayed**: `build_restaurant_search_map_a2ui_payload` included preference fields (`search-food-type-field`, `search-allergies-field`, `search-price-range-field`) and `render_user_preferences_form` rendered even after preferences were already saved in Memory Bank.
- **Modified [`app/agent.py`](./app/agent.py)**:
  - Updated `inject_a2ui_form_callback` to always strip any LLM-hallucinated `<a2ui-json>...</a2ui-json>` blocks before injecting the verified tool payload from `callback_context.state["temp:a2ui_form_json"]`.
  - Updated `root_agent` instructions so preferences are never displayed or repeated after initial fill and are used silently in the background.
- **Modified [`app/tools.py`](./app/tools.py)**:
  - Updated `render_user_preferences_form` to check Memory Bank first and skip rendering (`status: "already_configured"`) once initial fill is complete.
  - Removed all preference fields from `build_restaurant_search_map_a2ui_payload` so the Map Search UI displays ONLY the interactive Google Map (`@@ADK_GOOGLE_MAP@@...@@`), the editable approximate starting location, the km radius dropdown, and the search button on a dedicated `map_search_surface`.
  - Updated `search_restaurants_on_google_maps` to automatically load and apply the user's saved preferences (`preferred_food_type`, `allergies`, `preferred_price_range`) silently in the background from Memory Bank.
- **Modified [`services.py`](./services.py)**:
  - Upgraded to `ADK_A2UI_FORM_BRIDGE_V4`: embedded `GOOGLE_MAPS_API_KEY` directly in `index.html`, parsed `@@ADK_GOOGLE_MAP@@...@@`, hid `<section>` inside `<a2ui-text>` while appending `.adk-gmap-wrapper` as a sibling so Angular change detection never overwrites the live Google Map, and simplified map submission to send only starting location, coordinates, and km radius.
- **Modified [`tests/unit/test_dummy.py`](./tests/unit/test_dummy.py)**: Verified preference fields are excluded from `build_restaurant_search_map_a2ui_payload`.
- **Modified [`codelab.md`](./codelab.md) & [`specs.md`](./specs.md)**: Updated Step 11 and specifications.

### 2026-11-26 — Add A2UI Interactive Google Maps Location & Radius (km) Search Component
- **Modified [`app/tools.py`](./app/tools.py)**:
  - Added `geocode_location(location_query)`, `_haversine_distance_km(...)`, `_load_preferences_from_memory_bank(...)`, `build_restaurant_search_map_a2ui_payload(...)`, and `render_restaurant_search_map_form(...)`.
  - Upgraded `search_restaurants_on_google_maps(...)` to accept `latitude`, `longitude`, `radius_km`, and `preferred_price_range`, query Google Maps Places API (`places:searchText`) with `locationBias.circle` (`radius_km * 1000` meters) and `places.location`, calculate exact `distance_km` from the starting point, filter to restaurants within `radius_km`, and prioritize matches for the user's budget (`preferred_price_range`).
- **Modified [`app/agent.py`](./app/agent.py)**:
  - Registered `render_restaurant_search_map_form` on `root_agent` and updated instructions so that beginning a restaurant search displays the A2UI Google Maps Location & Radius UI first, and submitting the map UI executes the radius-scoped search with the user's budget and preferences.
- **Modified [`services.py`](./services.py)**:
  - Upgraded `ADK_A2UI_FORM_BRIDGE_V3` in `index.html` with `enhanceA2uiMaps()`, which mounts an interactive Google Map (`google.maps.Map`, `google.maps.Marker`, `google.maps.Circle`, and `google.maps.Geocoder`) inside the A2UI card where clicking any location on the map moves the starting point marker/circle and reverse-geocodes into the editable location field, changing the km dropdown resizes the map radius circle, and clicking **Search Restaurants Within Radius** submits the exact coordinates, km radius, budget, and preferences to the agent.
- **Modified [`tests/unit/test_dummy.py`](./tests/unit/test_dummy.py)**: Added `test_a2ui_restaurant_search_map_payload` and verified `render_restaurant_search_map_form` wiring.
- **Modified [`codelab.md`](./codelab.md)**: Added Step 11 documenting the prompt, interactive A2UI Google Maps + radius search architecture, and official documentation links.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-26 — Persist Topic-Tagged Memories Directly to Agent Runtime Memory Bank in `save_user_preferences_to_memory`
- **Root Cause Analysis**:
  - Previously, `save_user_preferences_to_memory` only updated `tool_context.state["user:preferences"]` and relied on `generate_memories_callback` (`callback_context.add_session_to_memory()`), which triggered `memories.ingest_events` in the background. On the GCP backend, server-side LLM extraction (`memories.generate`) runs as the Reasoning Engine service agent (`service-78833623456@gcp-sa-aiplatform-re.iam.gserviceaccount.com`), which lacked `aiplatform.endpoints.predict` and `aiplatform.sessionEvents.list` IAM bindings on `haren-main` and failed silently in the background task.
- **Modified [`app/tools.py`](./app/tools.py)**:
  - Added `_persist_preferences_to_memory_bank(profile, app_name, user_id)` and wired it into `save_user_preferences_to_memory`.
  - Uses `agentplatform.Client.agent_engines.memories.create` with `wait_for_completion=True` and explicit `MemoryTopicId(custom_memory_topic_label=...)` + `MemoryTopicId(managed_memory_topic=...)` tags to synchronously write all four memories (`name`, `preferred_food_type`, `allergies`, `preferred_price_range`) directly into `projects/78833623456/locations/us-central1/reasoningEngines/3114911218809176064` (cleaning up any prior entries for the same scope/topic first so updates are idempotent).
  - Backfilled the user's preferences from session `8628181481929310208` (`Name: Haren`, `Preferred food type: Japanese, Sushi, Wagyu`, `Allergies: Peanuts`, `Preferred price range: $$ (Moderate)`) and verified both `memories.list()` and `PreloadMemoryTool` (`search_memory`) retrieval.
- **Modified [`codelab.md`](./codelab.md)**: Updated Step 10 to document direct topic-tagged Memory Bank persistence via `agent_engines.memories.create`.
- **Modified [`specs.md`](./specs.md)**: Logged this change entry.

### 2026-11-25 — Re-Activate Project Virtual Environment (`.venv`)
- **Verified `.venv` Activation**: Executed `source /home/user/advancedagents/.venv/bin/activate` and confirmed `/home/user/advancedagents/.venv/bin/python` (`Python 3.12.3`) and `/home/user/advancedagents/.venv/bin/adk` (`adk, version 2.8.0`).
- **Modified [`specs.md`](./specs.md)**: Logged this environment activation check.

### 2026-11-25 — Fix A2UI Web Form Button Visibility and Click Submission in `adk web`
- **Root Cause Analysis**:
  1. **Blank Button**: In `@a2ui/angular` (`chunk-2SRK2U7X.js`), `a2ui-surface` (`BG`) only defined `--p-100`..`--p-5` (and had a typo `r["--0"]="#00000"`) without defining `--n-100`..`--n-0`. Because `--n-100` and `--n-40` were undefined, `<p class="color-c-n60">` (`color: light-dark(var(--n-60), var(--n-40))`) inside `<a2ui-button>` was invalid at computed-value time and inherited `color` from `<section class="color-c-p30">` (`light-dark(var(--p-30), var(--p-70))`), which matched `<button class="color-bgc-p30">` (`background-color: light-dark(var(--p-30), var(--p-70))`) bit-for-bit, rendering the button label invisible.
  2. **Non-Functioning Click Action**: `MultipleChoice.handleChange` (`chunk-BPUQWVAT.js`) omitted `this.surfaceId()` when calling `this.processor.setData(...)`, and synthetic DOM `input` events on `textarea.chat-input-box` did not trigger Angular's `app-chat.sendMessage(...)` pipeline.
- **Modified [`services.py`](./services.py)**: Upgraded `_ensure_a2ui_button_action_bridge()` to:
  - Define `--p-0` and `--n-100`..`--n-0` palette variables on `a2ui-surface` (`chunk-2SRK2U7X.js`), explicit white-on-blue (`#ffffff` on `#1a73e8`) button styles on `a2ui-button` (`chunk-Q6H4XMU7.js`) and `Hce.additionalStyles.Button` (`main-KSQARI5D.js`), and form/button styles in `index.html`.
  - Pass `this.surfaceId()` in `MultipleChoice.handleChange` (`chunk-BPUQWVAT.js`).
  - Expose `window.__adkChatInstance` on `app-chat` (`main-KSQARI5D.js`) and register `window.__adkSubmitPreferencesFromA2ui` in `index.html`, `chunk-2SRK2U7X.js`, and `chunk-Q6H4XMU7.js` so clicking **Save Preferences to Memory** reads the live form inputs/dropdown, updates the button state to `"✓ Saving Preferences to Memory..."`, and directly invokes `app-chat.sendMessage({role: "user", parts: [{text: msg}]})`.
- **Modified [`app/tools.py`](./app/tools.py)**: Placed `"submit-button-text"` (`usageHint: "body"`) prior to `"submit-button"` in `build_user_preferences_a2ui_payload`.
- **Modified [`codelab.md`](./codelab.md)**: Refined Step 10 with the button visibility & click-bridge architecture details.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Add A2UI Web Form Component for Collecting User Memory Topics
- **Modified [`app/tools.py`](./app/tools.py)**: Added `build_user_preferences_a2ui_payload`, `render_user_preferences_form`, and `save_user_preferences_to_memory` to build and handle an interactive A2UI v0.8 web form (`Card`, `Column`, `Text`, `Divider`, `TextField`s for `Name`, `Preferred Food Type`, `Allergies`, `MultipleChoice` for `Preferred Price Range`, and `Button` to submit).
- **Modified [`app/agent.py`](./app/agent.py)**: Added `inject_a2ui_form_callback` (`after_model_callback`) to deterministically attach `<a2ui-json>...</a2ui-json>` blocks to final agent responses when `render_user_preferences_form` is invoked, and registered `render_user_preferences_form` and `save_user_preferences_to_memory` on `root_agent`.
- **Modified [`services.py`](./services.py)**: Added `_ensure_a2ui_button_action_bridge()` so clicking the A2UI form's "Save Preferences to Memory" button in `adk web` dispatches the form fields directly into the chat conversation.
- **Modified [`tests/unit/test_dummy.py`](./tests/unit/test_dummy.py)**: Added unit test coverage for `build_user_preferences_a2ui_payload`, `render_user_preferences_form`, and `save_user_preferences_to_memory`.
- **Modified [`codelab.md`](./codelab.md)**: Added Step 10 documenting the prompt, A2UI component architecture, and official A2UI/ADK documentation links.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Deploy ADK Agent to Agent Runtime (`advancedagents-session-memory-backend`)
- **Modified [`app/app_utils/reasoning_engine_adapter.py`](./app/app_utils/reasoning_engine_adapter.py)**: Added `memory_service_builder=services.get_memory_service` to `AdkApp(...)` so Console Playground `:streamQuery` invocations also use the remote Memory Bank.
- **Modified [`.env`](./.env) & [`scripts/provision_memory_backend.py`](./scripts/provision_memory_backend.py)**: Removed reserved `GOOGLE_CLOUD_AGENT_ENGINE_*` env keys from `.env` (which Agent Runtime injects automatically and rejects in `deployment_spec.env`).
- **Executed Agent Runtime Deployment**: Ran `agents-cli deploy --project haren-main --region us-central1 --service-name advancedagents-session-memory-backend --no-confirm-project` to build and deploy the containerized ADK agent onto `projects/78833623456/locations/us-central1/reasoningEngines/3114911218809176064`.
- **Modified [`codelab.md`](./codelab.md)**: Added Step 9 documenting the deployment prompt, command, environment variable handling, and official documentation links.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Enforce Remote Agent Runtime Sessions Everywhere and Integrate into Step 6 Prompt
- **Modified [`app/app_utils/services.py`](./app/app_utils/services.py) & [`services.py`](./services.py)**: Removed `USE_IN_MEMORY_SESSION` fallback and enforced `ADK_DISABLE_LOCAL_STORAGE=1` and `use_local_storage=False` so that both `adk web --allow_origins "*"` and `agents-cli run` always create and use remote sessions (`VertexAiSessionService`) on the provisioned Agent Runtime backend (`projects/78833623456/locations/us-central1/reasoningEngines/3114911218809176064`).
- **Modified [`.env`](./.env)**: Added `ADK_DISABLE_LOCAL_STORAGE=1`.
- **Deleted `app/.adk/`**: Removed the local SQLite session directory (`app/.adk/session.db`) and stopped the stale `adk web` process that had been started before `services.py` existed.
- **Modified [`codelab.md`](./codelab.md)**: Integrated the remote session requirement directly into the Step 6 prompt (*"Create an ADK Agent that can take user input like “Find me restaurants near shibuya”, then do google search and look at google maps and find the restaurants near shibuya. I want the agent to use remote session that was created not local session."*) and updated the architectural explanation.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Refine Codelab with `adk web --allow_origins "*"` Testing Workflow and Root `services.py` Hook
- **Created [`services.py`](./services.py)**: Added root ADK service registration module automatically loaded by `adk web` (`load_services_module(agents_dir)`) so that running `adk web --allow_origins "*"` from `~/advancedagents` automatically connects to the Agent Runtime Session and Memory Bank backend defined in `.env`.
- **Modified [`codelab.md`](./codelab.md)**: Refined Step 8 to provide a unified, step-by-step user testing guide (`cd ~/advancedagents`, `source /home/user/advancedagents/.venv/bin/activate`, `adk web --allow_origins "*"`) along with sample multi-session prompts to test Memory Bank recall, Google Search grounding, and Google Maps Places lookup in the ADK Web UI.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Activate Project Virtual Environment (`.venv`) and Document in Codelab
- **Verified `.venv` Activation**: Executed `source /home/user/advancedagents/.venv/bin/activate` and verified `/home/user/advancedagents/.venv/bin/python` (Python 3.12.3) and `/home/user/advancedagents/.venv/bin/adk`.
- **Modified [`codelab.md`](./codelab.md)**: Added Step 8 documenting virtual environment activation (`source /home/user/advancedagents/.venv/bin/activate`) and how to run `adk` CLI commands directly inside the activated environment.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Configure `gemini-4-neon` as Main Model for the ADK Agent
- **Modified [`app/agent.py`](./app/agent.py)**: Updated default `MODEL` to `"gemini-4-neon"` (`os.environ.get("MODEL_NAME", "gemini-4-neon")`).
- **Modified [`.env`](./.env)**: Updated `MODEL_NAME=gemini-4-neon`.
- **Modified [`codelab.md`](./codelab.md)**: Refined Step 6 and added Step 7 documenting the prompt to switch the main model to `gemini-4-neon`, how to discover available Vertex AI Gemini models, and official documentation links.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Create ADK Restaurant Finder Agent with Google Search, Google Maps Places API, and Memory Bank
- **Scaffolded ADK Project Structure**: Added [`agents-cli-manifest.yaml`](./agents-cli-manifest.yaml), [`pyproject.toml`](./pyproject.toml), [`uv.lock`](./uv.lock), [`Dockerfile`](./Dockerfile), [`.gcloudignore`](./.gcloudignore), [`.env.example`](./.env.example), [`README.md`](./README.md), [`deployment/`](./deployment), and [`tests/`](./tests).
- **Created [`app/tools.py`](./app/tools.py)**: Implemented `search_restaurants_on_google_maps(location_or_query, cuisine_or_keyword)` calling the Google Maps Places API (New) (`places:searchText`) with `GOOGLE_MAPS_API_KEY`.
- **Modified [`app/agent.py`](./app/agent.py)**: Defined `google_search_agent` (using `google_search` grounding) wrapped in `AgentTool`, and `root_agent` (`restaurant_finder`) combining `AgentTool(google_search_agent)`, `search_restaurants_on_google_maps`, `PreloadMemoryTool()`, and `generate_memories_callback`.
- **Modified [`app/app_utils/services.py`](./app/app_utils/services.py) & [`app/fast_api_app.py`](./app/fast_api_app.py)**: Wired `SESSION_SERVICE_URI` and `MEMORY_SERVICE_URI` so ADK web, FastAPI, A2A, and Agent Runtime share the provisioned Agent Runtime Session and Memory Bank backend.
- **Modified [`.env`](./.env)**: Added `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_LOCATION=global`, and `GOOGLE_CLOUD_AGENT_ENGINE_LOCATION=us-central1`.
- **Modified [`codelab.md`](./codelab.md)**: Added Step 6 documenting the prompt, ADK multi-tool architecture (`AgentTool` for `google_search` + custom Google Maps Places `FunctionTool` + Memory Bank hooks), and official ADK/Maps documentation links.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Add Custom Memory Topics (`preferred_food_type`, `allergies`, `preferred_price_range`, `name`) to Memory Bank
- **Modified [`scripts/provision_memory_backend.py`](./scripts/provision_memory_backend.py)**: Added four `CustomMemoryTopic` definitions (`preferred_food_type`, `allergies`, `preferred_price_range`, and `name`) to `MEMORY_BANK_CONFIG` alongside the existing managed topics, and aligned all type imports with `agentplatform._genai.types` so `client.agent_engines.update()` applies changes cleanly.
- **Updated Agent Runtime Resource**: Executed `scripts/provision_memory_backend.py` to update `projects/78833623456/locations/us-central1/reasoningEngines/3114911218809176064` and verified all 8 memory topics on the live Agent Runtime backend.
- **Modified [`codelab.md`](./codelab.md)**: Added Step 5 documenting the user prompt, how `CustomMemoryTopic` works alongside `ManagedMemoryTopic` in Memory Bank, and official documentation links.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Provision Agent Runtime Backend for Session and Memory Bank
- **Enabled GCP Service on `haren-main`**: Verified `aiplatform.googleapis.com` is enabled.
- **Created [`scripts/provision_memory_backend.py`](./scripts/provision_memory_backend.py)**: Added an idempotent Python provisioning script using `agentplatform.Client` and `ReasoningEngineContextSpec` (`MemoryBankConfig`) to create or update the Agent Runtime backend and persist its URIs to `.env`.
- **Provisioned Agent Runtime Resource**: Created `advancedagents-session-memory-backend` (`projects/78833623456/locations/us-central1/reasoningEngines/3114911218809176064`) in `us-central1` with Session storage and Memory Bank enabled (`USER_PERSONAL_INFO`, `USER_PREFERENCES`, `KEY_CONVERSATION_DETAILS`, `EXPLICIT_INSTRUCTIONS`).
- **Modified [`.env`](./.env)**: Added `AGENT_ENGINE_SESSION_NAME`, `AGENT_ENGINE_LOCATION`, `AGENT_ENGINE_RESOURCE_NAME`, `GOOGLE_CLOUD_AGENT_ENGINE_ID`, `SESSION_SERVICE_URI`, and `MEMORY_SERVICE_URI`.
- **Modified [`codelab.md`](./codelab.md)**: Added Step 4 documenting the prompt, explanation of Agent Runtime Session & Memory Bank architecture, provisioning script execution, and official documentation links.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Provision Google Maps API Key and Enable Maps Platform Services
- **Enabled GCP Services on `haren-main`**: Enabled `apikeys.googleapis.com`, `maps-backend.googleapis.com`, `places.googleapis.com`, `places-backend.googleapis.com`, `geocoding-backend.googleapis.com`, `routes.googleapis.com`, `directions-backend.googleapis.com`, `distance-matrix-backend.googleapis.com`, and `static-maps-backend.googleapis.com`.
- **Created GCP API Key**: Provisioned `Advanced Agents Codelab Maps Key` (`projects/78833623456/locations/global/keys/a59ce08c-fede-463b-872f-af58e2fdec43`) scoped to the Google Maps Platform APIs.
- **Created [`.env`](./.env)**: Stored `GOOGLE_MAPS_API_KEY`, `GOOGLE_CLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION` for local agent/application execution.
- **Created [`.gitignore`](./.gitignore)**: Excluded `.env` and Python virtual environment/cache files from version control to prevent leaking credentials.
- **Modified [`codelab.md`](./codelab.md)**: Added Step 3 documenting the prompt, underlying `gcloud` commands, explanation, and official Google Maps Platform / Cloud SDK documentation links.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and logged this change entry.

### 2026-11-25 — Create `codelab.md` and Enforce Continuous Codelab Updates
- **Created [`codelab.md`](./codelab.md)**: Initialized a step-by-step reproducible codelab guide documenting the prompts, explanations, and official documentation links for Step 1 (`specs.md` + `GEMINI.md`) and Step 2 (`codelab.md`).
- **Modified [`GEMINI.md`](./GEMINI.md)**: Added Section 2 ("Living Codelab Maintenance (`codelab.md`)") requiring the agent to update `codelab.md` with the user's prompt, detailed explanations, and official documentation links on every future task.
- **Modified [`specs.md`](./specs.md)**: Updated current specifications and recorded this task in the change history.

### 2026-11-25 — Initialize `specs.md` and Workspace Change-Tracking Rule
- **Created [`specs.md`](./specs.md)**: Initialized the specification and change log file to track all project specifications and changes across tasks.
- **Created [`GEMINI.md`](./GEMINI.md)**: Added an always-on workspace rule instructing the agent to update `specs.md` with all file changes, feature specs, and architectural updates for every future task.
