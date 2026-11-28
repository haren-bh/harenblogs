---
name: adk-a2ui-google-maps
description: >-
  Builds ADK restaurant finder agents with Google Search (AgentTool), Google Maps
  Places/Geocoding APIs, and interactive A2UI (<a2ui-json>) web components in adk web,
  including the initial-fill user preferences form, clickable Google Maps location and
  radius (km) picker, and side-by-side Google Maps search results explorer with pin drops,
  star ratings, and restaurant details panel. Use this skill whenever the user asks to
  create or update the restaurant agent, A2UI forms, A2UI buttons, or Google Maps UI in A2UI.
---

# ADK A2UI Web Forms & Interactive Google Maps Runbook

Follow this runbook whenever building or updating the ADK restaurant finder agent, A2UI web forms, or interactive Google Maps components in `adk web`.

## Critical Rules (Avoid Re-Prompting)

1. **Wrap `google_search` in an `AgentTool` Sub-Agent**:
   Vertex AI Gemini APIs reject requests that mix the built-in `google_search` tool and custom Python `FunctionTool`s in the same `tools=[...]` list. Always wrap `google_search` inside a sub-agent (`google_search_agent`) and expose it to the root agent via `AgentTool(agent=google_search_agent)`.
2. **Always Strip LLM-Hallucinated `<a2ui-json>` Blocks in `after_model_callback`**:
   When an LLM sees `<a2ui-json>` blocks in prior conversation turns, it will often attempt to emit its own malformed or preferences-leaking `<a2ui-json>` block in its text response. In `inject_a2ui_form_callback` ([`app/agent.py`](../../app/agent.py)), ALWAYS strip any `<a2ui-json>...</a2ui-json>` blocks from the model's text parts via ` re.sub(r"<a2ui-json>.*?</a2ui-json>", "", part.text, flags=re.DOTALL)` before appending `callback_context.state["temp:a2ui_form_json"]`.
3. **Never Re-Display User Preferences After Initial Fill**:
   - `render_user_preferences_form` ([`app/tools.py`](../../app/tools.py)) MUST check if preferences are already stored in session state or the Vertex AI Memory Bank (`memories.list`). If they exist, populate `tool_context.state` silently and return `{"status": "already_configured"}` without setting `temp:a2ui_form_json`.
   - `build_restaurant_search_map_a2ui_payload` MUST only render the starting location input, interactive Google Map, radius (`km`) dropdown, and search button — never include user preference summaries on the map surface.
4. **Patch `@a2ui/angular` Button Styling, `MultipleChoice`, and Action Bridge in `services.py`**:
   In `adk web` (ADK v1.31.0), `@a2ui/angular` has three frontend bugs that must be patched via `_ensure_a2ui_button_action_bridge()` in [`services.py`](../../services.py):
   - **Blank button text**: `<a2ui-surface>` only defines `--p-*` variables and omits `--n-100`..`--n-0`, so `<a2ui-button>` text inherits the button background color. Define `--p-0` and `--n-100`..`--n-0` on `a2ui-surface` and explicitly style `a2ui-button button` with `background-color: #1a73e8 !important; color: #ffffff !important;`.
   - **`MultipleChoice.handleChange` missing `surfaceId`**: Patch `handleChange` in the bundle to pass `this.surfaceId()` to `setData(this.component(), e.target.value, this.dataContextPath(), this.surfaceId())`.
   - **Unwired button click action**: Patch `AppComponent` to expose `window.__adkChatInstance = this`, intercept `<a2ui-surface>` button clicks, read live `TextField`/`MultipleChoice` values from `processor.getData(...)` + DOM fallbacks, and submit directly via `chatInstance.sendMessage(msgText)`.
5. **Use Markdown-Safe Tokens (`@@ADK_GOOGLE_MAP@@` & `@@ADK_GOOGLE_MAP_RESULTS@@`) and Sibling DOM Mounting**:
   - Never use underscores in A2UI widget marker tokens (Markdown parses `_..._` as `<em>` tags and breaks token parsing).
   - Inside `<a2ui-text>`, Angular binds `[innerHTML]` on the child `<section>`. To prevent Angular change detection from wiping out the interactive Google Map, set `section.style.display = 'none'` and append the custom map/explorer DOM container directly to `<a2ui-text>` as a sibling of `<section>`.

## Component Architecture Reference

### 1. Initial-Fill User Preferences Form (`user_preferences_surface`)
- **Tool**: `render_user_preferences_form` -> `build_user_preferences_a2ui_payload` in [`app/tools.py`](../../app/tools.py)
- **Fields**: `name` (`TextField`), `preferred_food_type` (`TextField`), `allergies` (`TextField`), `preferred_price_range` (`MultipleChoice`: `$`, `$$`, `$$$`, `$$$$`)
- **Save Action**: Calls `save_user_preferences_to_memory` to write facts to `tool_context.state` and directly to Vertex AI Memory Bank (`client.agent_engines.memories.create`).

### 2. Interactive Google Maps Location & Radius (`km`) Picker (`map_search_surface`)
- **Tool**: `render_restaurant_search_map_form` -> `build_restaurant_search_map_a2ui_payload` in [`app/tools.py`](../../app/tools.py)
- **Token**: `@@ADK_GOOGLE_MAP@@<lat>@@<lng>@@<radius_km>@@`
- **Features**:
  - Geocodes the user's approximate location to center the map initially.
  - Clicking anywhere on the Google Map moves the center pin, redraws the `google.maps.Circle` (`radius_km * 1000` meters), and reverse-geocodes the clicked coordinates into the editable `Starting Location` `TextField` and data model (`lat`, `lng`, `location_query`).
  - Changing the `Search Radius (km)` `MultipleChoice` dropdown (`0.5` to `10 km`) updates the `google.maps.Circle` radius live on the map.
  - Clicking **Search Restaurants in This Area** submits the location and `km` radius to `search_restaurants_on_google_maps`.

### 3. Side-by-Side Google Maps Results Explorer (`map_results_surface`)
- **Tool**: `search_restaurants_on_google_maps` -> `build_restaurant_results_map_a2ui_payload` in [`app/tools.py`](../../app/tools.py)
- **Token**: `@@ADK_GOOGLE_MAP_RESULTS@@<base64_json>@@`
- **Features**:
  - Automatically attached (`temp:a2ui_form_json`) whenever `search_restaurants_on_google_maps` returns results.
  - **Left Pane**: Interactive Google Map showing the blue starting point marker, `km` search radius circle, and numbered red/gold pin drops (`1`..`N`) for each matching restaurant.
  - **Top Right Pane**: Scrollable restaurant list displaying each restaurant's numbered badge, name, gold star rating (`4.9 ★★★★★ (3,120)`), price tier (`$$`), distance (`km`), and cuisine type.
  - **Bottom Right Pane (Next to Google Maps)**: Detailed restaurant view showing full name, star rating, price tier, distance, cuisine badge, address, hours, phone, website, editorial summary, and clickable **Google Maps** / **Website** buttons. Clicking either a pin drop on the map or a restaurant row in the list highlights the selection, pans the map, and updates this details panel immediately.

## Validation

Run the unit test suite to verify all three A2UI surfaces and the root agent configuration:

```bash
uv run pytest tests/unit/test_dummy.py
```
