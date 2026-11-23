# Fantasy Underwater Swim-Through Specification (`oceanflyby.md`)

Build a real-time, playable fantasy underwater world that runs directly in any modern web browser. The player explores the ocean **as an articulated 3D fish** swimming freely through towering kelp forests, sunlit arches, coral gardens, marine life, and mythic sunken landmarks.

---

## 1. Priorities (In Strict Order When Trade-Offs Arise)

1. **Visual beauty & underwater atmosphere** (rich spectral color absorption, god rays, animated caustics, organic motion, crisp silhouettes)
2. **Fluid, joyful fish movement & browser-universal smooth frame pacing** (responsive aquatic feel, zero GC stutter)
3. **Small, zero-dependency bundle size**

---

## 2. Core Constraints & Browser Compatibility

* **Runs in Any Modern Browser — No Hardware Requirements**: Must run out of the box in standard desktop/laptop browsers (Chrome, Safari, Firefox, Edge on macOS, Windows, or Linux) on integrated or discrete GPUs with zero browser flags, zero proprietary extensions, and no fixed monitor resolution or refresh-rate assumptions.
* **Graphics API**: Use **WebGL2** (recommended for universal cross-browser compatibility) or **WebGPU with automatic WebGL2 fallback** if `navigator.gpu` is unavailable. Do not rely on optional GPU extensions (such as `timestamp-query`) for core functionality.
* **Zero External Engines or Assets**: No Three.js, Babylon.js, or other 3D frameworks. Everything — geometry, shaders, surface detail, animations, and optional underwater ambience — must be **100% procedural** with no external texture, model, or audio files.
* **Single Self-Contained Deliverable**: Deliver a single self-contained `index.html` (report both raw and minified size) that renders immediately at full responsive viewport size (`100dvw × 100dvh`, clamping `devicePixelRatio` cleanly up to `2.0`, with a lightweight quality/resolution toggle if needed so slower devices stay silky smooth).
* **Zero Per-Frame JS Allocations**: Preallocate all typed arrays, matrices, vectors, boid states, and particle buffers up front so the render loop produces no garbage-collection stutter.

---

## 3. Playable Fish Character, Swimming Physics & Camera

### 3.1 Procedural Articulated Hero Fish
* **Appearance**: A luminous, iridescent fantasy reef fish (streamlined hydrodynamic body with vibrant teal/cobalt-to-gold iridescent scales, translucent dorsal, pectoral, and pelvic fins, and a sweeping forked caudal tail fin) that catches underwater caustics and sunlit god rays.
* **Procedural Swimming Kinematics**:
  * Continuous traveling sinusoidal spine wave propagating head-to-tail (`sin(k·z - ω·t)`), where tail beat frequency and lateral amplitude scale smoothly with swim speed and spike dynamically during a burst dash.
  * Realistic body **banking (roll)** into horizontal turns, smooth **nose pitch** during climbs and dives, pectoral fin flaring when braking or hovering, and subtle idle hover fin-feathering when stationary.
  * **Bubble & Bioluminescent Wake**: Rapid dashes and sharp turns shed trailing micro-bubbles and disturb nearby glowing water specks.

### 3.2 Hydrodynamic Movement & World Collision
* **Aquatic Physics**: Smooth thrust acceleration, quadratic water drag, gentle neutral buoyancy drift, and angular turn damping so swimming feels genuinely fluid rather than rigid free-camera noclip.
* **Burst Dash**: Pressing `Shift` (or double-tapping forward) triggers a vigorous tail-kick surge with subtle FOV widening, shimmering fin glow, and a stream of bubbles, smoothly recovering stamina over a brief cooldown.
* **Collision & Surface Ceiling**:
  * Smooth sliding collision against the seafloor, rock canyons, arches, overhangs, floating boulders, sunken ship hull, and stone whale-fluke sculpture so the fish glides naturally around geometry instead of clipping through solid rock.
  * **Wavy Ocean Surface Ceiling**: Swimming upward toward the shimmering surface gently curves the fish back beneath the waves (with a burst of surface bubbles/ripples) rather than flying out into empty sky.
  * **Soft World Boundary**: Gentle natural currents and towering outer canyon silhouettes steer the player organically back inward before any world edge becomes visible.

### 3.3 Camera System
* **Default — Third-Person Fish Chase Camera**: Spring-damped chase camera trailing gracefully behind and slightly above the fish so the player always enjoys their undulating body weaving through kelp and arches. Includes subtle speed-linked lag/FOV response and obstacle push-in so rock walls do not obscure the fish.
* **Camera Toggle (`V`)**: Cycle seamlessly between **Third-Person Swim** (default), **First-Person Fish-Eye**, and **Scenic Free Camera** (for uninterrupted architectural framing).

### 3.4 Living Ecosystem Interaction
* **Reactive Fish Schools**: Boid-flocking schools part gracefully, swirl around the player when swimming gently nearby, and scatter playfully if the player dashes straight through them.
* **Gliding Manta Rays**: Large undulating manta rays cruise serenely through sunlit canyons; the player can swim alongside them.
* **Optional Serene Exploration Trail**: Subtle luminous current rings or bioluminescent pearls placed along scenic routes (through a rock arch, weaving through the sunken ship ribs, circling the stone whale-fluke sculpture, and rising into the sunlit kelp canopy) grant a brief shimmering speed boost and soft procedural chime—guiding natural sightseeing without intrusive arcade HUD clutter.

---

## 4. Underwater World & Visual Direction

* **Towering Kelp Forest**: Dense, tall kelp columns rising toward the surface, gently swaying with depth-phased current waves and accented with sparkling green and gold bioluminescent specks.
* **Spectral Depth Fog & Absorption**: Physically inspired underwater color extinction transitioning smoothly from bright sunlit cyan/turquoise near the surface to rich cobalt and deep abyssal blue across distance and depth (eliminating harsh banding via subtle dithering).
* **Surface Optics, God Rays & Caustics**:
  * Animated wavy water surface visible from below with Snell's window bright sky transmittance and shimmering dark underside ripples.
  * Volumetric-style descending god rays (sun shafts) drifting across canyons and kelp columns.
  * Crisp dual-layer animated underwater caustics projected across terrain, rock formations, sunken landmarks, coral, and the playable fish.
* **Terrain & Mythic Geology**: Sculpted rock canyons, swim-through arches, dramatic overhangs, and surreal floating boulders suspended in the currents.
* **Fantasy Flora**: Iridescent purple/pink foliage, lush magenta ground cover, sculpted barrel sponges, and varied glowing/matte coral formations.
* **Animated Marine Life & Particles**: Undulating manta rays, instanced boid fish schools, rising sparkling bubble columns, and drifting marine snow / bioluminescent plankton.
* **Hero Set Pieces**:
  * A weathered **sunken ship hull** with swim-through hull ribs and broken deck beams.
  * A monumental **stone whale-fluke sculpture** framing a dramatic underwater vista.
* **Bounded Yet Seamless World**: Finite handcrafted ocean biome whose perimeter canyons and deep-blue absorption fog completely conceal boundaries from every playable vantage point.

---

## 5. Controls & Minimal Browser UI

* **Movement & Steering**:
  * `W / S` or `↑ / ↓`: Swim forward / brake & gentle back-paddle
  * `A / D` or `← / →`: Steer & bank left / right
  * **Mouse Look**: Click canvas for smooth Pointer Lock steering, **plus click-and-drag steering fallback** if Pointer Lock is unavailable or exited (ensuring effortless play in any browser/embed)
  * `E / Space` and `Q / C`: Ascend / dive
  * `Shift`: Burst Dash (tail kick + bubble trail)
* **Utility Shortcuts**:
  * `V`: Cycle camera (`Third-Person Fish` / `First-Person` / `Free Camera`)
  * `H`: Hide/show minimal HUD overlay for pure unobstructed screenshots
  * `M`: Toggle optional gesture-gated procedural Web Audio underwater ambience (soft current wash, bubble wake, gentle landmark/pearl chimes)
  * `Esc`: Release pointer lock and reveal a clean, translucent gray-and-white pause/controls card
* **Minimalist Overlay**: Clean, unobtrusive translucent gray-and-white **"Click to Swim"** entry prompt that fades away cleanly on play, leaving >95% of the viewport pure underwater art. Optional compact auto-fading landmark pill and quality toggle (`Auto / High / Eco`).

---

## 6. Verification & Acceptance Gates

### 6.1 Independent Visual Critic Review
* Invoke a separate visual critic pass that inspects **only rendered screenshots and short motion captures** (never code or implementation reasoning).
* Capture **6 fixed scenic camera poses** at standard browser viewport resolution (e.g., `1280×720` or `1920×1080`):
  1. Hero third-person playable fish weaving through towering sunlit kelp columns
  2. Upward view toward the wavy ocean surface, Snell's window, and descending god rays
  3. Rock canyon arches, overhangs, and floating boulders bathed in animated caustics
  4. Iridescent purple/pink coral garden with barrel sponges, magenta ground cover, reactive fish school, and gliding manta ray
  5. Close-up swim-through of the sunken ship hull
  6. Monumental stone whale-fluke sculpture framed in depth fog
* Include a short scripted swim-through clip verifying fluid fish tail undulation, banking turns, bubble wake, and absence of shimmer, aliasing, fog banding, geometry popping, or solid-rock clipping.
* Iterate until the critic reports **no defects above `"minor"`**.

### 6.2 Browser Runtime, Playability & Performance Verification
* **Zero Runtime Errors**: Load `index.html` in a standard modern browser (and headless Chrome verification) and confirm **zero console errors, zero uncaught exceptions, and zero shader compilation/linking warnings**.
* **Playable Fish Functional Audit**: Confirm keyboard/mouse swimming, vertical dive/ascend, burst dash with bubble wake, sliding rock collision, surface ceiling containment, camera mode cycling (`V`), and reactive fish schools all function cleanly.
* **Frame Pacing Telemetry**: Record `requestAnimationFrame` delta times (`performance.now()`) across a 30–60 s scripted swim-through and report **average, 95th percentile, 99th percentile, and max frame time**, confirming steady frame pacing with no GC-spike stutters.

### 6.3 Done Criteria
Complete when all verification gates pass. Deliver:
1. Self-contained `index.html`
2. Raw and minified bundle size
3. Browser frame-time telemetry summary
4. Visual critic's final review across all 6 poses and the swim-through clip