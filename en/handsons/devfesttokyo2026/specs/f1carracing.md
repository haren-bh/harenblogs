# Technical Architecture and System Specification: Photorealistic Web-Based Formula 1 Racing Simulation (`f1carracing.md`)

> **Single-Shot Build Directive**: This specification is a complete, self-contained engineering blueprint for building a photorealistic, playable web-based Formula 1 racing simulation in one pass with zero geometric, coordinate, shading, physics, or asset-loading defects. All Nano Banana texture generation steps, Python PBR map derivation rules, parametric `.glb` F1 car build assertions, coordinate conventions, 240 Hz vehicle dynamics equations, circuit spline rules, gray-and-white telemetry UI primitives, procedural audio synthesis, and headless browser verification gates below are normative.

---

## 1. System Architecture, Web Runtime Stack, and Coordinate Conventions

This technical specification establishes the architectural, visual, mathematical, and algorithmic requirements for implementing a real-time, photorealistic Formula 1 racing simulation operating natively within modern desktop web browsers (Chrome, Safari, Firefox, Edge on macOS, Windows, and Linux) with zero native client installations, zero proprietary browser plugins, and zero C++/Rust native compiler dependencies.

### 1.1 Target Web Runtime Stack

To guarantee out-of-the-box execution, deterministic `240 Hz` physics stability, and desktop-grade photorealistic visuals at `60–120 FPS` across standard integrated and discrete GPUs, the system uses a clean, universally supported web stack:

* **Web Server**: Minimal Python 3 **Flask** HTTP server (`host="0.0.0.0"`, port `8080`, `debug=False`) serving the HTML entry point, ES modules, `.glb` meshes, and Nano Banana texture assets cleanly over HTTP with an explicit `/favicon.ico` (`204 No Content`) route so ES modules load with zero CORS or 404 console errors.
* **3D Rendering Engine**: Vanilla ES Modules **Three.js `0.170.0`** configured via an HTML `<script type="importmap">` mapping both `"three"` and `"three/addons/"` (`GLTFLoader`, post-processing passes if used). Renderer operates on **WebGL2** (or WebGPU with automatic WebGL2 fallback) configured with `THREE.ACESFilmicToneMapping`, `THREE.PCFSoftShadowMap`, `THREE.SRGBColorSpace` output, `devicePixelRatio` clamped to `<= 2.0`, and `PMREMGenerator` environment lighting.
* **Deterministic `240 Hz` Physics Execution**: Vehicle dynamics, hybrid powertrain, aerodynamics, thermal models, and Pacejka tire solvers execute at a fixed temporal discretization of **240 Hz** ($\Delta t = 4.167\,\text{ms}$) via a zero-allocation fixed-timestep accumulator (either in a preallocated typed-array ES module physics stepper or an isolated Web Worker using Transferable `Float32Array` state snapshots—never relying on `SharedArrayBuffer` unless COOP/COEP headers are explicitly configured on the Flask server, and never requiring external C++/Rust WASM compilation).
* **Offline AI Asset & 3D Mesh Tooling**: **Nano Banana** (`generate_image`) for photorealistic car, tire, rim, cockpit, and circuit textures + orthographic design references, paired with Python 3 (`/Users/bharen/venv/mainvenv/bin/python3`, using `numpy`, `scipy`, `trimesh`, `Pillow`) for seamless texture post-processing, Sobel normal/ORM derivation, PBR reflectance clamping, and parametric `.glb` F1 car mesh assembly.
* **Project Organization**: The implementation may freely choose its own directory layout, module boundaries, and filenames to cleanly separate the Flask server, HTML/CSS UI, simulation subsystems, 3D models, Nano Banana textures, and asset build scripts.

| Subsystem Layer | Primary Technical API | Execution Context | Execution Frequency | Memory Interface |
| :--- | :--- | :--- | :--- | :--- |
| **Input Ingestion** | W3C KeyboardEvent / PointerEvent API | Browser Main Thread | Event-driven (Sub-frame) | Preallocated bitmask + `performance.now()` timestamps |
| **Vehicle Dynamics** | Zero-Allocation ES Module / Web Worker | Fixed-Timestep Accumulator | Fixed `240 Hz` ($\Delta t = 4.167\,\text{ms}$) | Preallocated `Float32Array` state buffers |
| **Graphics Dispatch** | Three.js WebGL2 (or WebGPU + WebGL2 fallback) | Render Context Thread | Display Refresh (`60–120 Hz`) | `MeshPhysicalMaterial`, custom GLSL shaders, `InstancedMesh` |
| **Audio Synthesis** | Web Audio API (Gesture-Gated Procedural Synth) | Audio Engine Thread | Native sample rate (`48 kHz`) | Continuous oscillator/filter/noise node graph |
| **Offline Asset Pipeline** | Nano Banana (`generate_image`) + Python `trimesh`/`Pillow` | Build-Time Agent Workflow | Executed before runtime launch | Local `.png`/`.jpg` PBR maps + binary `.glb` assets |

### 1.2 Authoritative World & Vehicle Coordinate Conventions (Critical Single-Shot Guardrails)

Every steering inversion, backwards wheel spin, misaligned suspension upright, or camera flip in web racing sims stems from mismatched coordinate axes. All modules and `.glb` builders MUST obey these exact right-handed metric conventions:

1. **World Space (`THREE.Scene`)**: Right-handed, meters, **`+Y` up**. Circuit track elevation $y_{\text{track}}(s)$ sits cleanly on or above `Y = 0.000 m`.
2. **Hero F1 Car `.glb` Authoring & Local Chassis Space**:
   * Right-handed, meters, **`+Y` up**.
   * **Forward (Nosecone Tip)**: **`-Z`** axis.
   * **Rearward (Diffuser & Rear Wing)**: **`+Z`** axis.
   * **Driver's Right (Starboard)**: **`+X`** axis; **Driver's Left (Port)**: **`-X`** axis.
   * **Longitudinal & Vertical Origin**: `(0, 0, 0)` sits directly on the ground plane beneath the vehicle's **Center of Gravity (CoG)** (`(0, +0.310, 0)`). Given wheelbase $L = 3.600\,\text{m}$ and static weight distribution $45.5\%$ front / $54.5\%$ rear:
     * **Front Axle Centerline**: `Z = -1.962 m` ($d_f = 0.545 \cdot L$).
     * **Rear Axle Centerline**: `Z = +1.638 m` ($d_r = 0.455 \cdot L$).
     * **Front Track Centers**: `X = ±0.800 m` ($w_f = 1.600\,\text{m}$); **Rear Track Centers**: `X = ±0.775 m` ($w_r = 1.550\,\text{m}$).
     * **Tire Contact Patches**: All 4 slick tires rest strictly at **`Y = 0.000 m`** (`|minY| < 0.002 m`), placing all 4 wheel hub centers at **`Y = +0.360 m`** (regulation `720 mm` outer tire diameter).
     * **Overall Envelope**: Nosecone tip at `Z ≈ -3.12 m`, rear wing trailing edge at `Z ≈ +2.40 m` (`L_total ≈ 5.52 m`), max width `2.00 m`, roll-hoop height `0.97 m` (`1.06 m` with T-cam pod).
3. **Sign Conventions for Motion & Articulation**:
   * **Left Steering (`KeyA`)**: Positive yaw angle $+\delta$ around local **`+Y`** on both front steering knuckles, turning the `-Z` nose toward `-X` (left).
   * **Forward Wheel Rotation**: Negative angular rotation around local **`+X`** (`rotation.x -= omega * dt` rolls the top of the tire forward toward `-Z`).
   * **Chase Camera Offset**: Positioned behind the car along local **`+Z`** (`(0, +1.45, +4.90)`) looking forward past the nose toward `-Z`.

#### Critical Anti-Patterns to AVOID (Learned Engineering Guardrails)
1. **NEVER build F1 cars out of untextured primitive boxes/cylinders**: Primitive geometry with flat solid colors looks like a toy. Always execute the full Section 2 Nano Banana + Python `trimesh` PCHIP lofting pipeline.
2. **NEVER divide by raw longitudinal velocity $v_x$ in Pacejka slip equations**: At standstill ($v_x = 0$), $\kappa = (\omega r - v_x)/v_x$ and $\alpha = \arctan(v_y / v_x)$ produce `NaN` / `Infinity`. Always regularize denominators with $\max(|v_x|, v_{\text{eps}})$ and low-speed damping (Section 4.4).
3. **NEVER leave `trimesh` `.glb` meshes with default flat normals or unassigned color spaces**: Recompute crease-preserving smooth normals (`flatShading = false`), enforce `THREE.SRGBColorSpace` on all albedo/emissive maps, and keep all normal/ORM/roughness/metalness/AO maps in `THREE.NoColorSpace`.
4. **NEVER spin brake calipers or glowing brake discs together with the tire**: Mount calipers and brake ducts on the non-spinning upright node; spin only the tire + forged rim node (and optionally the brake disc independently with a radially symmetric rotor texture).

### 1.3 Core 5-State Deterministic Race Loop & FSM

The simulation runs a clean, deterministic 5-state finite-state machine supporting both immediate visual showroom inspection and full high-speed Grand Prix driving:

| State Identifier | Entry Condition | Primary Operational Process | Exit Trigger Condition | Active Camera Delegate |
| :--- | :--- | :--- | :--- | :--- |
| **STATE_SHOWROOM_GRID** | Initial page load or `Showroom` toggle | Hero F1 car parked on grid apron with idle engine hum; 360° pointer orbit/zoom to inspect Nano Banana livery, carbon weave, brake discs, and Pirelli sidewalls; compound & mode selection | User clicks `START RACE` / `DRIVE` or presses `Space` / `W` | `Camera_Showroom_Orbit` |
| **STATE_LIGHTS_COUNTDOWN** | Race start triggered | 5 FIA gantry red lights illuminate sequentially (`0.65 s` interval) then extinguish simultaneously ("Lights Out!"); car held on grid with launch RPM revving | Lights extinguish (or immediate skip in Free Practice / Time Trial) | Selected Driving Camera (`Chase` default) |
| **STATE_ACTIVE_RACING** | Lights out or resume | `240 Hz` vehicle dynamics, AI rival pack (or Solo Time Trial), 3-sector lap timing, DRS zone detection, dynamic tire/brake thermals, skid decals, spark cascades | Target laps completed, `Esc`/`P` pause, or `Showroom` click | User-selected (`Chase`, `Cockpit`, or `TV_Pod`) |
| **STATE_PAUSED** | `Esc` / `P` pressed | Physics timestep frozen, audio smoothly attenuated, translucent gray-and-white pause overlay displayed | `Resume` (`Esc`/`P`) or `Restart Session` | Frozen driving camera |
| **STATE_SESSION_SUMMARY** | Checkered flag crossed | Lap-by-lap breakdown, best lap, theoretical best sectors (`S1/S2/S3`), top speed trap, max G-force recorded | `Race Again` or `Return to Showroom` | Slow cinematic orbit around parked hero car |

---

## 2. AI Agent Asset Acquisition: Nano Banana Texture & `.glb` F1 Car Pipeline

> **MANDATORY AI AGENT WORKFLOW**: Realistic Formula 1 cars cannot be achieved through untextured geometry or generic procedural noise alone. Before writing Three.js rendering or gameplay code, the implementing AI agent **MUST** execute **Steps 1 through 4 below in strict sequential order** to generate photorealistic motorsport textures using **Nano Banana** (`generate_image`), derive physically coupled PBR data maps in Python, build the sculpted parametric `.glb` F1 car, and wire it into the PBR runtime pipeline.

### Step 1 — Mandatory Nano Banana (`generate_image`) Reference & Texture Generation

The AI agent MUST invoke **Nano Banana** (`generate_image`) to synthesize all visual references and hero surface albedo textures before building meshes or materials.

#### Mandatory Nano Banana Prompting Rules
1. **Seamless Tileable Surface Textures** (carbon fiber, asphalt, tire rubber tread, kerbs, grass, gravel): Every prompt MUST include the normative clause:
   > **`"flat, top-down orthographic view, evenly lit diffuse studio lighting, seamless tileable PBR albedo texture, zero cast shadows, zero specular glare, zero perspective distortion"`**
   This prevents baked-in directional lighting, vignetting, or harsh UV tiling seams.
2. **Orthographic 2D Graphic Plates & Radial Parts** (car liveries, Pirelli sidewalls, 18-inch wheel rims, drilled carbon brake rotors, steering wheel faceplate, helmet wrap, sponsor barriers): Every prompt MUST include:
   > **`"flat orthographic 2D surface plate, straight-on studio lighting, razor-sharp motorsport graphic detail, zero cast shadows, zero perspective warp"`**
3. **Vehicle Proportions & Beauty Grounding References**: Generate both a 3-view orthographic blueprint and a 3/4 photorealistic beauty render so the agent can cross-verify silhouette proportions, sidepod undercut curvature, wing endplates, and livery contrast during headless visual inspection.

#### Authoritative Nano Banana Asset & Texture Manifest

The AI agent MUST generate and save all textures listed below (post-processed into power-of-two `.png`/`.jpg` assets in Step 2):

| Asset ID | Role & Target Surfaces | Target Res & Format | Aspect Ratio | Nano Banana (`generate_image`) Prompt Blueprint |
| :--- | :--- | :---: | :---: | :--- |
| **`f1_car_orthographic_ref`** | 3-view studio geometry reference (top, side, front) | `1024×1024` `.png` | `1:1` | *"Clean technical 3-view orthographic studio blueprint (top, side, front elevation) of a modern 2026 FIA ground-effect Formula 1 race car on neutral light-gray background, sculpted Venturi sidepods, needle nosecone, swan-neck rear wing, titanium halo, 18-inch slick tires, sharp engineering proportions"* |
| **`f1_car_hero_ref`** | 3/4 photorealistic beauty target for visual critic | `1280×720` `.png` | `16:9` | *"Photorealistic 3/4 front-quarter motorsport studio photograph of a modern Formula 1 race car on dark FIA track asphalt, metallic crimson-and-silver livery over exposed 2x2 weave carbon fiber, Pirelli red-ring soft slick tires, glowing brake duct detail, crisp natural daylight, shallow broadcast depth of field"* |
| **`car_carbon_weave`** | Wings, Venturi floor, diffuser, halo, suspension wishbones, cockpit tub | `1024×1024` `.png` | `1:1` | *"Macro photograph of authentic motorsport 2x2 diagonal twill dry carbon fiber composite weave, dark charcoal graphite filaments with fine crisp fiber alignment, flat, top-down orthographic view, evenly lit diffuse studio lighting, seamless tileable PBR albedo texture, zero cast shadows, zero specular glare, zero perspective distortion"* |
| **`car_livery_player`** | Hero player F1 monocoque, nosecone, sculpted sidepods, engine cover & shark fin | `1024×1024` `.png` | `1:1` | *"Modern Formula 1 race car painted bodywork livery surface plate, deep metallic championship crimson red basecoat with crisp brushed titanium-silver geometric racing stripes, matte carbon accent strips, subtle recessed panel seam lines, louvered cooling vents, bold white racing number 26 graphic, flat orthographic 2D surface plate, straight-on studio lighting, zero cast shadows, zero perspective warp"* |
| **`car_livery_rival_a`** | AI Rival Team A bodywork livery | `1024×1024` `.png` | `1:1` | *"Modern Formula 1 race car painted bodywork livery surface plate, deep metallic sapphire cobalt blue with crisp ice-white and neon-lime geometric aero stripes, subtle panel seams and cooling louver vents, bold white racing number 14 graphic, flat orthographic 2D surface plate, straight-on studio lighting, zero cast shadows, zero perspective warp"* |
| **`car_livery_rival_b`** | AI Rival Team B bodywork livery | `1024×1024` `.png` | `1:1` | *"Modern Formula 1 race car painted bodywork livery surface plate, metallic papaya orange and satin anthracite charcoal two-tone Formula 1 geometric racing stripes, subtle bodywork panel lines and vents, bold racing number 44 graphic, flat orthographic 2D surface plate, straight-on studio lighting, zero cast shadows, zero perspective warp"* |
| **`tire_slick_tread`** | Pirelli-profile racing slick contact tread | `1024×1024` `.png` | `1:1` | *"Close-up motorsport Formula 1 slick racing tire rubber tread surface, charcoal rubber (#383838) with subtle longitudinal mold seam lines, fine heat-scrubbed rubber micro-grain and subtle marbled pickup texture, flat, top-down orthographic view, evenly lit diffuse studio lighting, seamless tileable PBR albedo texture, zero cast shadows, zero specular glare"* |
| **`tire_sidewall_pirelli`** | Outer & inner slick tire sidewalls (master map tinted per compound in Step 2) | `1024×1024` `.png` | `1:1` | *"Centered circular Formula 1 18-inch slick racing tire sidewall graphic on dark matte charcoal rubber, crisp curved white and crimson-red compound ring band around outer perimeter with bold white motorsport radial sidewall lettering 'P ZERO' and concentric mold ribs, circular black center cutout for wheel rim, flat orthographic 2D surface plate, straight-on studio lighting, zero cast shadows, zero perspective warp"* |
| **`wheel_rim_forged`** | 18-inch forged magnesium multi-spoke rim + FIA aero cover & center-lock nut | `1024×1024` `.png` | `1:1` | *"Centered front-on Formula 1 18-inch forged gunmetal-gray magnesium multi-spoke racing wheel rim with aerodynamic carbon outer lip ring, machined metallic spoke chamfers, and anodized red/titanium center-lock wheel nut in exact center, flat orthographic 2D surface plate, straight-on studio lighting, zero cast shadows, zero perspective warp"* |
| **`brake_rotor_carbon`** | Cross-drilled carbon-carbon brake disc (coupled with blackbody glow) | `512×512` `.png` | `1:1` | *"Centered front-on motorsport Formula 1 carbon-carbon brake disc rotor, dark matte graphite carbon-ceramic surface with concentric radial brake pad scoring rings and hundreds of precision radial cooling ventilation drill holes around the friction annulus, machined titanium central mounting bell, flat orthographic 2D surface plate, straight-on studio lighting, zero cast shadows"* |
| **`driver_helmet_livery`** | Driver helmet shell + dark iridium visor wrap | `1024×1024` `.png` | `1:1` | *"Seamless cylindrical 360-degree Formula 1 racing driver helmet graphic wrap texture, glossy pearl-white, crimson, and carbon geometric aero stripes with a centered dark tinted iridium polycarbonate visor strip and top chin air vents, flat orthographic 2D surface plate, straight-on studio lighting, zero cast shadows"* |
| **`cockpit_steering_dash`** | Cockpit carbon F1 steering wheel faceplate & OLED screen | `1024×512` `.png` | `16:9` | *"Front-on Formula 1 carbon fiber steering wheel faceplate graphic, centered bright telemetry OLED screen layout, colorful anodized rotary differential/brake-bias dials, tactile push buttons labeled DRS, PIT, RADIO, and top horizontal shift-light LED bar, flat orthographic 2D surface plate, straight-on studio lighting, zero cast shadows"* |
| **`track_asphalt_aggregate`** | Grand Prix circuit base asphalt surface | `1024×1024` `.png` | `1:1` | *"FIA Grade 1 Formula 1 circuit racing asphalt surface, dark charcoal crushed basalt stone aggregate embedded in weathered bitumen binder with crisp micro-stone mineral grit, flat, top-down orthographic view, evenly lit diffuse studio lighting, seamless tileable PBR albedo texture, zero cast shadows, zero specular glare, zero perspective distortion"* |
| **`track_kerb_fia`** | Alternating red/white FIA apex & exit rumble kerbs | `1024×1024` `.png` | `1:1` | *"FIA Formula 1 painted concrete rumble strip kerb texture with crisp alternating motorsport red and off-white painted concrete blocks, coarse concrete aggregate pores, beveled groove lines, and light rubber tire scuff marks, flat, top-down orthographic view, evenly lit diffuse studio lighting, seamless tileable PBR albedo texture, zero cast shadows"* |
| **`track_barrier_sponsor`** | Trackside Armco/Tecpro barriers & Tokyo GP sponsor boards | `1024×512` `.png` | `16:9` | *"Clean motorsport FIA trackside advertising barrier banner panel in crisp white, charcoal-gray, and crimson-red typography reading 'TOKYO GP 2026' and 'DEVFEST MOTORSPORT' with subtle corrugated safety barrier panel joints, flat orthographic 2D surface plate, straight-on studio lighting, zero cast shadows"* |
| **`env_grass_verge`** | Circuit infield/verge manicured turf | `512×512` `.png` | `1:1` | *"Short-cropped motorsport circuit infield grass verge with subtle organic turf density variation and fine grass blades, flat, top-down orthographic view, evenly lit diffuse studio lighting, seamless tileable PBR albedo texture, zero cast shadows, zero specular glare"* |
| **`env_gravel_trap`** | FIA runoff gravel bed pebbles | `512×512` `.png` | `1:1` | *"Raked FIA Formula 1 circuit runoff gravel trap with uniform rounded light-gray and tan washed river pebbles in parallel rake grooves, flat, top-down orthographic view, evenly lit diffuse studio lighting, seamless tileable PBR albedo texture, zero cast shadows, zero specular glare"* |

---

### Step 2 — Automated Python PBR Post-Processing & Non-Color Map Derivation

Raw AI-generated textures are sRGB color images only. Immediately after Step 1, the AI agent MUST write and run a Python 3 post-processing script (`/Users/bharen/venv/mainvenv/bin/python3` using `Pillow`, `numpy`, and `scipy`) to transform every Nano Banana image into a complete, physically validated PBR texture set:

1. **Exact Power-of-Two Resizing & Seamless Toroidal Blending**:
   * Crop/resize each image with `Image.Resampling.LANCZOS` to its exact target dimensions (`1024×1024`, `1024×512`, or `512×512`).
   * For all tileable maps (`car_carbon_weave`, `tire_slick_tread`, `track_asphalt_aggregate`, `track_kerb_fia`, `env_grass_verge`, `env_gravel_trap`), perform a half-period circular shift (`np.roll`) plus smooth cosine feathering across a `12%` edge band so the horizontal and vertical seams vanish completely under high UV repeat factors.
2. **Strict PBR sRGB Reflectance Clamping (`Utility - sRGB - Texture`)**:
   * Convert RGB channels to `float32`, verify histogram bounds, and soft-clamp:
     * **Dielectric Albedos** (`car_livery_*`, `car_carbon_weave`, `tire_*`, `brake_rotor_carbon`, `track_*`, `env_*`): strictly within **`[30, 240]` sRGB** (eliminating physically impossible pure `0` black light traps and pure `255` white diffuse blowouts).
     * **Conductive Metal Regions** (`wheel_rim_forged` metallic hub/spokes): within **`[180, 255]` sRGB** where metallic mask = `1.0`.
   * Export validated color maps alongside a machine-readable PBR validation manifest (JSON) consumed by the runtime Inspector.
3. **Coupled Non-Color PBR Data Map Synthesis (`Utility - Raw`)**:
   * **Tangent-Space Normal Maps (`*_normal.png`)**: Compute perceptual luminance heightfield $H(x, y)$ from each Nano Banana albedo, apply periodic `3×3` Scharr/Sobel gradient filters (`dx`, `dy`), scale by material-calibrated bump strength (`carbon: 2.2`, `asphalt: 3.4`, `tire_tread: 1.8`, `tire_sidewall: 2.0`, `kerb: 2.6`, `brake_rotor: 3.0`, `gravel: 3.8`, `livery_seams: 1.1`), normalize `(nx, ny, 1.0)` in OpenGL `+Y` tangent space, and encode as `uint8` RGB (`(n * 0.5 + 0.5) * 255`).
   * **Channel-Packed ORM Maps (`*_orm.png`)**: Pack three strictly linear (`Utility - Raw`) scalar channels into one RGB image:
     * **`R` (Ambient Occlusion)**: Multi-scale cavity occlusion derived from local Gaussian high-pass darkening (darkening weave recesses, asphalt aggregate valleys, kerb grooves, and brake drill holes).
     * **`G` (Roughness)**: Remapped from local micro-variance into physically calibrated intervals:
       * Painted Livery Basecoat: `[0.18, 0.32]` (beneath `clearcoatRoughness = 0.03`).
       * Exposed Carbon Weave: `[0.20, 0.42]` (with weave highlight variation).
       * Tire Slick Tread: `[0.42, 0.65]` baseline (dynamically modulated in shader down to `0.22` when hot/scrubbed).
       * Forged Wheel Rim: `[0.18, 0.34]`.
       * Carbon Brake Rotor: `[0.62, 0.78]`.
       * Racing Asphalt: `[0.60, 0.88]` (dark bitumen smoother, mineral stone tips rougher).
       * FIA Kerb: `[0.55, 0.75]`.
     * **`B` (Metalness)**: Strictly binary (`0` dielectric or `255` conductor; only `wheel_rim_forged` spokes/nut and metallic pinstripe mask regions set `255`, while tires, carbon, asphalt, and kerbs stay strictly `0`).
   * **Auxiliary Specialized Maps**:
     * **`car_flake_normal.png`** (`512×512` tileable high-frequency random micro-facet normal perturbation for sparkling metallic aluminum flakes underneath the clearcoat).
     * **3 Pirelli Compound Sidewall Variants**: Programmatically hue-shift the outer compound ring band of the Nano Banana `tire_sidewall_pirelli` master into `tire_sidewall_soft.png` (Crimson Red `#dc2626`), `tire_sidewall_medium.png` (Championship Yellow `#eab308`), and `tire_sidewall_hard.png` (Crisp White `#e5e7eb`) so switching tire compounds visually transforms all 4 sidewalls immediately!
     * **`brake_thermal_mask.png`**: Annular grayscale mask isolating the friction disc surface (`r ∈ [0.42, 0.96]`) from the cooler central titanium bell (`0.0`) so only the friction annulus glows incandescent orange-red under heavy braking!

---

### Step 3 — Parametric `.glb` Hero F1 Car Builder (`trimesh` + `scipy` PCHIP Lofting)

To ensure an unmistakable modern ground-effect Formula 1 silhouette with smooth aerodynamic lofting, clean UV wrapping for every Nano Banana texture, and zero floating/intersecting parts, the AI agent MUST construct the hero vehicle offline using a Python `trimesh` + `scipy.interpolate.PchipInterpolator` mesh generator outputting a binary **`f1_car.glb`** asset:

* **Hard Build Assertions (Verified & Printed by the Python Builder Script)**:
  * Right-handed, meters, `Y-up`, facing **`-Z`**.
  * Overall length strictly **`5.40 m ≤ L ≤ 5.65 m`** (target `5.52 m`), width strictly **`1.95 m ≤ W ≤ 2.02 m`** (target `2.00 m`), roll-hoop height **`0.94 m ≤ H ≤ 1.12 m`**.
  * All 4 wheel contact patches strictly at **`Y = 0.000 m`** (`|minY| < 0.002 m`).
  * Total triangle count strictly **`25,000 ≤ tris ≤ 65,000`** (dense curved loft rings on nose, sidepods, tires, and halo; crisp bevels on wing elements).
  * Every curved lofted surface duplicates its UV seam column (`cols = n_seg + 1`) so Nano Banana textures wrap seamlessly with zero stretching, and calls `trimesh.repair.fix_normals` to guarantee outward-facing winding.
* **Mandatory Sculpted Sub-Assemblies & Articulated Node Hierarchy**:
  * **`chassis_root`**:
    * `monocoque_nose`: PCHIP-lofted tapered needle nosecone transitioning smoothly into the sculpted survival cell monocoque (UV-mapped to `car_livery_player`).
    * `sidepods_engine_cover`: Modern FIA ground-effect undercut sidepods with recessed radiator intake lips, sculpted downwash Coke-bottle taper, roll-hoop airbox intake, and dorsal shark fin (`car_livery_player` + matte carbon intake interiors).
    * `underfloor_venturi_diffuser`: Full-length carbon floor edge wing, leading Venturi tunnel fences, titanium underbody skid plank, and multi-strake rear diffuser (`car_carbon_weave`).
    * `front_wing_assembly`: Curved 4-element cascading carbon front wing mainplane + flaps, swept S-curve endplates, and nose pylons (`car_carbon_weave` + livery accents on endplates).
    * `rear_wing_mainplane`: Dual swan-neck carbon mounting pylons, beam wing, sculpted curved endplates, and lower mainplane (`car_carbon_weave` + livery endplates).
    * **`drs_upper_flap`**: Separate child node pivoted cleanly at the rear wing trailing hinge axis (`rotation.x` opens smoothly `0° → +28°` when DRS activates!).
    * `halo_titanium`: Sculpted aerodynamic curved wishbone Halo safety hoop + central forward pylon (`car_carbon_weave` wrap).
    * `cockpit_interior` + **`steering_wheel`** (pivots dynamically around steering column axis proportionally to $\delta$, textured with `cockpit_steering_dash`) + `driver_helmet` (lofted aerodynamic helmet + sculpted visor textured with `driver_helmet_livery`) + `side_mirrors` + `t_cam_pod`.
    * `suspension_wishbones`: Carbon upper/lower A-arm wishbones, pushrods, and track rods linking chassis hardpoints to all 4 uprights (`car_carbon_weave`).
    * `rear_rain_light`: Recessed rear crash-structure FIA vertical LED bar (emissive red).
  * **4 Articulated Corner Assemblies** (`FL` at `(-0.800, 0.360, -1.962)`, `FR` at `(+0.800, 0.360, -1.962)`, `RL` at `(-0.775, 0.360, +1.638)`, `RR` at `(+0.775, 0.360, +1.638)`):
    * Each corner has a vertical suspension travel group (`wheel_*_susp`) translating along `Y` with raycast compression.
    * Front corners nest a steering knuckle group (`wheel_*_steer`) rotating around **`+Y`** by $\delta$.
    * Inside each knuckle/suspension group sit TWO parallel children:
      1. **`wheel_*_spin`** (rotates around local `X` by integrated wheel angular velocity $\omega_i$): Profiled slick tire mesh (rounded toroidal shoulder profile, `305 mm` front width / `405 mm` rear width, `720 mm` outer diameter — tread UV-mapped to `tire_slick_tread`, flat inner/outer sidewall discs UV-mapped radially to `tire_sidewall_soft/medium/hard`) + 18-inch recessed rim barrel & wheel face disc (`wheel_rim_forged`).
      2. **`upright_brake_*`** (does NOT spin with the tire!): Carbon aero brake duct scoop, anodized 6-piston brake caliper, and drilled carbon-carbon brake rotor (`brake_rotor_carbon` + `brake_thermal_mask` emissive glow visible through rim spokes!).

---

### Step 4 — Runtime `GLTFLoader` Ingestion, Crease-Preserving Smooth Normals & Material Upgrade

When loading `f1_car.glb` in Three.js via `GLTFLoader`:

1. **Crease-Preserving Position-Welded Smooth Normals**:
   * `trimesh` glTF exports omit custom split smooth normals. Immediately after load, run a position-welded smooth normal solver across every mesh that averages adjacent triangle normals sharing a vertex position whenever `n_a · n_b > cos(42°)` (`~0.743`). This guarantees glass-smooth reflection lines across curved nosecones, sidepods, halo, and tire shoulders while keeping wing edges, endplates, and diffuser strakes razor-sharp!
   * Explicitly set `material.flatShading = false` on every sub-mesh.
2. **Strict Color-Space & Anisotropy Enforcement**:
   * Bind all Nano Banana albedo and emissive textures with `colorSpace = THREE.SRGBColorSpace` and `anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())`.
   * Bind all Python-derived normal, ORM (`aoMap`, `roughnessMap`, `metalnessMap`), flake normal, and thermal mask textures with `colorSpace = THREE.NoColorSpace` (`Utility - Raw`).
3. **Dual-Layer Physical Material & Shader Upgrades**:
   * Upgrade bodywork meshes to `THREE.MeshPhysicalMaterial` (`clearcoat: 1.0`, `clearcoatRoughness: 0.03`, `ior: 1.5`, `envMapIntensity: 1.35`, plus `car_flake_normal.png` subtle micro-normal perturbation).
   * Upgrade carbon fiber meshes to anisotropic/high-sheen weave shading (`clearcoat: 0.45`, `clearcoatRoughness: 0.14`, `car_carbon_weave` albedo + normal + ORM).
   * Bind dynamic runtime uniform hooks for **tire tread roughness modulation** (cold matte `0.65` → hot scrubbed `0.22`) and **brake rotor blackbody incandescent emission** (`> 600°C`).
   * Enable `castShadow = true` and `receiveShadow = true` on all car sub-meshes.
   * For AI rival cars, clone the loaded `.glb` scene graph and swap only the bodywork livery material (`car_livery_rival_a`, `car_livery_rival_b`, etc.) to reuse geometry buffers cleanly in GPU memory.
4. **Runtime Validation Telemetry**: Immediately log `[F1 GLB & PBR Validation]` with measured bounding box (`L`, `W`, `H`, `minY`), triangle count, verified named articulated nodes (`drs_upper_flap`, `steering_wheel`, 4 `wheel_*_spin`, 2 `wheel_*_steer`, 4 `brake_rotor_*`), and texture color-space audit status.

---

## 3. Deterministic Input Processing, Controls, and Drive-by-Wire Subsystem

### 3.1 Input Ingestion and Event Loop Decoupling
Low-level DOM `keydown` and `keyup` event listeners capture user interaction via the W3C KeyboardEvent interface (supporting both `WASD` and Arrow keys) without blocking on `requestAnimationFrame`. Input states write into a preallocated typed bitmask alongside high-precision `performance.now()` timestamps so the fixed `240 Hz` physics loop interpolates sub-frame inputs cleanly with zero dropped keystrokes.

### 3.2 Speed-Sensitive Steering Dynamics and Filter Architecture
Controlling a hyper-responsive open-wheel race car via digital keys (`A`/`D` or `←`/`→`) requires preventing instantaneous 100% steering lock at `300 km/h` while retaining full hairpin agility. The maximum allowable front-wheel steering angle $\delta_{\max}(v)$ scales dynamically with forward velocity $v$:

$$\delta_{\max}(v) = \delta_{\text{low}} \cdot \left( \frac{v_{\text{threshold}}}{v_{\text{threshold}} + v} \right) + \delta_{\text{high}} \cdot \left( 1 - \frac{v_{\text{threshold}}}{v_{\text{threshold}} + v} \right)$$

where $\delta_{\text{low}} = 22.0^\circ$ (low-speed hairpin lock), $\delta_{\text{high}} = 3.5^\circ$ (high-speed stability lock), and $v_{\text{threshold}} = 25.0\,\text{m/s}$ ($\approx 90\,\text{km/h}$).

The driver steering command $\delta_{\text{target}}(t)$ passes through a continuous asymmetric slew-rate filter:

$$\frac{d\delta}{dt} = \begin{cases} R_{\text{steer\_in}} \cdot (\delta_{\text{target}} - \delta) & \text{if } |\delta_{\text{target}}| > |\delta| \\ R_{\text{steer\_out}} \cdot (\delta_{\text{target}} - \delta) & \text{if } |\delta_{\text{target}}| \le |\delta| \end{cases}$$

with steering attack rate $R_{\text{steer\_in}} = 8.5\,\text{s}^{-1}$ and pneumatic-caster self-centering return rate $R_{\text{steer\_out}} = 14.0\,\text{s}^{-1}$ (exponential return time constant $\tau_{\text{return}} = 1 / 14.0 \approx 0.071\,\text{s}$, settling below $5\%$ of peak lock within $0.22\,\text{s}$ upon key release). Subtle counter-steer stability assist (toggleable in Car Setup) gently damps excessive yaw-rate overshoot for accessible keyboard driving without muting authentic oversteer feel.

### 3.3 Progressive Throttle, Traction Control, Braking & Reverse Systems
* **Progressive Throttle Profile (`KeyW` / `ArrowUp`)**: Pressing throttle initiates a polynomial drive-by-wire spool ramp:

  $$\tau_{\text{throttle}}(t) = \min\left(1.0, \, \left(\frac{\Delta t_{\text{held}}}{T_{\text{spool}}}\right)^{1.8}\right), \quad T_{\text{spool}} = 0.35\,\text{s}$$

  In Gears 1–3, toggleable algorithmic traction control monitors rear-wheel slip ratios $\kappa_{\text{rear}}$ and attenuates peak torque above $\kappa > 0.14$ to prevent instant terminal snap-oversteer on digital throttle taps.
* **Progressive Braking Profile (`KeyS` / `ArrowDown`)**: Linear brake hydraulic pressure ramp to 100% over $0.12\,\text{s}$, capable of $> 5.0\,\text{g}$ peak deceleration at high downforce speeds. Dynamic brake bias splits front/rear clamping force at $56.5\%$ front / $43.5\%$ rear, shifting dynamically forward under nose-dive pitch transfer; toggleable anti-lock modulation prevents catastrophic wheel lock while still permitting threshold tire smoke/skid marks when ABS is disabled or threshold-braking hard.
* **Automatic Gear Selection & Reverse Transition**: Automatic 8-speed seamless shifting is active by default (optional manual shifting via `Q`/`E` or `Z`/`X`). When forward velocity drops below $0.5\,\text{m/s}$ while `S` / `ArrowDown` remains held, the gearbox shifts cleanly through neutral into Reverse (`max 25 km/h`). Pressing `W` / `ArrowUp` instantaneously engages 1st gear.

### 3.4 Complete Control & Hotkey Matrix

| Key Input | Primary Control / Function | Dynamic Mapping / Behavior | Physical / Runtime Output |
| :--- | :--- | :--- | :--- |
| **`W` / `↑`** | Longitudinal Throttle | Polynomial ramp ($t^{1.8}$) over $0.35\,\text{s}$ | V6 ICE + MGU-K Hybrid Torque (`0–745 kW`) |
| **`S` / `↓`** | Longitudinal Brake / Reverse | Linear ramp over $0.12\,\text{s}$; auto-reverse at $v < 0.5\,\text{m/s}$ | Hydraulic calipers (`0–120 bar`, `56.5%/43.5%` bias) / Reverse |
| **`A` / `←`** | Lateral Steer Left | Speed-sensitive $\delta_{\max}(v)$ + asymmetric slew (`8.5` / `14.0 s⁻¹`) | Front knuckle yaw $+\delta \in [0^\circ, 22^\circ]$ + steering wheel |
| **`D` / `→`** | Lateral Steer Right | Speed-sensitive $\delta_{\max}(v)$ + asymmetric slew (`8.5` / `14.0 s⁻¹`) | Front knuckle yaw $-\delta \in [0^\circ, -22^\circ]$ + steering wheel |
| **`Space`** | DRS Flap Toggle (or Start Race in Showroom) | Activates when inside designated DRS zones (or anywhere in Free Practice); auto-closes immediately on braking | Rear wing `drs_upper_flap` tilts `+28°`, reducing $C_d$ by `30%` |
| **`C` / `V`** | Cycle Camera Rig | Seamless transition across Chase → Cockpit → TV Broadcast Pod | Updates active camera delegate & HUD pill |
| **`B`** | Rear-View Look Behind | Momentary hold reverses Chase/Pod camera rearward | Rear mirror/chase view while held |
| **`R`** | Track Recovery Reset | Repositions car cleanly onto nearest circuit spline centerline aligned with track tangent at `0 km/h` | Resets stuck/off-track vehicle cleanly |
| **`Q` / `E`** | Optional Manual Downshift / Upshift | Active when Manual Gearbox toggled in Car Setup | Shifts gears `R / 1–8` with rev-match blip / ignition cut |
| **`M`** | Toggle Audio Mute | Cleanly mutes/unmutes procedural Web Audio master gain | Master gain smooth ramp (`50 ms`) |
| **`P` / `Esc`** | Pause / Resume | Freezes `240 Hz` physics loop and opens gray-and-white pause overlay | Transitions `ACTIVE_RACING ↔ PAUSED` |

---

## 4. Motorsport Vehicle Dynamics, Hybrid Powertrain, and Aerodynamic Simulation

### 4.1 Chassis Architecture and Inertial Distribution
The simulated vehicle conforms to modern FIA regulation Formula 1 engineering metrics:
* Total Minimum Mass ($m$): $798.0\,\text{kg}$ (chassis, hybrid power unit, driver, fluids).
* Static Weight Distribution: $45.5\%$ front axle ($363.1\,\text{kg}$), $54.5\%$ rear axle ($434.9\,\text{kg}$).
* Wheelbase ($L$): $3.600\,\text{m}$; Track Widths: Front $w_f = 1.600\,\text{m}$, Rear $w_r = 1.550\,\text{m}$.
* Center of Gravity Height ($h_{\text{CoG}}$): $0.310\,\text{m}$; Effective Tire Radius ($r_{\text{eff}}$): $0.360\,\text{m}$.
* Yaw Moment of Inertia ($I_{zz}$): $1,150.0\,\text{kg}\cdot\text{m}^2$.

### 4.2 1.6L V6 Turbo-Hybrid Powertrain & 8-Speed Seamless Gearbox
* **Power Unit Output**: Modeled 1.6L V6 Turbo Internal Combustion Engine (`~625 kW`) paired with `120 kW` MGU-K electric deployment for **`745 kW` (`~1,000 hp`)** combined peak power across `10,500–12,500 RPM` (idle `4,000 RPM`, rev limiter `13,500 RPM`), with realistic `92%` drivetrain efficiency (`~685 kW` at the rear wheels).
* **8-Speed Seamless Gear Ratios** (final drive ratio $G_{\text{final}} = 3.42$, shift cut duration `40 ms`):
  * `G1: 3.10`, `G2: 2.48`, `G3: 2.02`, `G4: 1.66`, `G5: 1.38`, `G6: 1.18`, `G7: 1.02`, `G8: 0.89`, `Rev: -2.85`.
  * Automatic upshift threshold: `12,200 RPM`; downshift threshold: `7,800 RPM` (with throttle-blip rev matching).
* **Target Acceleration & Top-Speed Calibration Benchmarks**:
  * `0 → 100 km/h`: **`2.4–2.8 s`**; `0 → 200 km/h`: **`4.5–5.3 s`**.
  * Terminal Straight-Line Speed (DRS Closed): **`~318–325 km/h`**.
  * Terminal Straight-Line Speed (DRS Open): **`~342–355 km/h`**.

### 4.3 Aerodynamic Downforce, Drag, and DRS Physics
Aerodynamic loads resolve at the center of pressure ($42.0\%$ front / $58.0\%$ rear):

$$F_{\text{downforce}} = \frac{1}{2} \, \rho \, A \, C_L \, v^2, \qquad F_{\text{drag}} = \frac{1}{2} \, \rho \, A \, C_d \, v^2$$

with sea-level air density $\rho = 1.225\,\text{kg/m}^3$, effective frontal area $A = 1.65\,\text{m}^2$, nominal $C_L = 3.20$, and nominal $C_d = 0.95$. At $v = 83.33\,\text{m/s}$ ($300\,\text{km/h}$), the chassis generates approximately **$22,450\,\text{N}$** of vertical downforce ($\approx 2.87\times$ its $7,828\,\text{N}$ static weight) and $6,667\,\text{N}$ of aerodynamic drag.

Activating **DRS** tilts `drs_upper_flap` to `+28°`, reducing rear-wing downforce contribution by $22\%$ and overall vehicle drag coefficient $C_d$ by $30\%$ ($C_{d,\text{DRS}} = 0.665$), delivering a `+20–28 km/h` top-speed boost on long straights. DRS closes instantaneously upon braking input (`brake > 0.05`) or high lateral acceleration (`|a_y| > 2.2 g`).

### 4.4 Pacejka Magic Formula Tires, Compound Curves & Low-Speed Stability Guard
Lateral cornering force $F_y$ and longitudinal force $F_x$ evaluate via Hans B. Pacejka's Magic Formula:

$$F_y(\alpha) = D_y \sin\left( C_y \arctan\left( B_y \alpha - E_y (B_y \alpha - \arctan(B_y \alpha)) \right) \right)$$

with $D_y = \mu_{\text{eff}} \cdot F_z$, $C_y = 1.30$, $B_y = \frac{K_{y0}}{C_y D_y}$, and $E_y = -0.22$, coupled with longitudinal slip force $F_x(\kappa)$ and bounded strictly by the combined friction ellipse:

$$\left( \frac{F_x}{F_{x,\max}} \right)^2 + \left( \frac{F_y}{F_{y,\max}} \right)^2 \le 1.0$$

* **Mandatory Low-Speed Numerical Stability Regularization**: To completely prevent division-by-zero `NaN` explosions and standstill lateral jitter when $v_x \to 0$, slip ratio and slip angle MUST be regularized:

  $$\kappa = \frac{\omega r_{\text{eff}} - v_x}{\max(|v_x|, \, v_{\text{eps}})}, \qquad \alpha = \arctan2\left(v_y, \, \max(|v_x|, \, v_{\text{eps}})\right), \qquad v_{\text{eps}} = 1.5\,\text{m/s}$$

  Below $\|v\| < 1.0\,\text{m/s}$ with zero throttle and active brake/idle, apply smooth viscous static friction clamping so the car holds dead-still on the starting grid with zero drift.
* **Pirelli Slick Compounds** (selectable in Showroom / Car Setup, visually linked to the 3 Nano Banana sidewall variants):
  * **Soft (Red Ring)**: Peak $\mu_y = 1.82$, rapid warm-up, optimal window `90–108°C`.
  * **Medium (Yellow Ring)**: Peak $\mu_y = 1.74$, balanced durability, optimal window `95–112°C`.
  * **Hard (White Ring)**: Peak $\mu_y = 1.66$, high thermal stability, optimal window `100–118°C`.

### 4.5 Suspension Kinematics, Weight Transfer, and Coupled Thermal Models
* **4-Wheel Independent Pushrod Suspension**: Four vertical suspension raycasts (or analytical spline heightfield queries) resolve wheel compression $z_i$, spring-damper forces, and dynamic ride height. Dynamic axle loads combine static weight, aerodynamic downforce ($42\%/58\%$), and inertial weight transfer:

  $$\Delta F_{z,\text{longitudinal}} = \frac{m \cdot a_x \cdot h_{\text{CoG}}}{L}, \qquad \Delta F_{z,\text{lateral}} = \frac{m \cdot a_y \cdot h_{\text{CoG}}}{w}$$

  with tuned anti-roll bars ($K_{\text{arb,front}} = 450\,\text{N/mm}$, $K_{\text{arb,rear}} = 220\,\text{N/mm}$). Visual pitch (`±1.6°`), roll (`±1.2°`), and vertical heave ride-height compression drive the chassis mesh and individual wheel vertical offsets directly.
* **Coupled Tire & Brake Thermal Simulation**:
  * **Tire Surface Temp ($T_{\text{tire}}$)**: Ambient `65°C` (pre-heated blankets on grid) rising via slip work $|\kappa F_x| + |\alpha F_y|$ and cooling via airflow toward ambient. Modulates both $\mu_{\text{eff}}(T_{\text{tire}})$ and tire tread shader roughness (`0.65` cold matte → `0.22` scrubbed hot rubber).
  * **Carbon-Carbon Brake Rotor Temp ($T_{\text{brake}}$)**: Ambient `220°C` heating rapidly under braking power $P_{\text{brake}} \propto F_{\text{brake}} \cdot v$ up to `1,050°C`, cooling via convective airflow ($\propto v^{1.6}(T_{\text{brake}} - T_{\text{amb}})$). Directly drives the glowing blackbody brake rotor shader above `600°C`.

---

## 5. Physically Based Rendering (PBR), Dual-Layer Car Paint & Motorsport Materials

### 5.1 Thermodynamic Cook-Torrance Microfacet BRDF
All shaders enforce strict energy conservation via the Cook-Torrance BRDF:

$$f_r(\omega_i, \omega_o) = k_d \frac{c}{\pi} + k_s \frac{D_{\text{GGX}}(h, \alpha) \, F(\omega_o, h) \, G(\omega_i, \omega_o, h)}{4 \, |n \cdot \omega_i| \, |n \cdot \omega_o|}$$

with $k_d = (1 - k_s)(1 - \text{metallic})$, GGX normal distribution ($\alpha = \text{Roughness}^2$), height-correlated Smith-GGX masking-shadowing, and Schlick Fresnel ($F_0 = 0.04$ dielectrics, $F_0 = \text{BaseColor}$ conductive metals).

### 5.2 Dual-Layer Car Paint & Specialized Motorsport Formulations (Wired to Nano Banana Maps)
Every hero vehicle surface binds its Nano Banana albedo (`SRGBColorSpace`) and Python-derived Normal/ORM maps (`NoColorSpace`) into tailored physical materials:

* **Multi-Layer F1 Livery Car Paint** (`car_livery_player` / `car_livery_rival_*` + `*_normal` + `*_orm` + `car_flake_normal`):
  * Implemented via `THREE.MeshPhysicalMaterial` dual-lobe clearcoat (aligned with Google Filament's clearcoat layer and Kelemen visibility $V_{\text{clearcoat}}(l, h) = \frac{1}{4(l \cdot h)^2}$ in custom shaders).
  * **Top Polyurethane Clearcoat**: `clearcoat: 1.0`, `clearcoatRoughness: 0.03`, `ior: 1.5` producing crisp razor-sharp sky and trackside specular reflections.
  * **Metallic Flake Basecoat**: Unreflected radiance attenuated by $(1 - F_{\text{clearcoat}})$ strikes the metallic livery map perturbed by high-frequency `car_flake_normal.png` micro-normals, creating realistic sparkling aluminum flake highlights under direct sunlight.
* **Exposed 2x2 Weave Carbon Fiber** (`car_carbon_weave` + `*_normal` + `*_orm`):
  * Applied to front/rear wings, Venturi floor, diffuser, halo, mirrors, and wishbones. Configured with satin-gloss resin clearcoat (`clearcoat: 0.45`, `clearcoatRoughness: 0.14`) and directional weave micro-roughness variation ($\alpha_x \approx 0.15$, $\alpha_y \approx 0.45$ via anisotropic highlight or normal/ORM contrast).
* **Pirelli Racing Slicks** (`tire_slick_tread`, `tire_sidewall_{soft,medium,hard}` + `*_normal` + `*_orm`):
  * Pure dielectric (`metalness: 0.0`, $F_0 = 0.04$, charcoal rubber albedo clamped around `[48–62]` sRGB). Dynamic tread roughness smoothly interpolates from `0.65` (fresh/cold matte) down to `0.22` (hot scrubbed contact sheen) based on live $T_{\text{tire}}$.
* **18-Inch Forged Magnesium Wheel Rims** (`wheel_rim_forged` + `*_normal` + `*_orm`):
  * High-contrast conductive spokes/center-lock nut (`metalness` from ORM blue channel, specular F0 within `[180, 255]` sRGB, roughness `0.20–0.32`) contrasted against matte carbon outer aero lips.
* **Thermal-Emissive Carbon-Carbon Brake Rotors** (`brake_rotor_carbon` + `*_normal` + `brake_thermal_mask`):
  * Ambient dark matte carbon (`roughness: 0.70`, `metalness: 0.0`). Above $T_{\text{brake}} > 600^\circ\text{C}$, custom emissive intensity evaluates blackbody radiation masked to the friction annulus via `brake_thermal_mask`:

  $$I_{\text{emissive}}(T) = \text{BlackBodyColor}(T) \cdot \left( \frac{\max(0, \, T - 600)}{450} \right)^{2.6}$$

  transitioning smoothly from deep cherry-red (`650°C`) to bright incandescent orange-yellow (`1,000°C+`) visible cleanly through the wheel rim spokes and interacting with the bloom pass.

---

## 6. Grand Prix Circuit Architecture, Track Shading, Lighting & AI Opponents

### 6.1 Closed FIA Grade 1 Spline Circuit (Tokyo Grand Prix Circuit)
Build a complete, closed, $C^2$-continuous Catmull-Rom / cubic Hermite spline FIA Grade 1 Grand Prix circuit (`~4.1–4.5 km` total centerline length, `14.0 m` uniform asphalt width, `±11 m` undulating elevation profile, subtle `2°–4°` corner banking):

* **Sector 1**: `850 m` Main Start/Finish Straight (**DRS Zone 1** with painted grid boxes, pit lane apron, and 5-light FIA start gantry) → heavy-braking **Turn 1** right-hander (`150m / 100m / 50m` braking boards) → flowing high-speed **S-Curves** (`Turns 2–5`) demanding maximum aerodynamic downforce.
* **Sector 2**: Fast downhill sweeper (`Turn 6`) → heavy threshold-braking **Hairpin** (`Turn 7`, prime brake-glow zone!) → technical medium-speed double-apex left (`Turns 8–9`).
* **Sector 3**: `720 m` Back Straight (**DRS Zone 2**, top speeds `> 345 km/h`) → tight high-kerb **Chicane** (`Turns 10–11`) → sweeping full-throttle final corner (`Turn 12`) back onto the main straight.

#### Surface Grip Classification & Sliding Barrier Collisions
Every wheel dynamically classifies its lateral offset $d_{\text{lat}}$ from the spline centerline to select physical friction and acoustic feedback:

| Track Surface Zone | Lateral Offset Band | Grip Multiplier ($\mu$) | Rolling Drag Multiplier | Tactile / Visual Effect |
| :--- | :--- | :---: | :---: | :--- |
| **Rubbered Racing Line** | Ideal spline corridor (`±2.2 m`) | `1.05` | `1.00` | Darkened rubber sheen on asphalt |
| **Main FIA Asphalt** | `|d_lat| <= 7.0 m` | `1.00` | `1.00` | Base crushed basalt grip |
| **FIA Rumble Kerbs** | Apex/Exit inner/outer strips (`7.0–8.2 m`) | `0.88` | `1.08` | Suspension vertical ripple impulse + rumble audio |
| **Manicured Grass Verge** | `8.2–12.5 m` (non-gravel zones) | `0.48` | `2.60` | Green dust particles + muffled turf sound |
| **FIA Gravel Trap** | Heavy-braking runoff exteriors | `0.36` | `4.80` | Rapid deceleration + pebble spray |
| **Tecpro / Armco Barriers** | Outer circuit boundary (`|d_lat| >= boundary`) | Sliding wall contact | Restitution `0.22` | Smooth tangential slide along barrier normal (zero tunneling, zero sticking) + metallic scrape sparks |

### 6.2 Multi-Frequency Asphalt Shading, Kerbs & Dynamic Track Elements
* **Multi-Frequency Height-Blended Asphalt**: Combine the Nano Banana `track_asphalt_aggregate` albedo + normal + ORM maps using stochastic multi-angle UV blending to eliminate visible tiling along straights, layered with:
  1. **Macro Vertex/Spline Variation**: Darkened rubbered-in racing line tracing the optimal apex path plus subtle sector aging variation.
  2. **Medium Aggregate & Bitumen Blending**: Procedural height transition $\text{Mask}_{\text{blend}} = \text{saturate}((\text{Height}_{\text{agg}} - \text{Height}_{\text{bit}} + \text{Blend}) / \text{Sharpness})$.
  3. **Distance Roughness Compensation**: Prevents oblique horizon specular washout down long straights.
* **Championship Trackside Set Pieces**:
  * **FIA Chamfered Kerbs**: Raised geometric kerb strips along all corner apexes and exits textured with Nano Banana `track_kerb_fia` + Sobel normal.
  * **GPU-Instanced Skid Marks**: Ring-buffered decal ribbons projected `0.004 m` above the asphalt whenever tire slip exceeds threshold (`|κ| > 0.20` or `|α| > 11°`).
  * **Circuit Architecture**: 5-light FIA start/finish gantry with live emissive countdown lamps, pit-lane building & pit wall, instanced grandstands, overhead sponsor bridges (`track_barrier_sponsor`), `150m / 100m / 50m` braking marker boards, white painted track limit lines & starting grid boxes, safety catchfences, and distant scenic hills/skyline framing the horizon cleanly with zero void edges.

### 6.3 Real-Time Lighting, Shadows & Atmospheric Sky
* **Physical Sky Dome & PMREM HDRI**: Procedural Rayleigh/Mie atmospheric sky dome (solar elevation adjustable in Setup, default crisp late-afternoon `28°` for dramatic livery reflections and long racing shadows) convolved into a `PMREMGenerator` environment cubemap for accurate clearcoat and chrome reflections.
* **Directional Solar Light & Vehicle-Locked Shadow Frustum**: Analytical sunlight casting high-resolution `2048×2048` `PCFSoftShadowMap` shadows whose orthographic shadow camera tracks the hero car tightly (`±38 m` frustum, texel-snapped to eliminate shadow swimming) so front-wing and wheel contact shadows stay razor-sharp at `340 km/h`.

### 6.4 Multi-Livery AI Competitors
Populate the starting grid with **3–5 AI Formula 1 cars** sharing the parametric `.glb` mesh with distinct Nano Banana rival liveries (`car_livery_rival_a`, `car_livery_rival_b`, plus clean tinted variants) and rotating wheels/steering:
* Driven by look-ahead pure-pursuit spline steering with corner-curvature velocity profiling, lateral lane offsets for clean overtaking/collision avoidance, and slipstream visual excitement.
* Users can toggle between **Grand Prix Race (AI Grid)** and **Solo Time Trial** seamlessly in the Car Setup popover.

---

## 7. Color Management, PBR Validation, and Runtime Asset Budgets

### 7.1 ACES Filmic Linear Pipeline & Strict Color-Space Isolation
* **Tone Mapping & Output**: `renderer.toneMapping = THREE.ACESFilmicToneMapping`, `renderer.outputColorSpace = THREE.SRGBColorSpace`, calibrated exposure (`~1.05`) preventing chromatic clipping on bright sky reflections and incandescent brake rotors.
* **Color Textures (`Utility - sRGB - Texture`)**: Every Nano Banana albedo and emissive map MUST explicitly set `THREE.SRGBColorSpace`.
* **Non-Color Data Textures (`Utility - Raw`)**: Every Normal, ORM (`aoMap`, `roughnessMap`, `metalnessMap`), flake normal, and thermal mask MUST explicitly remain in `THREE.NoColorSpace`.
* **Live PBR Reflectance Compliance Registry**: Every registered vehicle and circuit material exports its validated sRGB bounds (`[30, 240]` dielectric, `[180, 255]` conductive metal, binary metallicity) into a live audit table inspectable inside the Telemetry & PBR Inspector modal dialog.

### 7.2 Web Geometric & Memory Budgets

| Asset Layer | Geometric Budget | Texture Budget & Formats | Optimization Strategy |
| :--- | :--- | :--- | :--- |
| **Hero F1 Car (`f1_car.glb`)** | `25,000–65,000` Triangles | Nano Banana `1024×1024` `.png`/`.jpg` albedo + coupled Normal & ORM maps (`512×512` brake/flake) | Shared `.glb` geometry instanced/cloned across AI rival cars with swapped livery materials |
| **Grand Prix Circuit Mesh** | `35,000–85,000` Triangles | `1024×1024` seamless asphalt & kerb pairs; `512×512` grass & gravel | Continuous spline ribbon + instanced kerbs, braking boards, grandstands, trees, and barriers |
| **Dynamic FX Pools** | `<= 2,000` Sparks + `<= 600` Smoke + `<= 1,200` Skid quads | Lightweight procedural soft-glow / spark sprites | Preallocated GPU `InstancedMesh` / ring buffers with zero per-frame JS garbage collection |

---

## 8. Cinematic Cameras, Post-Processing, Procedural F1 Audio & Gray-and-White UI

### 8.1 4-Mode Camera Director
The camera subsystem orchestrates four seamless optical perspectives:
1. **`Camera_Showroom_Orbit` (Pre-Grid Inspection)**: Smooth pointer-drag orbit and scroll-zoom rig centered on the hero F1 car (`radius 3.2–9.0 m`) for close-up inspection of Nano Banana livery, carbon fiber, Pirelli sidewalls, rims, and brake calipers.
2. **`Camera_Chase_ThirdPerson` (Driving Default)**: Positioned `4.9 m` behind (`+Z`) and `1.45 m` above (`+Y`) the car on a damped spring arm that widens FOV dynamically (`54° → 70°` with speed), pulls slightly back under hard acceleration, leans subtly into lateral $g$-forces, and smoothly resists barrier clipping.
3. **`Camera_Cockpit_Halo` (First-Person Driver Eye)**: Positioned at driver eye level (`(0, 0.72, -0.05)`) behind the central titanium Halo pillar and carbon steering wheel OLED display, incorporating road vibration and smooth corner-apex look-ahead.
4. **`Camera_TV_Broadcast_Pod` (Onboard T-Cam)**: Classic F1 broadcast mount atop the airbox intake (`(0, 1.12, +0.28)`), framing the driver's Nano Banana helmet, Halo, and full front-wheel steering & suspension articulation.

### 8.2 High-Speed Post-Processing & Underbody Titanium Spark Cascades
* **Physically Based Bloom**: Subtle selective bloom highlighting solar glints off clearcoat bodywork, FIA start lights, the flashing rear rain light, glowing incandescent brake discs (`> 600°C`), and titanium sparks.
* **Speed Sensation Effects**: Subtle speed-proportional peripheral vignette and optional directional speed/motion streak or light chromatic aberration (`<= 1.2 px`), **strictly disabled** when `prefers-reduced-motion: reduce` is active.
* **Underbody Titanium Spark Cascades**: When high-speed downforce + bump/kerb compression lowers ride height below `8 mm` (or during barrier scrapes), a preallocated GPU-instanced pool emits up to `2,000` glowing ballistic spark streaks governed by gravity, aerodynamic drag, and track bounces, paired with a dynamic flickering orange point-light proxy illuminating the rear diffuser and asphalt!
* **Tire Lockup & Wheelspin Smoke**: Preallocated billboard particle pool emitting light warm-gray rubber smoke from locked or spinning contact patches.

### 8.3 Gesture-Gated Procedural F1 Web Audio
Synthesize 100% of motorsport audio procedurally via the Web Audio API with zero external audio files (cleanly unlocked on first user gesture and honoring `M` mute):
* **1.6L V6 Turbo-Hybrid Power Unit**: Layered sawtooth/triangle fundamental + 3rd/6th firing-order harmonics routed through RPM-tracking resonant exhaust bandpass filters, plus a high-frequency turbocharger spool whistle (`2.5–7.5 kHz`) and subtle MGU-K electric whine during acceleration and braking regeneration.
* **Gearbox & Chassis Acoustics**: Crisp `40 ms` upshift ignition-cut crack, downshift rev-match throttle blip, slip-proportional filtered tire scrub/screech, quadratic-speed aerodynamic wind rush, `30–65 Hz` kerb rumble oscillator on kerb contact, and high-frequency spark/barrier scrape noise bursts.

### 8.4 Modern Gray-and-White Broadcast Telemetry UI
* **Visual Theme**: Crisp **gray-and-white motorsport studio aesthetic** — translucent frosted white/light-gray glass panels (`rgba(248, 249, 251, 0.88)` with `backdrop-filter: blur(12px)`), deep charcoal typography (`#111315`), hairline slate borders (`#d6dae0`), `font-variant-numeric: tabular-nums` on every counter, CSS Cascade Layers (`@layer`), `100dvw × 100dvh` viewport lock, and full `prefers-reduced-motion` compliance. Accent hues are reserved strictly for functional FIA telemetry semantics (RPM shift LEDs, DRS active green pill, Pirelli Red/Yellow/White compound ring, and Purple/Green sector deltas).
* **Top Broadcast Bar**: Circuit title (`Tokyo GP`), Position (`P1 / 4` or `TIME TRIAL`), Lap Counter (`LAP 1 / 3`), Live Lap Timer + Best Lap + `S1/S2/S3` badges, Active Camera pill (`C`), `Audio (M)`, **`Showroom`**, **`Car Setup`**, and **`Inspector`**.
* **Bottom Telemetry Dock & Circuit Minimap**:
  * Compact central F1 telemetry cluster: large Speed (`km/h`), Gear (`R/N/1–8`), horizontal RPM LED shift bar, Throttle & Brake vertical bars, live `DRS` pill (`READY / OPEN / LOCKED`), Tire Compound badge + live `T_tire` (`°C`), and Brake Temp (`°C`).
  * Clean corner **Circuit Minimap** (SVG/Canvas) rendering the exact spline loop, Start/Finish line, DRS zones, and real-time player + AI car dots.
* **Declarative Popover & Modal Dialog**:
  * **`#setup-popover`** (`popover="auto"`): Tire Compound selector (`Soft` / `Medium` / `Hard` — swaps Nano Banana sidewall textures live!), Mode (`AI Grand Prix` / `Solo Time Trial`), Gearbox (`Auto` / `Manual`), Assists (`Traction Control`, `ABS`, `Stability Assist`), and `Solar Elevation` slider (`12°–65°`).
  * **`#inspector-dialog`** (`<dialog closedby="any">`): Collapsible sections displaying live Physics/Aero telemetry (downforce `N`, drag `N`, slip angles, 4-wheel loads, brake/tire temps), `.glb` Asset Validation metrics, and the **Nano Banana PBR Reflectance Compliance Audit** table.

---

## 9. Single-Shot Acceptance Criteria & Mandatory Automated Verification Protocol

Every build MUST satisfy all five acceptance categories AND pass an automated headless Chrome WebGL2 + multi-angle visual inspection gate over the live Flask server before being declared complete.

### 9.1 Nano Banana Texture, `.glb` Geometry & Material Fidelity Gates
* Every texture in the Section 2 Nano Banana Manifest exists on disk, is non-empty, conforms to exact power-of-two dimensions, and has its coupled Python-derived Normal and ORM maps present.
* `f1_car.glb` build assertions pass: length `5.40–5.65 m`, width `1.95–2.02 m`, height `0.94–1.12 m`, all 4 tire contact patches at `Y = 0.000 ± 0.002 m`, `25,000–65,000` triangles, crease-preserving smooth normals active (`flatShading = false`), and all articulated nodes (`drs_upper_flap`, `steering_wheel`, 4 `wheel_*_spin`, 2 `wheel_*_steer`, 4 `upright_brake_*`) verified.
* All Nano Banana albedo/emissive textures load with `THREE.SRGBColorSpace`; all Normal/ORM/flake/thermal maps remain strictly `THREE.NoColorSpace`; all registered materials pass strict PBR bounds (`[30, 240]` sRGB dielectric, `[180, 255]` conductive, binary metallicity).
* Dual-layer clearcoat livery paint, 2x2 weave carbon fiber, Pirelli compound sidewall rings (switching cleanly between Soft/Medium/Hard), forged 18-inch rims, and glowing carbon brake rotors (`> 600°C`) render with unmistakable photorealistic material separation.

### 9.2 Input, Control & Gameplay Loop Gates
* `WASD` and Arrow keys operate with zero dropped inputs; speed-sensitive steering scales smoothly from `22.0°` at standstill to `3.5°` above `250 km/h`, settling below `5%` within `0.22 s` upon key release.
* `Space` toggles DRS (visibly opening `drs_upper_flap` and reducing drag), `C`/`V` cycles all driving cameras cleanly, `R` resets cleanly onto the track spline, `M` toggles procedural audio, and `S` held below `0.5 m/s` engages reverse cleanly.
* Full 5-state FSM (`SHOWROOM_GRID` → `LIGHTS_COUNTDOWN` → `ACTIVE_RACING` → `PAUSED` → `SESSION_SUMMARY`) operates cleanly with 3-sector lap timing and AI rival racing.

### 9.3 Vehicle Dynamics, Powertrain & Stability Gates
* Fixed `240 Hz` solver executes with **zero `NaN` or `Infinity` states** at standstill (`v = 0 km/h` holds rock-solid on the grid with zero lateral drift) and across aggressive driving/braking/barrier contacts.
* Powertrain achieves `0–100 km/h` in `2.4–2.8 s` and `0–200 km/h` in `4.5–5.3 s`.
* Aerodynamic downforce reaches `>= 20,000 N` at `300 km/h`; DRS reduces overall aerodynamic drag by `>= 25%` (`30%` target), adding `+18–28 km/h` along circuit straights.
* Threshold braking from `> 280 km/h` exceeds `4.5 g` deceleration and heats brake rotors above `600°C` triggering visible incandescent orange-red glow.
* Barrier impacts slide smoothly without wall tunneling or permanent sticking.

### 9.4 Web Performance & Zero-Error Runtime Gates
* Application initializes over local Flask HTTP and enters interactive Showroom/Driving mode within `<= 5.0 s`.
* Steady `60+ FPS` frame pacing on standard desktop GPUs at `1080p` (`devicePixelRatio <= 2.0`), zero per-frame GC spikes `> 4.0 ms`, and GPU memory well under `1.0 GB`.
* **Hard Failure Gate**: Browser console MUST report **ZERO uncaught exceptions, ZERO 404 resource errors, and ZERO WebGL/Three.js shader warnings**.

### 9.5 Mandatory Automated Headless Chrome WebGL2 & 6-Pose Visual Verification Gate
Run an automated Node.js CDP verification script against the live Flask server (`http://127.0.0.1:8080/`):
1. Assert `window.__f1SimApp.getAssetValidation().allCompliant === true` (GLB bounds, wheel grounding, Nano Banana texture color spaces, PBR audit pass, zero `NaN` physics).
2. Run a scripted telemetry benchmark verifying standstill stability (`0.0 km/h` drift `< 0.01 m`), full-throttle launch (`0–200 km/h` + DRS top-speed boost), cornering Pacejka lateral G-force, and threshold braking rotor temperature `> 650°C`.
3. Capture and **visually inspect** a 6-shot verification contact sheet (comparing car silhouette & material realism against `references/f1_car_hero_ref.png`):
   * **Pose 1 — Hero 3/4 Showroom Close-Up**: Verify Nano Banana metallic livery, 2x2 carbon weave, Pirelli sidewalls, 18-inch rims, brake discs, halo, and smooth reflections with zero faceting or UV seams.
   * **Pose 2 — Rear-Quarter Diffuser & Open DRS Close-Up**: Verify swan-neck rear wing, tilted `drs_upper_flap`, carbon diffuser strakes, and emissive rain light.
   * **Pose 3 — Chase Camera on Main Straight / Start Grid**: Verify track proportions, FIA 5-light gantry, multi-frequency Nano Banana asphalt, red/white kerbs, AI rival liveries, and crisp gray-and-white HUD readability.
   * **Pose 4 — Cockpit Halo View**: Verify steering wheel OLED faceplate (`cockpit_steering_dash`), Halo framing, mirrors, and unobstructed sightlines.
   * **Pose 5 — TV Broadcast T-Cam Cornering over Kerbs**: Verify front-wheel steering deflection, driver helmet (`driver_helmet_livery`), kerb contact, and tire skid marks.
   * **Pose 6 — High-Speed Threshold Braking Action Shot**: Verify incandescent glowing carbon brake discs visible through rim spokes, underbody titanium spark cascades, and clean bloom/HUD telemetry.
4. Iterate on texture post-processing, UV alignment, or mesh smoothing until visual inspection confirms **zero major visual or geometric defects** and zero console errors.
