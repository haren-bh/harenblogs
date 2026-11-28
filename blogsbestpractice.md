# Public Blog Best Practices (Google Senior Developer Advocate)

## 1. Public-Only & Confidentiality Guardrails (Non-Negotiable)
* **Strictly public information only:** Every product name, launch stage, date, benchmark, pricing figure, and regional availability claim must already be published on an official, publicly accessible source. If a detail cannot be verified publicly, omit it.
* **Zero internal artifacts:** Never include unannounced features or unannounced Private Previews, internal codenames, internal lifecycle shorthand (e.g., `Long-GA`, `Short-GA`), internal phased rollout dates, sales/field guidance, internal office hours, `go/` links, or issue-tracker IDs (`b/`).
* **No meta-commentary on sources:** Never mention internal documents, chats, digests, or how information was filtered (avoid phrases like *"based on internal docs"*, *"compiled from release digests"*, or *"publicly sharable updates"*). Write directly for external developers.
* **Exclude non-builder noise:** Skip internal process notes, unverified third-party rumors, and purely promotional analyst blurbs unless they directly affect how developers build or operate systems.

---

## 2. Voice, Tone & Channel Framing
* **Google Developer Advocate voice:** Sound polished, authoritative, and trustworthy like an official Google blog—while keeping a **practitioner-first perspective**. Lead with **why a launch matters to builders** (what problem it solves or what architecture it unlocks) before listing SKUs and specs.
* **Google Developer Documentation Style Guide alignment:**
  * Use **active voice**, **present tense**, and **second-person** (*"you"*).
  * Prefer clear, concrete engineering language over marketing superlatives (*"industry-redefining"*, *"revolutionary"*).
  * State **launch stages** explicitly on every capability: **GA**, **Public Preview**, **Experimental**, or **Deprecated / Retiring** (with migration paths and dates).
* **Channel attribution:**
  * **Official Google channels** (`cloud.google.com/blog`, `developers.googleblog.com`, `blog.google`): Write as *"we"* representing the team.
  * **Personal / community channels** (Medium, Dev.to, LinkedIn, Substack): Write as *"I"* and include a standard disclaimer (*"Opinions are my own and not the views of my employer"*).

---

## 3. Blog Structure Templates

### Template A: Cloud & AI Update Blogs (Monthly / Event Roundups)
Cloud update blogs must use the following section flow:

#### `### Introduction`
* Open with a 3–4 sentence hook summarizing the overarching builder theme for the period (e.g., long-horizon agents, multi-model governance, FinOps guardrails) and who should care.

#### `### Summary of key updates`
* Provide a scannable **TL;DR Markdown table** highlighting the top 5–7 launches (`Launch / Feature` | `Stage` | `Why It Matters for Developers` | `Docs / Quickstart`).

#### `### AI updates`
* Cover frontier and specialized models (Gemini, media/speech models, Model Garden partner/open models), context/output capabilities, verified benchmarks, pricing, data residency, fine-tuning, and model lifecycle/retirements.

#### `### Agent Updates`
* Cover agent platforms, ADK / SDK releases, developer tools & IDEs (e.g., Antigravity, CLI tools), MCP & enterprise connectors, evaluation/observability pipelines, and agent identity/sandbox/gateway governance.

#### `### General Cloud Updates`
* Cover Data Cloud & analytics (BigQuery, databases), serverless & compute, Cloud FinOps & quota/spend controls, security/IAM/VPC perimeters, and new cloud regions.

#### `### What's next`
* Close with 3–5 actionable **Call-to-Action (CTA)** links so readers can immediately build: Google AI Studio, Cloud Console, runnable Codelabs/Notebooks, or official GitHub repositories.

---

### Template B: Technical Deep-Dive / Tutorial Blogs
When writing single-topic engineering posts rather than roundups, follow:
1. **Hook & Problem Statement:** What real-world developer pain point are you solving, and what will the reader have working by the end?
2. **Architecture Overview:** High-level system diagram + component responsibilities before diving into code.
3. **Step-by-Step Implementation:** Reproducible prerequisites, minimal working code snippets, and expected outputs.
4. **Production Readiness & Trade-offs:** Latency, cost/token optimization, security/IAM least privilege, quota handling, and observability.
5. **What's Next & Resources:** Link to the full GitHub repo, official docs, and related posts.

---

### Template C: Interactive Hands-On / Workshop Codelab Blogs (Static Web)
When publishing hands-on event workshops or multi-track tutorials as static HTML pages (e.g., GitHub Pages):
1. **Progressive Disclosure Landing (Summary First):** Show **only** the high-level summarized instructions, checklist, and environment path selector on initial load; keep detailed setup tracks and deep-dive guides behind clean hash-routed views (`#hash` + `document.startViewTransition` + programmatic heading focus) with a persistent **"← Back to Summary"** control and an optional **"Show All Sections"** toggle.
2. **Interactive Copy & Parameter Sync:** Provide 1-click Copy buttons on all CLI/prompt blocks and allow attendees to enter shared parameters once (such as `<YOUR_PROJECT_ID>`) to auto-populate downstream commands.
3. **Static Hosting & Raw Markdown Spec Hygiene:** Always link sub-apps via explicit `.../index.html` paths so relative `./js/`, `./models/`, and `./textures/` imports resolve identically across static hosts and local servers. Include `.nojekyll` at the repository root (plus an in-page Spec Preview / Blob `.md` download option) so GitHub Pages serves raw `.md` specification files without `404` rewrites.
4. **Stage Orientation Framing (Beginning Briefing & Cumulative End Ledger):** Open every hands-on stage with a concise *Stage Briefing* card (stating what the learner is doing, which architecture layer is touched, and expected deliverables) and close every stage with a *Stage Completion + Cumulative Progress Ledger* showing both what was just accomplished and every completed milestone from Stage 1 through the current stage, paired with directional View Transitions (`:active-view-transition-type(forward|backward)`).
5. **Zero-Flicker Bilingual Toggle (`html[data-lang]`):** For bilingual (`JP / EN`) workshop guides, pair `[data-lang-ja]` and `[data-lang-en]` spans controlled via `html[data-lang]` and persisted in `localStorage`, keeping CLI commands and agent prompt blocks clean and directly copyable in both languages.
6. **Privacy-Preserving Video Walkthrough Façades (`youtube-nocookie.com` + `file://` Fallback):** Pair local `.webp`/`.jpg` poster images with a click-to-play `youtube-nocookie.com` iframe (`referrerpolicy="strict-origin-when-cross-origin"`, descriptive `title`, `<noscript>` fallback, and a descriptive direct YouTube link in `<figcaption>`), falling back to opening `https://youtu.be/<ID>` in a new tab when `location.protocol === 'file:'` so local previews never hit YouTube `Error 153`.

---

## 4. Readability, Visuals & Code Standards
* **Scannable formatting:**
  * Keep paragraphs to **3–4 lines max**.
  * Keep bullet points focused on **one core idea per bullet**—avoid packing 5+ specs, dates, and URLs into a single 80-word sentence.
  * For large roundups, feature top launches with structured sub-bullets and group smaller incremental releases into a **Quick Hits** list.
* **Tables over prose:** Whenever comparing **3 or more items or metrics** (model pricing tiers, input/output token limits, benchmark scores, or deprecation schedules), format them as a Markdown table rather than inline text.
* **Diagrams and charts:**
  * Include **architecture or flow diagrams** (e.g., Mermaid diagrams or clean SVG/PNG visuals) whenever explaining multi-step workflows, agent memory/routing layers, request/gateway topologies, or evaluation pipelines.
  * Use **charts** for benchmark or cost/latency comparisons, always citing the exact benchmark version and source Model Card or blog.
* **Show, don't just tell:** Whenever a launch includes a developer surface, show a concise, copy-pasteable CLI command, API parameter, or SDK snippet (e.g., `gcloud`, `adk`, `agy`, or Python/TypeScript SDK) alongside links to runnable samples.

---

## 5. Links & Citation Hygiene
* **Dual linking rule:** Always link to **both** the **official announcement blog post** and the **relevant technical documentation / release notes** when both exist.
* **Authoritative public domains:** Prioritize primary sources—`blog.google`, `cloud.google.com/blog`, `developers.googleblog.com`, `docs.cloud.google.com`, official Model Cards, and official `github.com/google*` repositories/releases.
* **Descriptive anchor text:** Use meaningful link labels (e.g., `[Gemini 4 Argon Documentation](...)`, `[ADK Python v2.13.0 Release Notes](...)`) instead of raw URLs or generic *"here"* / *"link"* text.
* **Live URL verification:** Confirm every URL resolves publicly (no SSO walls, broken anchors, or outdated docs) and cross-check that specs in the prose match the linked page.

---

## 6. Pre-Publish Checklist
- [ ] **Public-only audit passed:** Zero unannounced Previews, internal labels/timelines, internal links (`go/`, `b/`), or source meta-commentary.
- [ ] **Builder value clear:** Every major section explains *why it matters* and labels launch stages (`GA` / `Public Preview` / `Experimental` / `Deprecated`).
- [ ] **Required sections complete:** Follows Template A (including `Introduction`, `Summary of key updates`, `AI updates`, `Agent Updates`, `General Cloud Updates`, and `What's next`) or Template B.
- [ ] **Visual & scannable:** Dense specs are converted into tables; complex architectures have a diagram; bullets and paragraphs are concise.
- [ ] **Links verified:** Every feature links to live official blogs and documentation with descriptive anchor text.
