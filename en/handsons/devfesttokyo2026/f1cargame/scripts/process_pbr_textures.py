"""Step 2 Offline PBR Texture Pipeline for Tokyo GP Formula 1 Simulation.

Reads raw Nano Banana PNG albedo plates from `textures_raw/`, resizes to exact
power-of-two target dimensions, applies seamless toroidal cross-fade blending on
tileable textures, enforces strict PBR sRGB reflectance bounds ([30, 240]
dielectric, [180, 255] conductive metal pixels), synthesizes coupled OpenGL +Y
tangent-space Scharr normal maps (`*_normal.png`) and linear channel-packed ORM
maps (`*_orm.png`: R=AO, G=Roughness, B=binary 0/255 Metalness), generates
auxiliary motorsport maps (`car_flake_normal.png`, 3 Pirelli compound sidewalls,
`brake_thermal_mask.png`), and writes `textures/pbr_manifest.json`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
from PIL import Image
from scipy.ndimage import binary_closing, binary_opening, correlate, gaussian_filter

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "textures_raw"
OUT_DIR = BASE_DIR / "textures"

# Normalized 3x3 Scharr gradient kernels (used with scipy.ndimage.correlate)
# correlate computes +dH/dcol (+U right) and +dH/drow (-V down in image space).
SCHARR_X = np.array(
    [
        [-3.0, 0.0, 3.0],
        [-10.0, 0.0, 10.0],
        [-3.0, 0.0, 3.0],
    ],
    dtype=np.float32,
) / 32.0

SCHARR_Y = np.array(
    [
        [-3.0, -10.0, -3.0],
        [0.0, 0.0, 0.0],
        [3.0, 10.0, 3.0],
    ],
    dtype=np.float32,
) / 32.0


@dataclass(frozen=True)
class TextureSpec:
    name: str
    width: int
    height: int
    tileable: bool
    metal_mode: Literal["dielectric", "mixed"]
    bump: float
    rough_min: float
    rough_max: float
    flatten_lowfreq: bool = False
    target_charcoal: tuple[float, float] | None = None


TEXTURE_SPECS: list[TextureSpec] = [
    TextureSpec("car_carbon_weave", 1024, 1024, True, "dielectric", 2.2, 0.20, 0.42, flatten_lowfreq=True),
    TextureSpec("car_livery_player", 1024, 1024, False, "dielectric", 1.1, 0.18, 0.32),
    TextureSpec("car_livery_rival_a", 1024, 1024, False, "dielectric", 1.1, 0.18, 0.32),
    TextureSpec("car_livery_rival_b", 1024, 1024, False, "dielectric", 1.1, 0.18, 0.32),
    TextureSpec(
        "tire_slick_tread",
        1024,
        1024,
        True,
        "dielectric",
        1.8,
        0.42,
        0.65,
        flatten_lowfreq=True,
        target_charcoal=(36.0, 72.0),
    ),
    TextureSpec("tire_sidewall_pirelli", 1024, 1024, False, "dielectric", 2.0, 0.48, 0.68),
    TextureSpec("wheel_rim_forged", 1024, 1024, False, "mixed", 2.2, 0.18, 0.34),
    TextureSpec("brake_rotor_carbon", 512, 512, False, "dielectric", 3.0, 0.62, 0.78),
    TextureSpec("driver_helmet_livery", 1024, 1024, False, "dielectric", 0.9, 0.10, 0.24),
    TextureSpec("cockpit_steering_dash", 1024, 512, False, "dielectric", 1.6, 0.28, 0.55),
    TextureSpec("track_asphalt_aggregate", 1024, 1024, True, "dielectric", 3.4, 0.60, 0.88, flatten_lowfreq=True),
    TextureSpec("track_kerb_fia", 1024, 1024, True, "dielectric", 2.6, 0.55, 0.75, flatten_lowfreq=False),
    TextureSpec("track_barrier_sponsor", 1024, 512, False, "dielectric", 1.4, 0.35, 0.55),
    TextureSpec("env_grass_verge", 512, 512, True, "dielectric", 2.4, 0.72, 0.92, flatten_lowfreq=True),
    TextureSpec("env_gravel_trap", 512, 512, True, "dielectric", 3.8, 0.78, 0.94, flatten_lowfreq=True),
]


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-12), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)).astype(np.float32)


def find_raw_image(name: str) -> Path:
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        cand = RAW_DIR / f"{name}{ext}"
        if cand.exists():
            return cand
    raise FileNotFoundError(
        f"Missing raw Nano Banana texture for '{name}' in {RAW_DIR} "
        f"(checked .png/.jpg/.jpeg/.webp)."
    )


def load_and_resize(path: Path, target_w: int, target_h: int) -> np.ndarray:
    """Loads an RGB image and resizes cleanly with LANCZOS to exact POT size."""
    img = Image.open(path).convert("RGB")
    src_w, src_h = img.size
    src_aspect = src_w / max(src_h, 1)
    dst_aspect = target_w / max(target_h, 1)

    # Center-crop only if aspect mismatch exceeds 18% (preserves full 16:9->2:1 graphic borders).
    if abs(src_aspect / dst_aspect - 1.0) > 0.18:
        if src_aspect > dst_aspect:
            crop_w = int(round(src_h * dst_aspect))
            left = (src_w - crop_w) // 2
            img = img.crop((left, 0, left + crop_w, src_h))
        else:
            crop_h = int(round(src_w / dst_aspect))
            top = (src_h - crop_h) // 2
            img = img.crop((0, top, src_w, top + crop_h))

    if img.size != (target_w, target_h):
        img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
    return np.asarray(img, dtype=np.float32)


def flatten_macro_illumination(rgb: np.ndarray, strength: float = 0.55) -> np.ndarray:
    """Gently equalizes ultra-low-frequency studio vignette before toroidal blending."""
    h, w, _ = rgb.shape
    sigma = float(min(h, w)) * 0.18
    out = np.empty_like(rgb)
    for c in range(3):
        ch = rgb[:, :, c]
        low = gaussian_filter(ch, sigma=sigma, mode="reflect")
        mean_val = float(ch.mean())
        out[:, :, c] = ch - strength * (low - mean_val)
    return np.clip(out, 0.0, 255.0)


def make_seamless_toroidal(rgb: np.ndarray, band_frac: float = 0.14) -> np.ndarray:
    """Toroidal half-period roll + smooth cosine feathering across a 14% edge band.

    Eliminates both horizontal and vertical seams when tiled under high UV repeats.
    """
    h, w, _ = rgb.shape
    band_x = max(2, int(round(band_frac * w)))
    band_y = max(2, int(round(band_frac * h)))

    x = np.arange(w, dtype=np.float32)
    dx = np.minimum(x, w - x)
    wx = np.where(dx < band_x, 0.5 * (1.0 + np.cos(np.pi * dx / band_x)), 0.0).astype(np.float32)
    wx = wx[None, :, None]
    blend_x = (1.0 - wx) * rgb + wx * np.roll(rgb, shift=w // 2, axis=1)

    y = np.arange(h, dtype=np.float32)
    dy = np.minimum(y, h - y)
    wy = np.where(dy < band_y, 0.5 * (1.0 + np.cos(np.pi * dy / band_y)), 0.0).astype(np.float32)
    wy = wy[:, None, None]
    blend_xy = (1.0 - wy) * blend_x + wy * np.roll(blend_x, shift=h // 2, axis=0)
    return np.clip(blend_xy, 0.0, 255.0)


def compute_luminance(rgb: np.ndarray) -> np.ndarray:
    """Rec.709 perceptual luminance in [0.0, 255.0] float32."""
    return (0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]).astype(np.float32)


def soft_clamp_srgb(rgb: np.ndarray, lo: float = 30.0, hi: float = 240.0) -> np.ndarray:
    """Smoothly compresses deep shadow toe and bright highlight shoulder into [lo, hi]
    while preserving natural midtone contrast 1:1.
    """
    knee_lo = lo + 18.0
    knee_hi = hi - 18.0
    out = rgb.astype(np.float32).copy()

    low_mask = out < knee_lo
    if np.any(low_mask):
        t = np.clip(out[low_mask] / max(knee_lo, 1e-5), 0.0, 1.0)
        out[low_mask] = lo + (knee_lo - lo) * (0.35 * t + 0.65 * t * t)

    high_mask = out > knee_hi
    if np.any(high_mask):
        t = np.clip((out[high_mask] - knee_hi) / max(255.0 - knee_hi, 1e-5), 0.0, 1.0)
        out[high_mask] = knee_hi + (hi - knee_hi) * (1.0 - np.power(1.0 - t, 1.5))

    return np.clip(out, lo, hi)


def target_dark_charcoal(rgb: np.ndarray, target_lo: float = 36.0, target_hi: float = 72.0) -> np.ndarray:
    """Gently pulls over-bright slick rubber tread textures into authentic charcoal range."""
    lum = compute_luminance(rgb)
    p02, med, p98 = np.percentile(lum, [2.0, 50.0, 98.0])
    if med <= 60.0 and p98 <= 76.0 and p02 >= 32.0:
        return soft_clamp_srgb(rgb, 30.0, 240.0)

    span = max(float(p98 - p02), 8.0)
    norm = np.clip((lum - p02) / span, 0.0, 1.0)
    mapped_lum = target_lo + 2.0 + norm * ((target_hi - 2.0) - (target_lo + 2.0))

    # Slightly desaturate toward neutral dark rubber while preserving micro-grain
    neutral = mapped_lum[:, :, None]
    ratio = mapped_lum / np.maximum(lum, 1.0)
    scaled = rgb * ratio[:, :, None]
    blended = 0.65 * scaled + 0.35 * neutral
    return np.clip(blended, target_lo, target_hi)


def process_wheel_rim_mixed(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Segments forged metallic spokes & titanium hub from dark carbon outer lip & voids.

    Conductive metal pixels (metal=255) are smoothly mapped into strict [180, 255] sRGB;
    dielectric pixels (metal=0) are soft-clamped into strict [30, 240] sRGB.
    Returns (clamped_rgb_f32, binary_metal_mask_bool).
    """
    h, w, _ = rgb.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rx = (xx - (w - 1) * 0.5) / ((w - 1) * 0.5)
    ry = (yy - (h - 1) * 0.5) / ((h - 1) * 0.5)
    r_norm = np.sqrt(rx * rx + ry * ry)

    lum = compute_luminance(rgb)
    max_c = rgb.max(axis=2)
    min_c = rgb.min(axis=2)
    sat = (max_c - min_c) / np.maximum(max_c, 1.0)

    inner_zone = r_norm <= 0.78
    inner_lum = lum[inner_zone]
    thresh = float(np.clip(np.percentile(inner_lum, 52.0), 74.0, 128.0))

    # Clean forged magnesium spokes & machined titanium hub (low saturation -> authentic bright metal;
    # vivid painted/anodized red rings remain dielectric so their crimson hue stays rich).
    metal_mask = inner_zone & (lum >= thresh) & (sat < 0.36)
    struct = np.ones((3, 3), dtype=bool)
    metal_mask = binary_opening(metal_mask, structure=struct)
    metal_mask = binary_closing(metal_mask, structure=struct)

    frac = float(metal_mask.mean())
    if frac < 0.04:
        # Fallback if raw rim image was unusually dark/tinted
        fallback_thresh = float(np.percentile(lum[r_norm <= 0.76], 65.0))
        metal_mask = (r_norm <= 0.76) & (lum >= fallback_thresh)
        metal_mask = binary_closing(binary_opening(metal_mask, structure=struct), structure=struct)

    out = soft_clamp_srgb(rgb, 30.0, 240.0)
    if np.any(metal_mask):
        metal_px = rgb[metal_mask].copy()
        # Gently neutralize heavy color casts on conductive pixels so lifting to [182, 248] looks metallic
        m_lum = compute_luminance(metal_px.reshape(-1, 1, 3)).reshape(-1, 1)
        metal_px = 0.78 * metal_px + 0.22 * m_lum
        p05 = float(np.percentile(metal_px, 5.0))
        p98 = float(np.percentile(metal_px, 98.0))
        denom = max(p98 - p05, 16.0)
        norm_m = np.clip((metal_px - p05) / denom, 0.0, 1.0)
        out[metal_mask] = np.clip(184.0 + norm_m * (248.0 - 184.0), 180.0, 255.0)

    return out, metal_mask


def generate_normal_map(height_01: np.ndarray, bump_strength: float, tileable: bool) -> np.ndarray:
    """Computes OpenGL +Y tangent-space normal map via 3x3 Scharr gradients."""
    mode = "wrap" if tileable else "reflect"
    # Light sub-pixel denoising avoids single-pixel diffusion grit spiking normals
    smooth_h = gaussian_filter(height_01.astype(np.float32), sigma=0.35, mode=mode)
    dx = correlate(smooth_h, SCHARR_X, mode=mode)  # +dH/dcol (+U right)
    dy = correlate(smooth_h, SCHARR_Y, mode=mode)  # +dH/drow (-V down)

    # OpenGL +Y tangent space: +U right -> nx = -dH/du = -dx; +V up -> ny = -dH/dv = +dy
    nx = -dx * float(bump_strength)
    ny = dy * float(bump_strength)
    nz = np.ones_like(nx, dtype=np.float32)

    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-12)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len

    n_rgb = np.stack([nx, ny, nz], axis=-1)
    return np.clip(np.rint((n_rgb * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)


def generate_orm_map(
    height_01: np.ndarray,
    rough_min: float,
    rough_max: float,
    tileable: bool,
    metal_mask: np.ndarray | None = None,
) -> np.ndarray:
    """Packs strictly linear Utility-Raw ORM map:
    - R: Multi-scale Gaussian cavity AO
    - G: Material-calibrated roughness in [rough_min, rough_max]
    - B: Strictly binary metalness (0 or 255)
    """
    h, w = height_01.shape
    mode = "wrap" if tileable else "reflect"
    scale = min(h, w) / 1024.0

    # R: Multi-scale Gaussian cavity AO
    blur_fine = gaussian_filter(height_01, sigma=max(1.0, 2.0 * scale), mode=mode)
    blur_med = gaussian_filter(height_01, sigma=max(2.5, 8.0 * scale), mode=mode)
    cav_fine = np.clip(blur_fine - height_01, 0.0, 1.0)
    cav_med = np.clip(blur_med - height_01, 0.0, 1.0)
    ao = 1.0 - np.clip(cav_fine * 2.4 + cav_med * 1.5, 0.0, 0.62)
    r_ch = np.clip(np.rint(ao * 255.0), 0, 255).astype(np.uint8)

    # G: Roughness driven by local micro-variance + cavity recesses mapped into [rough_min, rough_max]
    sq_blur = gaussian_filter(height_01 * height_01, sigma=max(1.2, 2.5 * scale), mode=mode)
    local_var = np.maximum(sq_blur - blur_fine * blur_fine, 0.0)
    local_std = np.sqrt(local_var + 1e-10)
    p05, p95 = np.percentile(local_std, [5.0, 95.0])
    var_norm = np.clip((local_std - p05) / max(float(p95 - p05), 1e-4), 0.0, 1.0)
    cav_norm = np.clip((1.0 - ao) / 0.45, 0.0, 1.0)
    rough_t = np.clip(0.62 * var_norm + 0.38 * cav_norm, 0.0, 1.0)

    rough = rough_min + rough_t * (rough_max - rough_min)
    g_lo = int(np.clip(np.rint(rough_min * 255.0), 0, 255))
    g_hi = int(np.clip(np.rint(rough_max * 255.0), 0, 255))
    g_ch = np.clip(np.rint(rough * 255.0), g_lo, g_hi).astype(np.uint8)

    # B: Strictly binary metalness (0 or 255)
    if metal_mask is not None:
        b_ch = np.where(metal_mask, 255, 0).astype(np.uint8)
    else:
        b_ch = np.zeros((h, w), dtype=np.uint8)

    orm = np.stack([r_ch, g_ch, b_ch], axis=-1)
    unique_b = set(np.unique(orm[:, :, 2]).tolist())
    assert unique_b.issubset({0, 255}), f"Non-binary metalness values detected: {unique_b}"
    return orm


def generate_car_flake_normal(size: int = 512, seed: int = 202604) -> np.ndarray:
    """Synthesizes a 512x512 seamless tileable micro-facet metallic flake normal map."""
    rng = np.random.default_rng(seed)

    # Basecoat subtle micro orange-peel wave (seamless periodic)
    base_h = rng.standard_normal((size, size)).astype(np.float32)
    base_h = gaussian_filter(base_h, sigma=1.6, mode="wrap")
    bx = correlate(base_h, SCHARR_X, mode="wrap") * 0.14
    by = correlate(base_h, SCHARR_Y, mode="wrap") * 0.14

    # Discrete crisp metallic aluminum micro-flakes (1x1 and 2x2 oriented mirror facets)
    nx = bx.copy()
    ny = by.copy()

    # Layer 1: 2x2 flakes (half-res tiled cleanly)
    half = size // 2
    flake_mask_2 = rng.random((half, half)) < 0.24
    ang_2 = rng.uniform(0.0, 2.0 * np.pi, size=(half, half)).astype(np.float32)
    tilt_2 = rng.uniform(0.10, 0.24, size=(half, half)).astype(np.float32) * flake_mask_2
    fx_2 = np.repeat(np.repeat(tilt_2 * np.cos(ang_2), 2, axis=0), 2, axis=1)
    fy_2 = np.repeat(np.repeat(tilt_2 * np.sin(ang_2), 2, axis=0), 2, axis=1)
    m_2 = np.repeat(np.repeat(flake_mask_2, 2, axis=0), 2, axis=1)
    nx = np.where(m_2, fx_2, nx)
    ny = np.where(m_2, fy_2, ny)

    # Layer 2: 1x1 fine sparkle flakes
    flake_mask_1 = rng.random((size, size)) < 0.30
    ang_1 = rng.uniform(0.0, 2.0 * np.pi, size=(size, size)).astype(np.float32)
    tilt_1 = rng.uniform(0.12, 0.30, size=(size, size)).astype(np.float32)
    nx = np.where(flake_mask_1, tilt_1 * np.cos(ang_1), nx)
    ny = np.where(flake_mask_1, tilt_1 * np.sin(ang_1), ny)

    nz = np.sqrt(np.maximum(1.0 - nx * nx - ny * ny, 0.25)).astype(np.float32)
    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-12)
    n_rgb = np.stack([nx * inv_len, ny * inv_len, nz * inv_len], axis=-1)
    return np.clip(np.rint((n_rgb * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)


def generate_pirelli_compound_sidewalls(master_rgb: np.ndarray) -> dict[str, np.ndarray]:
    """Derives Soft (Crimson Red), Medium (Championship Yellow), and Hard (Off-White)
    sidewall albedos from the processed `tire_sidewall_pirelli` master plate.
    """
    h, w, _ = master_rgb.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rx = (xx - (w - 1) * 0.5) / ((w - 1) * 0.5)
    ry = (yy - (h - 1) * 0.5) / ((h - 1) * 0.5)
    r_norm = np.sqrt(rx * rx + ry * ry)
    theta = np.arctan2(ry, rx)

    r_ch = master_rgb[:, :, 0]
    g_ch = master_rgb[:, :, 1]
    b_ch = master_rgb[:, :, 2]
    max_c = np.maximum(np.maximum(r_ch, g_ch), b_ch)
    min_c = np.minimum(np.minimum(r_ch, g_ch), b_ch)
    sat = (max_c - min_c) / np.maximum(max_c, 1.0)

    # Detect colored/crimson compound stripe pixels in the sidewall annulus
    red_excess = r_ch - np.maximum(g_ch, b_ch)
    red_score = np.clip((red_excess - 10.0) / 38.0, 0.0, 1.0)
    sat_score = np.clip((sat - 0.16) / 0.22, 0.0, 1.0)
    radial_gate = smoothstep(0.36, 0.42, r_norm) * (1.0 - smoothstep(0.96, 1.00, r_norm))
    w_ring = np.clip(red_score * sat_score * radial_gate, 0.0, 1.0)

    # Defensive fallback: if raw plate lacks enough colored ring pixels, paint crisp Pirelli arcs
    if float(w_ring.mean()) < 0.005:
        ring_band = smoothstep(0.79, 0.805, r_norm) * (1.0 - smoothstep(0.865, 0.88, r_norm))
        # Twin classic Motorsport compound arcs leaving gaps at top & bottom for P ZERO branding
        arc_mask = smoothstep(0.22, 0.28, np.abs(np.cos(theta)))
        w_ring = np.maximum(w_ring, ring_band * arc_mask)

    ring_pixels = max_c[w_ring > 0.35]
    ref_peak = float(np.percentile(ring_pixels, 90.0)) if ring_pixels.size > 64 else 210.0
    shade = np.clip(max_c / max(ref_peak, 140.0), 0.55, 1.08)[:, :, None]
    w3 = w_ring[:, :, None]

    # Target compound RGB colors (all strictly inside PBR dielectric [30, 240] sRGB):
    # - Soft:   #dc2626 -> (220, 38, 38)
    # - Medium: #eab308 -> (234, 179, 32)  (blue raised from 8->32 to satisfy >=30 PBR floor)
    # - Hard:   #dcdde0 -> (220, 221, 224)
    compound_targets = {
        "tire_sidewall_soft": np.array([220.0, 38.0, 38.0], dtype=np.float32),
        "tire_sidewall_medium": np.array([234.0, 179.0, 32.0], dtype=np.float32),
        "tire_sidewall_hard": np.array([220.0, 221.0, 224.0], dtype=np.float32),
    }

    variants: dict[str, np.ndarray] = {}
    for var_name, target_rgb in compound_targets.items():
        colored = target_rgb[None, None, :] * shade
        blended = (1.0 - w3) * master_rgb + w3 * colored
        clamped = soft_clamp_srgb(blended, 30.0, 240.0)
        u8 = np.clip(np.rint(clamped), 30, 240).astype(np.uint8)
        variants[var_name] = u8

    return variants


def generate_brake_thermal_mask(rotor_rgb: np.ndarray) -> np.ndarray:
    """Synthesizes 512x512 grayscale annular thermal glow mask for carbon-carbon brake discs.

    Smoothstep 1.0 on friction annulus r in [0.42, 0.94], 0.0 on central bell & outer edge,
    modulated by rotor ventilation drill holes and pad-swept peak heat distribution.
    """
    h, w, _ = rotor_rgb.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rx = (xx - (w - 1) * 0.5) / ((w - 1) * 0.5)
    ry = (yy - (h - 1) * 0.5) / ((h - 1) * 0.5)
    r_norm = np.sqrt(rx * rx + ry * ry)

    # Annular friction band: r in [0.42, 0.94]
    inner_edge = smoothstep(0.40, 0.44, r_norm)
    outer_edge = 1.0 - smoothstep(0.92, 0.96, r_norm)
    annulus = inner_edge * outer_edge

    # Detect ventilation drill holes (local sharp dark dips relative to local rotor average)
    lum01 = compute_luminance(rotor_rgb) / 255.0
    local_mean = gaussian_filter(lum01, sigma=5.0, mode="reflect")
    hole_dip = np.clip(local_mean - lum01, 0.0, 1.0)
    hole_atten = 1.0 - 0.72 * smoothstep(0.035, 0.13, hole_dip)

    # Realistic peak thermal band across brake-pad contact centerline (~r=0.68)
    radial_profile = 0.84 + 0.16 * np.exp(-0.5 * ((r_norm - 0.68) / 0.20) ** 2)
    mask = np.clip(annulus * hole_atten * radial_profile, 0.0, 1.0)
    return np.clip(np.rint(mask * 255.0), 0, 255).astype(np.uint8)


def save_rgb(arr: np.ndarray, path: Path) -> None:
    Image.fromarray(arr, mode="RGB").save(path, format="PNG", optimize=True)


def save_gray(arr: np.ndarray, path: Path) -> None:
    Image.fromarray(arr, mode="L").save(path, format="PNG", optimize=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_materials: dict[str, dict] = {}
    processed_cache: dict[str, np.ndarray] = {}

    print("=" * 84)
    print("[F1 PBR Texture Pipeline] Processing 15 Nano Banana albedos + auxiliary maps")
    print(f"  Input : {RAW_DIR}")
    print(f"  Output: {OUT_DIR}")
    print("=" * 84)

    for spec in TEXTURE_SPECS:
        raw_path = find_raw_image(spec.name)
        rgb = load_and_resize(raw_path, spec.width, spec.height)

        if spec.tileable:
            if spec.flatten_lowfreq:
                rgb = flatten_macro_illumination(rgb, strength=0.50)
            rgb = make_seamless_toroidal(rgb, band_frac=0.14)

        # Preserve continuous pre-clamp luminance heightfield for crisp gradient derivation
        pre_clamp_height01 = np.clip(compute_luminance(rgb) / 255.0, 0.0, 1.0)

        metal_mask: np.ndarray | None = None
        if spec.metal_mode == "mixed":
            clamped_rgb, metal_mask = process_wheel_rim_mixed(rgb)
            albedo_u8 = np.clip(np.rint(clamped_rgb), 0, 255).astype(np.uint8)
            albedo_u8[metal_mask] = np.clip(albedo_u8[metal_mask], 180, 255)
            albedo_u8[~metal_mask] = np.clip(albedo_u8[~metal_mask], 30, 240)
        elif spec.target_charcoal is not None:
            charcoal_rgb = target_dark_charcoal(rgb, spec.target_charcoal[0], spec.target_charcoal[1])
            albedo_u8 = np.clip(np.rint(charcoal_rgb), 30, 240).astype(np.uint8)
        else:
            clamped_rgb = soft_clamp_srgb(rgb, 30.0, 240.0)
            albedo_u8 = np.clip(np.rint(clamped_rgb), 30, 240).astype(np.uint8)

        # Heightfield for normal/ORM: use clamped luminance for dielectrics, pre-lift for mixed rim
        height01 = (
            pre_clamp_height01
            if spec.metal_mode == "mixed"
            else np.clip(compute_luminance(albedo_u8.astype(np.float32)) / 255.0, 0.0, 1.0)
        )
        normal_u8 = generate_normal_map(height01, spec.bump, spec.tileable)
        orm_u8 = generate_orm_map(height01, spec.rough_min, spec.rough_max, spec.tileable, metal_mask)

        albedo_file = f"{spec.name}.png"
        normal_file = f"{spec.name}_normal.png"
        orm_file = f"{spec.name}_orm.png"

        save_rgb(albedo_u8, OUT_DIR / albedo_file)
        save_rgb(normal_u8, OUT_DIR / normal_file)
        save_rgb(orm_u8, OUT_DIR / orm_file)
        processed_cache[spec.name] = albedo_u8.astype(np.float32)

        # Strict PBR reflectance & binary metalness assertions
        if spec.metal_mode == "mixed" and metal_mask is not None:
            d_min = int(albedo_u8[~metal_mask].min())
            d_max = int(albedo_u8[~metal_mask].max())
            m_min = int(albedo_u8[metal_mask].min())
            m_max = int(albedo_u8[metal_mask].max())
            assert 30 <= d_min and d_max <= 240, f"{spec.name} dielectric sRGB out of [30,240]: [{d_min},{d_max}]"
            assert 180 <= m_min and m_max <= 255, f"{spec.name} conductive sRGB out of [180,255]: [{m_min},{m_max}]"
            entry_bounds = {
                "minSrgb": int(albedo_u8.min()),
                "maxSrgb": int(albedo_u8.max()),
                "dielectricMinSrgb": d_min,
                "dielectricMaxSrgb": d_max,
                "conductiveMinSrgb": m_min,
                "conductiveMaxSrgb": m_max,
                "conductiveCoverage": round(float(metal_mask.mean()), 4),
            }
        else:
            s_min = int(albedo_u8.min())
            s_max = int(albedo_u8.max())
            assert 30 <= s_min and s_max <= 240, f"{spec.name} sRGB out of [30,240]: [{s_min},{s_max}]"
            entry_bounds = {
                "minSrgb": s_min,
                "maxSrgb": s_max,
            }

        metal_vals = sorted(int(v) for v in np.unique(orm_u8[:, :, 2]))
        assert set(metal_vals).issubset({0, 255}), f"{spec.name} non-binary metalness: {metal_vals}"

        manifest_materials[spec.name] = {
            "resolution": [spec.width, spec.height],
            "tileable": spec.tileable,
            "metallicMode": spec.metal_mode,
            "bumpStrength": spec.bump,
            "roughnessRange": [spec.rough_min, spec.rough_max],
            "metalnessUniqueValues": metal_vals,
            **entry_bounds,
            "colorSpace": "Utility - sRGB - Texture",
            "dataMaps": "Utility - Raw",
            "files": {
                "albedo": albedo_file,
                "normal": normal_file,
                "orm": orm_file,
            },
            "passed": True,
        }

        print(
            f"  [OK] {spec.name:24s} {spec.width:4d}x{spec.height:<4d} "
            f"tile={str(spec.tileable):5s} sRGB=[{entry_bounds['minSrgb']:3d},{entry_bounds['maxSrgb']:3d}] "
            f"rough=[{spec.rough_min:.2f},{spec.rough_max:.2f}] metal={metal_vals}"
        )

    # --- Auxiliary 1: 512x512 seamless micro-facet metallic flake normal map ---
    flake_u8 = generate_car_flake_normal(size=512, seed=202604)
    save_rgb(flake_u8, OUT_DIR / "car_flake_normal.png")
    print(f"  [OK] {'car_flake_normal':24s}  512x512  tile=True  Utility - Raw (micro-facet clearcoat flakes)")

    # --- Auxiliary 2: 3 Pirelli compound sidewall variants (sharing normal & ORM) ---
    compound_variants = generate_pirelli_compound_sidewalls(processed_cache["tire_sidewall_pirelli"])
    for var_name, var_u8 in compound_variants.items():
        var_file = f"{var_name}.png"
        save_rgb(var_u8, OUT_DIR / var_file)
        v_min, v_max = int(var_u8.min()), int(var_u8.max())
        assert 30 <= v_min and v_max <= 240, f"{var_name} sRGB out of [30,240]: [{v_min},{v_max}]"
        manifest_materials[var_name] = {
            "resolution": [1024, 1024],
            "tileable": False,
            "metallicMode": "dielectric",
            "bumpStrength": 2.0,
            "roughnessRange": [0.48, 0.68],
            "metalnessUniqueValues": [0],
            "minSrgb": v_min,
            "maxSrgb": v_max,
            "colorSpace": "Utility - sRGB - Texture",
            "dataMaps": "Utility - Raw",
            "files": {
                "albedo": var_file,
                "normal": "tire_sidewall_pirelli_normal.png",
                "orm": "tire_sidewall_pirelli_orm.png",
            },
            "passed": True,
        }
        print(f"  [OK] {var_name:24s} 1024x1024 tile=False sRGB=[{v_min:3d},{v_max:3d}] (shared sidewall N/ORM)")

    # --- Auxiliary 3: 512x512 carbon-carbon brake thermal annular mask ---
    thermal_u8 = generate_brake_thermal_mask(processed_cache["brake_rotor_carbon"])
    save_gray(thermal_u8, OUT_DIR / "brake_thermal_mask.png")
    print(
        f"  [OK] {'brake_thermal_mask':24s}  512x512  tile=False Utility - Raw "
        f"range=[{int(thermal_u8.min())},{int(thermal_u8.max())}]"
    )

    manifest = {
        "pipelineVersion": "1.0.0",
        "colorSpaceStandard": {
            "albedo": "Utility - sRGB - Texture",
            "dataMaps": "Utility - Raw",
            "dielectricSrgbBounds": [30, 240],
            "conductiveSrgbBounds": [180, 255],
            "binaryMetalness": [0, 255],
        },
        "allPassed": all(m["passed"] for m in manifest_materials.values()),
        "materialCount": len(manifest_materials),
        "materials": manifest_materials,
        "auxiliaryMaps": {
            "car_flake_normal": {
                "file": "car_flake_normal.png",
                "resolution": [512, 512],
                "tileable": True,
                "colorSpace": "Utility - Raw",
                "passed": True,
            },
            "brake_thermal_mask": {
                "file": "brake_thermal_mask.png",
                "resolution": [512, 512],
                "tileable": False,
                "colorSpace": "Utility - Raw",
                "annulusRadiusNormalized": [0.42, 0.94],
                "passed": True,
            },
        },
    }

    manifest_path = OUT_DIR / "pbr_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("=" * 84)
    print(f"[F1 PBR Texture Pipeline] SUCCESS -> wrote {manifest_path} ({len(manifest_materials)} materials passed)")
    print("=" * 84)


if __name__ == "__main__":
    main()
