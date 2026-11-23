"""Step 3 Parametric .glb Hero Formula 1 Car Builder (`trimesh` + `scipy` PCHIP Lofting).

Constructs a museum-grade, genuinely sculpted modern FIA ground-effect Formula 1 car
exported to `models/f1_car.glb`:
  - Right-handed, meters, +Y up, car facing -Z, +X starboard/right, -X port/left.
  - All 4 slick tires rest strictly at Y = 0.000 m (|minY| < 0.002 m), hub Y = +0.360 m.
  - Exact axle coordinates:
      FL = (-0.800, 0.360, -1.962)  (width 0.305 m)
      FR = (+0.800, 0.360, -1.962)  (width 0.305 m)
      RL = (-0.775, 0.360, +1.638)  (width 0.405 m)
      RR = (+0.775, 0.360, +1.638)  (width 0.405 m)
  - Hard envelope assertions:
      5.40 <= L <= 5.65 m (target 5.52 m)
      1.95 <= W <= 2.02 m (target 1.98 m)
      0.94 <= H <= 1.12 m (target 1.065 m)
      |minY| < 0.002 m
      25,000 <= total_tris <= 65,000 (target ~44,000 - 50,000 tris)
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image
from scipy.interpolate import PchipInterpolator
import trimesh
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial

BASE_DIR = Path(__file__).resolve().parent.parent
TEX_DIR = BASE_DIR / "textures"
OUT_DIR = BASE_DIR / "models"


# ==============================================================================
# MATH & MATERIAL HELPERS
# ==============================================================================
def smoothstep(edge0: float, edge1: float, x):
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-12), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def make_solid_patch_img(rgb: tuple[int, int, int], size: int = 64) -> Image.Image:
    arr = np.full((size, size, 3), rgb, dtype=np.uint8)
    return Image.fromarray(arr, mode="RGB")


def load_texture_or_fallback(
    candidates: list[str],
    fallback_rgb: tuple[int, int, int],
    checker: bool = False,
) -> Image.Image:
    """Loads processed PBR albedo from `textures/`, falling back cleanly to a
    neutral placeholder PIL image if executed before textures exist.
    """
    for fname in candidates:
        p = TEX_DIR / fname
        if p.exists():
            return Image.open(p).convert("RGB")
    arr = np.full((128, 128, 3), fallback_rgb, dtype=np.uint8)
    if checker:
        yy, xx = np.mgrid[0:128, 0:128]
        pat = ((xx // 8 + yy // 8) % 2) == 0
        arr[pat] = np.clip(np.asarray(fallback_rgb) + 12, 30, 240).astype(np.uint8)
    return Image.fromarray(arr, mode="RGB")


def finalize_part(
    verts: np.ndarray,
    faces: np.ndarray,
    uvs: np.ndarray,
    fix_winding: bool = True,
) -> tuple[trimesh.Trimesh, np.ndarray]:
    mesh = trimesh.Trimesh(
        vertices=np.asarray(verts, dtype=np.float64),
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
    )
    if fix_winding:
        trimesh.repair.fix_normals(mesh)
        if float(mesh.volume) < 0.0:
            mesh.invert()
            trimesh.repair.fix_normals(mesh)
    return mesh, np.asarray(uvs, dtype=np.float32)


def merge_textured_parts(
    parts: list[tuple[trimesh.Trimesh, np.ndarray]],
    material: PBRMaterial,
    repair_merged: bool = False,
) -> trimesh.Trimesh:
    """Combines multiple (Trimesh, uv) sub-parts sharing one PBRMaterial."""
    all_v = []
    all_f = []
    all_uv = []
    offset = 0
    for m, uv in parts:
        all_v.append(m.vertices)
        all_f.append(m.faces + offset)
        all_uv.append(uv)
        offset += len(m.vertices)
    merged = trimesh.Trimesh(
        vertices=np.vstack(all_v),
        faces=np.vstack(all_f),
        process=False,
    )
    if repair_merged:
        trimesh.repair.fix_normals(merged)
    merged.visual = TextureVisuals(uv=np.vstack(all_uv).astype(np.float32), material=material)
    return merged


# ==============================================================================
# CORE PARAMETRIC CAD / PCHIP LOFTING PRIMITIVES
# ==============================================================================
def loft_superellipse_z(
    z_knots,
    y_bot_knots,
    y_top_knots,
    w_bot_knots,
    w_top_knots,
    cx_knots=None,
    n_exp_knots=None,
    n_rings: int = 48,
    n_seg: int = 36,
    cap_front: bool = True,
    cap_rear: bool = True,
    u_range: tuple[float, float] = (0.04, 0.96),
    v_range: tuple[float, float] = (0.04, 0.96),
    sculpt_fn: Callable | None = None,
) -> tuple[trimesh.Trimesh, np.ndarray]:
    """Lofts a watertight aerodynamic bodywork volume along longitudinal Z (-Z front -> +Z rear)
    using monotonic PCHIP curves and asymmetric super-elliptical cross-sections.

    Theta starts at -pi/2 (bottom centerline, hidden underfloor) and wraps counterclockwise:
      -pi/2 (bottom) -> 0 (+X starboard) -> +pi/2 (+Y top crown) -> +pi (-X port) -> +3pi/2 (bottom).
    Perimeter arc-length UV mapping eliminates stretching on vertical flanks and hides the
    duplicated UV seam cleanly along the bottom belly.
    """
    z_k = np.asarray(z_knots, dtype=np.float64)
    assert np.all(np.diff(z_k) > 0), f"z_knots must be strictly increasing: {z_k}"

    yb_fn = PchipInterpolator(z_k, y_bot_knots)
    yt_fn = PchipInterpolator(z_k, y_top_knots)
    wb_fn = PchipInterpolator(z_k, w_bot_knots)
    wt_fn = PchipInterpolator(z_k, w_top_knots)
    cx_fn = PchipInterpolator(z_k, cx_knots if cx_knots is not None else np.zeros_like(z_k))
    ne_fn = PchipInterpolator(z_k, n_exp_knots if n_exp_knots is not None else np.full_like(z_k, 3.0))

    z_grid = np.linspace(z_k[0], z_k[-1], n_rings)
    z_span = max(float(z_k[-1] - z_k[0]), 1e-6)

    cols = n_seg + 1
    theta = np.linspace(-0.5 * np.pi, 1.5 * np.pi, cols)
    ca = np.cos(theta)  # +1 starboard (+X), -1 port (-X)
    sa = np.sin(theta)  # +1 top (+Y), -1 bottom (-Y)

    verts_list = []
    uvs_list = []

    for z_val in z_grid:
        z_norm = float((z_val - z_k[0]) / z_span)
        yb = float(yb_fn(z_val))
        yt = float(yt_fn(z_val))
        wb = max(float(wb_fn(z_val)), 1e-4)
        wt = max(float(wt_fn(z_val)), 1e-4)
        cx = float(cx_fn(z_val))
        n_exp = float(np.clip(ne_fn(z_val), 1.6, 8.0))
        p_exp = 2.0 / n_exp

        sx = np.sign(ca) * (np.abs(ca) ** p_exp)
        sy = np.sign(sa) * (np.abs(sa) ** p_exp)
        t_v = 0.5 * (sy + 1.0)
        half_w = wb * (1.0 - t_v) + wt * t_v

        x_ring = cx + half_w * sx
        y_ring = 0.5 * (yb + yt) + 0.5 * (yt - yb) * sy
        z_ring = np.full(cols, z_val, dtype=np.float64)

        if sculpt_fn is not None:
            x_ring, y_ring, z_ring = sculpt_fn(x_ring, y_ring, z_ring, theta, z_norm)

        # Guarantee exact coincidence across duplicated UV seam column
        x_ring[-1] = x_ring[0]
        y_ring[-1] = y_ring[0]
        z_ring[-1] = z_ring[0]

        # Normalized perimeter arc-length UV (u=0.50 at top crown, seam hidden at bottom belly)
        dx = np.diff(x_ring)
        dy = np.diff(y_ring)
        seg_len = np.sqrt(dx * dx + dy * dy + 1e-12)
        cum_len = np.concatenate([[0.0], np.cumsum(seg_len)])
        s_arc = cum_len / max(float(cum_len[-1]), 1e-6)

        u_ring = u_range[0] + (u_range[1] - u_range[0]) * s_arc
        v_ring = np.full(cols, v_range[0] + (v_range[1] - v_range[0]) * z_norm, dtype=np.float64)

        verts_list.append(np.stack([x_ring, y_ring, z_ring], axis=-1))
        uvs_list.append(np.stack([u_ring, v_ring], axis=-1))

    verts = np.concatenate(verts_list, axis=0)
    uvs = np.concatenate(uvs_list, axis=0)

    faces = []
    # Winding: dP/d(ic) at theta=0 is +Y; dP/d(ir) is +Z; (+Y) x (+Z) = +X (OUTWARD).
    for ir in range(n_rings - 1):
        r0 = ir * cols
        r1 = (ir + 1) * cols
        for ic in range(n_seg):
            v00 = r0 + ic
            v10 = r0 + ic + 1
            v01 = r1 + ic
            v11 = r1 + ic + 1
            faces.append([v00, v10, v11])
            faces.append([v00, v11, v01])

    extra_v = []
    extra_uv = []
    if cap_front:
        c_idx = len(verts) + len(extra_v)
        c_pt = verts[0 : cols - 1].mean(axis=0)
        extra_v.append(c_pt)
        extra_uv.append([0.5 * (u_range[0] + u_range[1]), v_range[0]])
        for ic in range(n_seg):
            faces.append([c_idx, ic + 1, ic])

    if cap_rear:
        c_idx = len(verts) + len(extra_v)
        r_start = (n_rings - 1) * cols
        c_pt = verts[r_start : r_start + cols - 1].mean(axis=0)
        extra_v.append(c_pt)
        extra_uv.append([0.5 * (u_range[0] + u_range[1]), v_range[1]])
        for ic in range(n_seg):
            faces.append([c_idx, r_start + ic, r_start + ic + 1])

    if extra_v:
        verts = np.vstack([verts, np.asarray(extra_v, dtype=np.float64)])
        uvs = np.vstack([uvs, np.asarray(extra_uv, dtype=np.float64)])

    return finalize_part(verts, np.asarray(faces, dtype=np.int64), uvs, fix_winding=True)


def build_curved_tube(
    pts_ctrl: np.ndarray,
    r_a_knots,
    r_b_knots,
    n_rings: int = 28,
    n_seg: int = 16,
    u_repeat: float = 1.0,
    v_repeat: float = 3.0,
    cap_ends: bool = True,
    up_hint: tuple[float, float, float] = (0.0, 1.0, 0.0),
) -> tuple[trimesh.Trimesh, np.ndarray]:
    """Lofts a smooth elliptical/airfoil 3D tube along a PCHIP spline centerline
    using twist-free Bishop parallel-transport frames.
    """
    pts_ctrl = np.asarray(pts_ctrl, dtype=np.float64)
    seg_d = np.linalg.norm(np.diff(pts_ctrl, axis=0), axis=1)
    t_ctrl = np.concatenate([[0.0], np.cumsum(seg_d)])
    total_len = max(float(t_ctrl[-1]), 1e-6)
    t_ctrl /= total_len

    cx_fn = PchipInterpolator(t_ctrl, pts_ctrl[:, 0])
    cy_fn = PchipInterpolator(t_ctrl, pts_ctrl[:, 1])
    cz_fn = PchipInterpolator(t_ctrl, pts_ctrl[:, 2])
    ra_fn = PchipInterpolator(t_ctrl, np.broadcast_to(r_a_knots, len(t_ctrl)))
    rb_fn = PchipInterpolator(t_ctrl, np.broadcast_to(r_b_knots, len(t_ctrl)))

    t_grid = np.linspace(0.0, 1.0, n_rings)
    centers = np.stack([cx_fn(t_grid), cy_fn(t_grid), cz_fn(t_grid)], axis=-1)

    # Tangent vectors along spline
    tangents = np.gradient(centers, axis=0)
    tangents /= np.maximum(np.linalg.norm(tangents, axis=1, keepdims=True), 1e-9)

    # Initial Bishop frame aligned with up_hint (a = normal/vertical, b = binormal/lateral)
    hint = np.asarray(up_hint, dtype=np.float64)
    if abs(float(np.dot(tangents[0], hint))) > 0.92:
        hint = np.array([1.0, 0.0, 0.0], dtype=np.float64)
    b0 = np.cross(tangents[0], hint)
    b0 /= max(float(np.linalg.norm(b0)), 1e-9)
    n0 = np.cross(b0, tangents[0])
    n0 /= max(float(np.linalg.norm(n0)), 1e-9)

    normals = np.zeros_like(centers)
    binormals = np.zeros_like(centers)
    normals[0] = n0
    binormals[0] = b0

    for i in range(1, n_rings):
        t_prev = tangents[i - 1]
        t_curr = tangents[i]
        v_rot = np.cross(t_prev, t_curr)
        sin_a = float(np.linalg.norm(v_rot))
        cos_a = float(np.clip(np.dot(t_prev, t_curr), -1.0, 1.0))
        if sin_a < 1e-8:
            n_next = normals[i - 1]
        else:
            axis = v_rot / sin_a
            angle = np.arctan2(sin_a, cos_a)
            # Rodrigues rotation of previous normal around axis
            n_p = normals[i - 1]
            n_next = (
                n_p * np.cos(angle)
                + np.cross(axis, n_p) * np.sin(angle)
                + axis * np.dot(axis, n_p) * (1.0 - np.cos(angle))
            )
        # Re-orthonormalize
        n_next = n_next - np.dot(n_next, t_curr) * t_curr
        n_next /= max(float(np.linalg.norm(n_next)), 1e-9)
        b_next = np.cross(t_curr, n_next)
        b_next /= max(float(np.linalg.norm(b_next)), 1e-9)
        normals[i] = n_next
        binormals[i] = b_next

    cols = n_seg + 1
    phi = np.linspace(0.0, 2.0 * np.pi, cols)
    cp = np.cos(phi)
    sp = np.sin(phi)

    verts_list = []
    uvs_list = []
    for i, tv in enumerate(t_grid):
        ra = float(ra_fn(tv))
        rb = float(rb_fn(tv))
        ring = (
            centers[i][None, :]
            + (ra * cp)[:, None] * normals[i][None, :]
            + (rb * sp)[:, None] * binormals[i][None, :]
        )
        ring[-1] = ring[0]
        uv_ring = np.stack(
            [np.linspace(0.0, u_repeat, cols), np.full(cols, tv * v_repeat)],
            axis=-1,
        )
        verts_list.append(ring)
        uvs_list.append(uv_ring)

    verts = np.concatenate(verts_list, axis=0)
    uvs = np.concatenate(uvs_list, axis=0)

    faces = []
    for ir in range(n_rings - 1):
        r0 = ir * cols
        r1 = (ir + 1) * cols
        for ic in range(n_seg):
            v00 = r0 + ic
            v10 = r0 + ic + 1
            v01 = r1 + ic
            v11 = r1 + ic + 1
            faces.append([v00, v10, v11])
            faces.append([v00, v11, v01])

    if cap_ends:
        extra_v = [centers[0], centers[-1]]
        extra_uv = [[0.5 * u_repeat, 0.0], [0.5 * u_repeat, v_repeat]]
        c0 = len(verts)
        c1 = len(verts) + 1
        r_end = (n_rings - 1) * cols
        for ic in range(n_seg):
            faces.append([c0, ic + 1, ic])
            faces.append([c1, r_end + ic, r_end + ic + 1])
        verts = np.vstack([verts, np.asarray(extra_v, dtype=np.float64)])
        uvs = np.vstack([uvs, np.asarray(extra_uv, dtype=np.float64)])

    return finalize_part(verts, np.asarray(faces, dtype=np.int64), uvs, fix_winding=True)


def build_swept_airfoil_wing(
    x_knots,
    z_le_knots,
    y_le_knots,
    chord_knots,
    aoa_deg_knots,
    camber: float = 0.065,
    thickness: float = 0.095,
    n_span: int = 32,
    n_chord: int = 12,
    u_scale: float = 2.0,
    v_scale: float = 1.0,
) -> tuple[trimesh.Trimesh, np.ndarray]:
    """Builds a watertight, inverted-camber F1 downforce airfoil element swept smoothly along X."""
    x_k = np.asarray(x_knots, dtype=np.float64)
    assert np.all(np.diff(x_k) > 0), f"x_knots must be strictly increasing: {x_k}"

    zle_fn = PchipInterpolator(x_k, z_le_knots)
    yle_fn = PchipInterpolator(x_k, y_le_knots)
    ch_fn = PchipInterpolator(x_k, chord_knots)
    aoa_fn = PchipInterpolator(x_k, np.deg2rad(aoa_deg_knots))

    x_grid = np.linspace(x_k[0], x_k[-1], n_span)
    x_span = max(float(x_k[-1] - x_k[0]), 1e-6)

    # Closed airfoil profile parameter starting at leading edge -> upper surface -> trailing edge -> lower -> leading edge
    half_n = max(4, n_chord // 2)
    # Cosine spacing concentrates triangles cleanly on the rounded leading edge & crisp trailing edge
    beta_up = np.linspace(0.0, np.pi, half_n + 1)
    xc_up = 0.5 * (1.0 - np.cos(beta_up))
    beta_lo = np.linspace(0.0, np.pi, half_n + 1)[1:]
    xc_lo = 0.5 * (1.0 + np.cos(beta_lo))

    def naca_yt(xc: np.ndarray) -> np.ndarray:
        xc_c = np.clip(xc, 0.0, 1.0)
        return 5.0 * thickness * (
            0.2969 * np.sqrt(xc_c + 1e-12)
            - 0.1260 * xc_c
            - 0.3516 * (xc_c ** 2)
            + 0.2843 * (xc_c ** 3)
            - 0.0980 * (xc_c ** 4)
        )

    # Inverted camber for downforce (concave suction belly curving up toward trailing edge)
    yc_up = -camber * 4.0 * xc_up * (1.0 - xc_up)
    yt_up = naca_yt(xc_up)
    yc_lo = -camber * 4.0 * xc_lo * (1.0 - xc_lo)
    yt_lo = naca_yt(xc_lo)

    xc_loop = np.concatenate([xc_up, xc_lo])
    yp_loop = np.concatenate([yc_up + yt_up, yc_lo - yt_lo])
    cols = len(xc_loop)  # n_seg + 1, seam at leading edge (xc=0)
    n_seg = cols - 1
    v_loop = np.linspace(0.0, v_scale, cols)

    verts_list = []
    uvs_list = []
    for xv in x_grid:
        zle = float(zle_fn(xv))
        yle = float(yle_fn(xv))
        ch = float(ch_fn(xv))
        aoa = float(aoa_fn(xv))
        ca, sa = np.cos(aoa), np.sin(aoa)

        zp = xc_loop * ch
        yp = yp_loop * ch
        # Positive AoA tilts trailing edge (+Z) upward (+Y) to generate downforce
        z_ring = zle + zp * ca - yp * sa
        y_ring = yle + zp * sa + yp * ca
        x_ring = np.full(cols, xv, dtype=np.float64)

        x_ring[-1] = x_ring[0]
        y_ring[-1] = y_ring[0]
        z_ring[-1] = z_ring[0]

        u_val = ((xv - x_k[0]) / x_span) * u_scale
        verts_list.append(np.stack([x_ring, y_ring, z_ring], axis=-1))
        uvs_list.append(np.stack([np.full(cols, u_val), v_loop], axis=-1))

    verts = np.concatenate(verts_list, axis=0)
    uvs = np.concatenate(uvs_list, axis=0)

    faces = []
    for ir in range(n_span - 1):
        r0 = ir * cols
        r1 = (ir + 1) * cols
        for ic in range(n_seg):
            v00 = r0 + ic
            v10 = r0 + ic + 1
            v01 = r1 + ic
            v11 = r1 + ic + 1
            faces.append([v00, v10, v11])
            faces.append([v00, v11, v01])

    # Watertight spanwise end caps at x_knots[0] (-X) and x_knots[-1] (+X)
    c_left = verts[0:n_seg].mean(axis=0)
    r_right = (n_span - 1) * cols
    c_right = verts[r_right : r_right + n_seg].mean(axis=0)
    idx_l = len(verts)
    idx_r = len(verts) + 1
    verts = np.vstack([verts, [c_left, c_right]])
    uvs = np.vstack([uvs, [[0.0, 0.5 * v_scale], [u_scale, 0.5 * v_scale]]])

    for ic in range(n_seg):
        faces.append([idx_l, ic + 1, ic])
        faces.append([idx_r, r_right + ic, r_right + ic + 1])

    return finalize_part(verts, np.asarray(faces, dtype=np.int64), uvs, fix_winding=True)


def build_sculpted_aero_panel(
    nu: int,
    nv: int,
    surface_fn: Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]],
    u_uv_range: tuple[float, float] = (0.05, 0.95),
    v_uv_range: tuple[float, float] = (0.05, 0.95),
) -> tuple[trimesh.Trimesh, np.ndarray]:
    """Builds a watertight sculpted 3D aerodynamic panel (endplates, shark fin, floor, diffuser, strakes).

    `surface_fn(U, V)` returns `(X_mid, Y_mid, Z_mid, NX_off, NY_off, NZ_off)` where
    `pos_A = mid + off` and `pos_B = mid - off` form the two faces stitched cleanly along all 4 edges.
    """
    u_1d = np.linspace(0.0, 1.0, nu)
    v_1d = np.linspace(0.0, 1.0, nv)
    U, V = np.meshgrid(u_1d, v_1d, indexing="ij")

    xm, ym, zm, ox, oy, oz = surface_fn(U, V)
    pts_a = np.stack([xm + ox, ym + oy, zm + oz], axis=-1).reshape(-1, 3)
    pts_b = np.stack([xm - ox, ym - oy, zm - oz], axis=-1).reshape(-1, 3)

    u_tex = u_uv_range[0] + (u_uv_range[1] - u_uv_range[0]) * U
    v_tex = v_uv_range[0] + (v_uv_range[1] - v_uv_range[0]) * V
    uv_grid = np.stack([u_tex, v_tex], axis=-1).reshape(-1, 2)

    n_pts = nu * nv
    verts = np.vstack([pts_a, pts_b])
    uvs = np.vstack([uv_grid, uv_grid])

    faces = []
    # Face A
    for i in range(nu - 1):
        for j in range(nv - 1):
            a00 = i * nv + j
            a10 = (i + 1) * nv + j
            a01 = i * nv + (j + 1)
            a11 = (i + 1) * nv + (j + 1)
            faces.append([a00, a10, a11])
            faces.append([a00, a11, a01])
            # Face B (opposite winding)
            b00, b10, b01, b11 = a00 + n_pts, a10 + n_pts, a01 + n_pts, a11 + n_pts
            faces.append([b00, b11, b10])
            faces.append([b00, b01, b11])

    # Stitch 4 perimeter borders cleanly
    # Edge j = 0 (i = 0..nu-2)
    for i in range(nu - 1):
        a0, a1 = i * nv, (i + 1) * nv
        b0, b1 = a0 + n_pts, a1 + n_pts
        faces.append([a0, b0, b1])
        faces.append([a0, b1, a1])
    # Edge j = nv - 1
    for i in range(nu - 1):
        a0, a1 = i * nv + (nv - 1), (i + 1) * nv + (nv - 1)
        b0, b1 = a0 + n_pts, a1 + n_pts
        faces.append([a0, a1, b1])
        faces.append([a0, b1, b0])
    # Edge i = 0 (j = 0..nv-2)
    for j in range(nv - 1):
        a0, a1 = j, j + 1
        b0, b1 = a0 + n_pts, a1 + n_pts
        faces.append([a0, a1, b1])
        faces.append([a0, b1, b0])
    # Edge i = nu - 1
    base = (nu - 1) * nv
    for j in range(nv - 1):
        a0, a1 = base + j, base + j + 1
        b0, b1 = a0 + n_pts, a1 + n_pts
        faces.append([a0, b0, b1])
        faces.append([a0, b1, a1])

    return finalize_part(verts, np.asarray(faces, dtype=np.int64), uvs, fix_winding=True)


# ==============================================================================
# 1. MONOCOQUE & NEEDLE NOSECONE (`monocoque_nose`)
# ==============================================================================
def build_monocoque_nose(mat_livery: PBRMaterial) -> trimesh.Trimesh:
    """Smooth PCHIP-lofted tapered needle nosecone (Z=-3.120 -> -0.75) flowing into
    the sculpted survival cell cockpit tub (Z=-0.75 -> +0.42) with recessed cockpit opening.
    """
    z_k = [-3.120, -2.960, -2.620, -2.200, -1.962, -1.480, -0.980, -0.600, -0.200, 0.220, 0.440]
    yb_k = [0.155, 0.158, 0.172, 0.185, 0.182, 0.140, 0.058, 0.044, 0.044, 0.048, 0.056]
    yt_k = [0.188, 0.225, 0.292, 0.388, 0.452, 0.552, 0.612, 0.630, 0.636, 0.678, 0.742]
    wb_k = [0.048, 0.088, 0.128, 0.175, 0.202, 0.244, 0.278, 0.298, 0.304, 0.294, 0.272]
    wt_k = [0.044, 0.078, 0.112, 0.152, 0.178, 0.222, 0.264, 0.284, 0.278, 0.262, 0.232]
    ne_k = [2.05, 2.35, 2.75, 3.05, 3.25, 3.45, 3.65, 3.70, 3.70, 3.50, 3.30]

    def sculpt_cockpit(x, y, z, theta, _z_norm):
        zv = float(z[0])
        # Sculpted nose tip aerodynamic rounding (drooped oval spoon)
        if zv < -2.95:
            t_tip = smoothstep(-2.95, -3.12, zv)
            y = y - 0.008 * t_tip * np.maximum(np.sin(theta), 0.0)

        # Recessed cockpit opening (Z in [-0.56, +0.22], top deck |X| < 0.205)
        if -0.62 <= zv <= 0.28:
            z_open = float(smoothstep(-0.56, -0.44, zv) * (1.0 - smoothstep(0.14, 0.24, zv)))
            top_mask = smoothstep(0.32, 0.72, np.sin(theta))
            lat_in = 1.0 - smoothstep(0.145, 0.225, np.abs(x))
            well = z_open * top_mask * lat_in
            y = y - 0.265 * well

            # Subtle raised protective cockpit rim coaming outside the opening
            rim_band = smoothstep(0.185, 0.225, np.abs(x)) * (1.0 - smoothstep(0.245, 0.285, np.abs(x)))
            y = y + 0.014 * z_open * top_mask * rim_band

        return x, y, z

    part = loft_superellipse_z(
        z_knots=z_k,
        y_bot_knots=yb_k,
        y_top_knots=yt_k,
        w_bot_knots=wb_k,
        w_top_knots=wt_k,
        n_exp_knots=ne_k,
        n_rings=60,
        n_seg=40,
        u_range=(0.04, 0.96),
        v_range=(0.04, 0.72),
        sculpt_fn=sculpt_cockpit,
    )
    return merge_textured_parts([part], mat_livery)


# ==============================================================================
# 2. SCULPTED SIDEPODS, ENGINE COVER, AIRBOX & SHARK FIN (`sidepods_engine_cover`)
# ==============================================================================
def build_sidepods_engine_cover(mat_livery: PBRMaterial) -> trimesh.Trimesh:
    """Modern FIA ground-effect sculpted sidepods with overbite radiator lip,
    deep floor undercut, downwash water-slide gully, Coke-bottle rear taper,
    tall roll-hoop airbox intake, and crisp dorsal shark fin.
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []

    # --- A. Roll-Hoop Airbox, Engine Cover & Tapered Gearbox Spine ---
    z_ec = [0.220, 0.340, 0.480, 0.780, 1.120, 1.460, 1.740, 1.940]
    yb_ec = [0.055, 0.060, 0.068, 0.085, 0.115, 0.165, 0.235, 0.315]
    yt_ec = [0.745, 0.962, 0.955, 0.875, 0.765, 0.640, 0.530, 0.455]
    wb_ec = [0.278, 0.285, 0.288, 0.278, 0.248, 0.195, 0.145, 0.108]
    wt_ec = [0.165, 0.132, 0.122, 0.115, 0.105, 0.090, 0.075, 0.062]
    ne_ec = [3.2, 2.8, 2.8, 3.0, 3.0, 2.8, 2.6, 2.4]

    def sculpt_engine_cover(x, y, z, theta, _zn):
        zv = float(z[0])
        # Subtle shoulder sculpting beneath the tall roll hoop airbox
        sa = np.sin(theta)
        ca = np.cos(theta)
        pinch = smoothstep(0.15, 0.68, sa) * (1.0 - smoothstep(0.75, 0.95, sa))
        neck_z = float(smoothstep(0.24, 0.42, zv) * (1.0 - smoothstep(1.35, 1.85, zv)))
        x = x - np.sign(ca) * 0.032 * pinch * neck_z
        return x, y, z

    parts.append(
        loft_superellipse_z(
            z_knots=z_ec,
            y_bot_knots=yb_ec,
            y_top_knots=yt_ec,
            w_bot_knots=wb_ec,
            w_top_knots=wt_ec,
            n_exp_knots=ne_ec,
            n_rings=48,
            n_seg=36,
            u_range=(0.06, 0.94),
            v_range=(0.45, 0.96),
            sculpt_fn=sculpt_engine_cover,
        )
    )

    # --- B. Left (-X) & Right (+X) Undercut Ground-Effect Sidepods ---
    # Carefully clears rear tires (inner edge |X|=0.5725 at Z>=1.278):
    # At Z=1.22, outer sidepod X = 0.24 + 0.15 = 0.39 m (18 cm clean clearance!).
    z_sp = [-0.600, -0.520, -0.340, -0.050, 0.320, 0.720, 1.080, 1.320, 1.500]
    yb_sp = [0.435, 0.285, 0.220, 0.185, 0.155, 0.130, 0.125, 0.165, 0.230]
    yt_sp = [0.540, 0.565, 0.585, 0.588, 0.565, 0.510, 0.445, 0.395, 0.355]
    wb_sp = [0.160, 0.195, 0.215, 0.225, 0.210, 0.175, 0.130, 0.095, 0.062]
    wt_sp = [0.215, 0.235, 0.258, 0.265, 0.245, 0.205, 0.152, 0.105, 0.068]
    cx_mag = [0.455, 0.475, 0.492, 0.495, 0.468, 0.405, 0.315, 0.225, 0.165]
    ne_sp = [3.2, 3.6, 3.8, 3.8, 3.6, 3.4, 3.1, 2.8, 2.5]

    for side_sign in (-1.0, 1.0):
        cx_k = [side_sign * c for c in cx_mag]

        def make_sidepod_sculpt(ss: float):
            def sculpt_sp(x, y, z, theta, z_norm):
                zv = float(z[0])
                # Deep ground-effect undercut pulling lower-outer flank sharply inward
                sa = np.sin(theta)
                ca = np.cos(theta)
                outward_mask = smoothstep(0.0, 0.85, ss * ca)
                lower_mask = smoothstep(-0.15, -0.85, sa)
                undercut_z = float(smoothstep(-0.56, -0.25, zv) * (1.0 - smoothstep(0.85, 1.38, zv)))
                x = x - ss * 0.088 * outward_mask * lower_mask * undercut_z
                y = y + 0.042 * outward_mask * lower_mask * undercut_z

                # Sculpted upper water-slide downwash gully feeding airflow to rear beam wing
                top_mask = smoothstep(0.55, 0.96, sa)
                mid_lat = 1.0 - smoothstep(0.15, 0.72, np.abs(ca))
                gully_z = float(smoothstep(0.02, 0.35, zv) * (1.0 - smoothstep(1.18, 1.46, zv)))
                y = y - 0.042 * top_mask * mid_lat * gully_z

                # Subtle overbite intake lip shadow groove at Z=-0.56
                if zv < -0.48:
                    lip_m = float(smoothstep(-0.48, -0.58, zv)) * smoothstep(-0.8, 0.1, sa)
                    z = z + 0.045 * lip_m
                return x, y, z

            return sculpt_sp

        parts.append(
            loft_superellipse_z(
                z_knots=z_sp,
                y_bot_knots=yb_sp,
                y_top_knots=yt_sp,
                w_bot_knots=wb_sp,
                w_top_knots=wt_sp,
                cx_knots=cx_k,
                n_exp_knots=ne_sp,
                n_rings=44,
                n_seg=30,
                u_range=(0.06, 0.94),
                v_range=(0.18, 0.88),
                sculpt_fn=make_sidepod_sculpt(side_sign),
            )
        )

    # --- C. Crisp Dorsal Shark Fin (Z=+0.52 -> +1.86) ---
    fin_z = np.array([0.52, 0.90, 1.32, 1.68, 1.86], dtype=np.float64)
    fin_yb = PchipInterpolator(fin_z, [0.80, 0.71, 0.60, 0.50, 0.44])
    fin_yt = PchipInterpolator(fin_z, [0.945, 0.915, 0.865, 0.805, 0.740])

    def shark_fin_fn(U, V):
        Z = 0.52 + U * (1.86 - 0.52)
        yb = fin_yb(Z)
        yt = fin_yt(Z)
        Y = yb + V * (yt - yb)
        # Taper thickness cleanly toward top ridge and trailing edge
        half_t = 0.013 * (1.0 - 0.55 * U) * (1.0 - 0.45 * V) + 0.0025
        X = np.zeros_like(Z)
        return X, Y, Z, half_t, np.zeros_like(Z), np.zeros_like(Z)

    parts.append(build_sculpted_aero_panel(18, 8, shark_fin_fn, (0.20, 0.85), (0.35, 0.85)))

    return merge_textured_parts(parts, mat_livery)


# ==============================================================================
# 3. MULTI-ELEMENT CARBON FRONT WING (`front_wing_assembly`) & ENDPLATES
# ==============================================================================
def build_front_wing_assembly(mat_carbon: PBRMaterial) -> trimesh.Trimesh:
    """4-element cascading swept carbon front wing (span 1.94 m, Z=-3.105 to -2.45),
    gently arched central ground-effect spoon, nose mounting pylons, and slot-gap brackets.
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []
    x_k = [-0.970, -0.680, -0.320, 0.0, 0.320, 0.680, 0.970]

    # Element 1: Swept Mainplane (gentle nose spoon arch at center)
    parts.append(
        build_swept_airfoil_wing(
            x_knots=x_k,
            z_le_knots=[-2.875, -2.970, -3.065, -3.105, -3.065, -2.970, -2.875],
            y_le_knots=[0.068, 0.066, 0.072, 0.092, 0.072, 0.066, 0.068],
            chord_knots=[0.190, 0.215, 0.225, 0.215, 0.225, 0.215, 0.190],
            aoa_deg_knots=[5.5, 6.5, 6.0, 3.5, 6.0, 6.5, 5.5],
            camber=0.055,
            thickness=0.095,
            n_span=32,
            n_chord=12,
        )
    )

    # Element 2: Lower Cascading Flap
    parts.append(
        build_swept_airfoil_wing(
            x_knots=x_k,
            z_le_knots=[-2.725, -2.805, -2.885, -2.920, -2.885, -2.805, -2.725],
            y_le_knots=[0.105, 0.112, 0.118, 0.125, 0.118, 0.112, 0.105],
            chord_knots=[0.135, 0.155, 0.160, 0.145, 0.160, 0.155, 0.135],
            aoa_deg_knots=[11.0, 12.5, 11.5, 7.0, 11.5, 12.5, 11.0],
            camber=0.065,
            thickness=0.085,
            n_span=30,
            n_chord=12,
        )
    )

    # Element 3: Mid Cascading Flap
    parts.append(
        build_swept_airfoil_wing(
            x_knots=x_k,
            z_le_knots=[-2.625, -2.690, -2.755, -2.790, -2.755, -2.690, -2.625],
            y_le_knots=[0.145, 0.160, 0.165, 0.158, 0.165, 0.160, 0.145],
            chord_knots=[0.115, 0.138, 0.142, 0.122, 0.142, 0.138, 0.115],
            aoa_deg_knots=[17.5, 19.5, 18.0, 11.0, 18.0, 19.5, 17.5],
            camber=0.072,
            thickness=0.082,
            n_span=30,
            n_chord=12,
        )
    )

    # Element 4: Upper High-Downforce Trailing Flap (strictly clears steered front tires at Z <= -2.45)
    parts.append(
        build_swept_airfoil_wing(
            x_knots=x_k,
            z_le_knots=[-2.545, -2.590, -2.635, -2.675, -2.635, -2.590, -2.545],
            y_le_knots=[0.192, 0.214, 0.218, 0.185, 0.218, 0.214, 0.192],
            chord_knots=[0.095, 0.118, 0.125, 0.095, 0.125, 0.118, 0.095],
            aoa_deg_knots=[23.0, 26.5, 24.5, 14.0, 24.5, 26.5, 23.0],
            camber=0.075,
            thickness=0.080,
            n_span=30,
            n_chord=12,
        )
    )

    # Dual Carbon Nose Mounting Pylons + Slot-Gap Separator Brackets
    for sx in (-1.0, 1.0):
        # Nose pylon connecting underside of nosecone cleanly to mainplane
        def make_pylon(sign_x: float):
            def pylon_fn(U, V):
                Z = -2.96 + U * 0.24
                Y = 0.090 + V * 0.110
                X = np.full_like(Z, sign_x * (0.052 + 0.015 * V))
                ht = np.full_like(Z, 0.008)
                return X, Y, Z, ht, np.zeros_like(Z), np.zeros_like(Z)

            return pylon_fn

        parts.append(build_sculpted_aero_panel(6, 5, make_pylon(sx)))

        # Two tiny aerodynamic slot-gap separators per wing half linking all 4 blades
        for x_sep in (0.34, 0.72):
            pts = np.array(
                [
                    [sx * x_sep, 0.075, -2.92],
                    [sx * x_sep, 0.135, -2.74],
                    [sx * x_sep, 0.215, -2.55],
                ],
                dtype=np.float64,
            )
            parts.append(build_curved_tube(pts, 0.005, 0.012, n_rings=6, n_seg=8))

    return merge_textured_parts(parts, mat_carbon)


def build_front_wing_endplates(mat_livery: PBRMaterial) -> trimesh.Trimesh:
    """Swept curved FIA 2022+ front-wing outer endplates & S-curve outboard diveplanes.
    Outer width reaches X = +/-0.992 m -> total vehicle width W = 1.984 m (target 1.95..2.02 m).
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []
    for sx in (-1.0, 1.0):
        def make_ep(sign_x: float):
            def ep_fn(U, V):
                # U: 0 leading (-2.89) -> 1 trailing (-2.46); V: 0 bottom -> 1 rolled upper crest
                z_front = -2.895 + 0.145 * (V ** 1.35)
                z_rear = -2.460 - 0.025 * (V ** 1.5)
                Z = z_front + U * (z_rear - z_front)
                y_bot = 0.066 + 0.012 * U
                y_top = 0.215 + 0.105 * (U ** 0.72)
                Y = y_bot + V * (y_top - y_bot)
                # Iconic FIA inward roll near top crest, outer face reaching +/-0.990 m
                x_mid = sign_x * (0.984 - 0.042 * (V ** 2.2) + 0.006 * np.sin(np.pi * U))
                ht = np.full_like(Z, 0.007)
                return x_mid, Y, Z, ht, np.zeros_like(Z), np.zeros_like(Z)

            return ep_fn

        parts.append(build_sculpted_aero_panel(14, 10, make_ep(sx), (0.08, 0.92), (0.08, 0.92)))

        # Sculpted outboard S-curve diveplane winglet (max |X| = 0.993 m -> W = 1.986 m!)
        def make_diveplane(sign_x: float):
            def dp_fn(U, V):
                Z = -2.82 + U * 0.30
                Y = 0.135 + 0.065 * U + 0.015 * np.sin(np.pi * U)
                # Protrudes only 14 mm outboard from endplate (<= 0.993 m)
                X = sign_x * (0.976 + 0.017 * V)
                hy = np.full_like(Z, 0.0045)
                return X, Y, Z, np.zeros_like(Z), hy, np.zeros_like(Z)

            return dp_fn

        parts.append(build_sculpted_aero_panel(10, 4, make_diveplane(sx), (0.15, 0.85), (0.15, 0.85)))

    return merge_textured_parts(parts, mat_livery)


# ==============================================================================
# 4. UNDERFLOOR VENTURI TUNNELS, FLOOR EDGE WINGS & 5-STRAKE REAR DIFFUSER
# ==============================================================================
def build_underfloor_venturi_diffuser(mat_carbon: PBRMaterial) -> trimesh.Trimesh:
    """Full-length carbon ground-effect Venturi floor (Z=-0.96 -> +1.95, W=1.60 m),
    leading Venturi inlet fences, floor edge scroll wings, titanium skid plank,
    upward-swept 5-strake rear diffuser (Z=+1.35 -> +2.15), and rear crash structure.
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []

    # --- A. Main Venturi Underfloor Tray (tapers inside |X|<=0.49 ahead of rear tires!) ---
    z_fl = np.array([-0.96, -0.60, 0.25, 1.05, 1.24, 1.48, 1.95], dtype=np.float64)
    w_fl = PchipInterpolator(z_fl, [0.78, 0.80, 0.80, 0.79, 0.54, 0.49, 0.48])
    y_fl = PchipInterpolator(z_fl, [0.044, 0.042, 0.048, 0.056, 0.060, 0.072, 0.105])

    def floor_fn(U, V):
        Z = -0.96 + U * (1.95 - (-0.96))
        half_w = w_fl(Z)
        lat = (V - 0.5) * 2.0  # -1..+1
        X = lat * half_w
        # Subtle Venturi tunnel throat rise & outer floor-edge lip upturn
        edge_curl = 0.022 * smoothstep(0.84, 1.0, np.abs(lat)) * smoothstep(-0.75, -0.35, Z) * (1.0 - smoothstep(1.05, 1.28, Z))
        Y = y_fl(Z) + edge_curl
        hy = np.full_like(Z, 0.011)
        return X, Y, Z, np.zeros_like(Z), hy, np.zeros_like(Z)

    parts.append(build_sculpted_aero_panel(26, 16, floor_fn, (0.0, 4.0), (0.0, 2.5)))

    # --- B. Floor Edge Scroll Wings (Left & Right, Z=-0.45 -> +1.05) ---
    for sx in (-1.0, 1.0):
        def make_edge_wing(sign_x: float):
            def ew_fn(U, V):
                Z = -0.45 + U * 1.50
                X = sign_x * (0.765 + 0.048 * V)
                Y = 0.062 + 0.015 * U + 0.024 * (V ** 1.4)
                hy = np.full_like(Z, 0.005)
                return X, Y, Z, np.zeros_like(Z), hy, np.zeros_like(Z)

            return ew_fn

        parts.append(build_sculpted_aero_panel(14, 4, make_edge_wing(sx), (0.0, 2.5), (0.0, 0.4)))

    # --- C. Leading Venturi Tunnel Inlet Fences (3 pairs = 6 curved carbon strakes) ---
    for sx in (-1.0, 1.0):
        for x_base, h_top, sweep in [(0.34, 0.24, 0.04), (0.54, 0.22, 0.07), (0.74, 0.19, 0.09)]:
            def make_fence(sign_x: float, xb: float, ht_top: float, sw: float):
                def fence_fn(U, V):
                    Z = -0.95 + U * 0.52
                    Y = 0.042 + V * (ht_top - 0.042) * (1.0 - 0.22 * U)
                    X = sign_x * (xb + sw * (U ** 1.4))
                    ht = np.full_like(Z, 0.005)
                    return X, Y, Z, ht, np.zeros_like(Z), np.zeros_like(Z)

                return fence_fn

            parts.append(build_sculpted_aero_panel(8, 5, make_fence(sx, x_base, h_top, sweep)))

    # --- D. Upward-Swept 5-Strake Rear Diffuser (Z=+1.35 -> +2.15, |X| <= 0.485 m) ---
    def diffuser_ramp_fn(U, V):
        Z = 1.35 + U * (2.15 - 1.35)
        lat = (V - 0.5) * 2.0
        X = lat * 0.485
        # Dramatic curved expansion ramp from Y=0.058 up to Y=0.295 at diffuser exit
        Y = 0.058 + 0.237 * (U ** 1.45) - 0.014 * (lat ** 2) * U
        hy = np.full_like(Z, 0.009)
        return X, Y, Z, np.zeros_like(Z), hy, np.zeros_like(Z)

    parts.append(build_sculpted_aero_panel(14, 12, diffuser_ramp_fn, (0.0, 1.8), (0.0, 1.5)))

    # 5 Crisp Vertical Diffuser Strakes (X = -0.47, -0.235, 0.0, +0.235, +0.47)
    for x_strake in (-0.470, -0.235, 0.0, 0.235, 0.470):
        def make_strake(xs: float):
            def st_fn(U, V):
                Z = 1.42 + U * (2.15 - 1.42)
                y_roof = 0.062 + 0.233 * (U ** 1.45)
                y_bot = 0.055 + 0.030 * U
                Y = y_bot + V * (y_roof - y_bot)
                X = np.full_like(Z, xs)
                ht = np.full_like(Z, 0.0055)
                return X, Y, Z, ht, np.zeros_like(Z), np.zeros_like(Z)

            return st_fn

        parts.append(build_sculpted_aero_panel(8, 5, make_strake(x_strake)))

    # --- E. Central Rear Crash Structure & Exhaust Tailpipe ---
    parts.append(
        loft_superellipse_z(
            z_knots=[1.62, 1.85, 2.04, 2.16],
            y_bot_knots=[0.22, 0.24, 0.245, 0.248],
            y_top_knots=[0.41, 0.39, 0.365, 0.352],
            w_bot_knots=[0.115, 0.095, 0.072, 0.052],
            w_top_knots=[0.105, 0.088, 0.068, 0.048],
            n_exp_knots=[3.4, 3.4, 3.6, 3.8],
            n_rings=10,
            n_seg=16,
        )
    )
    # Central round exhaust tailpipe protruding cleanly above crash structure
    ex_pts = np.array([[0.0, 0.425, 1.88], [0.0, 0.432, 2.00], [0.0, 0.438, 2.10]], dtype=np.float64)
    parts.append(build_curved_tube(ex_pts, [0.046, 0.045, 0.044], [0.046, 0.045, 0.044], n_rings=6, n_seg=16))

    # --- F. Underbody Titanium Skid Plank (Y_bot = 0.026 m > 0.000 m) ---
    def plank_fn(U, V):
        Z = -0.88 + U * (1.35 - (-0.88))
        X = (V - 0.5) * 0.30
        Y = 0.030 + 0.012 * U
        hy = np.full_like(Z, 0.004)
        return X, Y, Z, np.zeros_like(Z), hy, np.zeros_like(Z)

    parts.append(build_sculpted_aero_panel(6, 4, plank_fn))

    return merge_textured_parts(parts, mat_carbon)


# ==============================================================================
# 5. REAR WING MAINPLANE, SWAN-NECK PYLONS, ENDPLATES & PIVOTED DRS FLAP
# ==============================================================================
def build_rear_wing_mainplane(mat_carbon: PBRMaterial) -> trimesh.Trimesh:
    """Dual biplane lower beam wing, dual swept swan-neck mounting pylons,
    curved upper mainplane spoon (Z=+1.95 -> +2.34, span 1.00 m), and DRS actuator pod.
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []
    x_bw = [-0.475, -0.24, 0.0, 0.24, 0.475]

    # Lower Beam Wing (Element 1 & Element 2)
    parts.append(
        build_swept_airfoil_wing(
            x_knots=x_bw,
            z_le_knots=[1.96, 1.94, 1.93, 1.94, 1.96],
            y_le_knots=[0.355, 0.345, 0.340, 0.345, 0.355],
            chord_knots=[0.16, 0.175, 0.18, 0.175, 0.16],
            aoa_deg_knots=[14.0, 15.0, 15.0, 15.0, 14.0],
            camber=0.06,
            thickness=0.09,
            n_span=18,
            n_chord=10,
        )
    )
    parts.append(
        build_swept_airfoil_wing(
            x_knots=x_bw,
            z_le_knots=[2.10, 2.09, 2.08, 2.09, 2.10],
            y_le_knots=[0.425, 0.415, 0.410, 0.415, 0.425],
            chord_knots=[0.135, 0.145, 0.15, 0.145, 0.135],
            aoa_deg_knots=[22.0, 23.0, 23.0, 23.0, 22.0],
            camber=0.065,
            thickness=0.085,
            n_span=18,
            n_chord=10,
        )
    )

    # Curved Upper Mainplane (FIA spoon profile: dips gracefully in center)
    x_mp = [-0.495, -0.34, -0.16, 0.0, 0.16, 0.34, 0.495]
    parts.append(
        build_swept_airfoil_wing(
            x_knots=x_mp,
            z_le_knots=[2.005, 1.980, 1.955, 1.945, 1.955, 1.980, 2.005],
            y_le_knots=[0.785, 0.768, 0.735, 0.720, 0.735, 0.768, 0.785],
            chord_knots=[0.275, 0.310, 0.345, 0.360, 0.345, 0.310, 0.275],
            aoa_deg_knots=[9.0, 10.5, 11.5, 12.0, 11.5, 10.5, 9.0],
            camber=0.085,
            thickness=0.105,
            n_span=30,
            n_chord=14,
        )
    )

    # Dual Swept Swan-Neck Carbon Mounting Pylons curving cleanly over mainplane top
    for sx in (-1.0, 1.0):
        pylon_pts = np.array(
            [
                [sx * 0.075, 0.360, 1.820],
                [sx * 0.082, 0.560, 1.880],
                [sx * 0.088, 0.770, 1.925],
                [sx * 0.092, 0.855, 1.990],
                [sx * 0.094, 0.810, 2.090],
                [sx * 0.094, 0.765, 2.130],
            ],
            dtype=np.float64,
        )
        parts.append(
            build_curved_tube(
                pylon_pts,
                r_a_knots=[0.042, 0.040, 0.036, 0.030, 0.026, 0.024],
                r_b_knots=[0.008, 0.007, 0.007, 0.007, 0.007, 0.007],
                n_rings=18,
                n_seg=12,
                up_hint=(0.0, 0.0, 1.0),
            )
        )

    # Central Teardrop DRS Actuator Pod mounted atop mainplane
    parts.append(
        loft_superellipse_z(
            z_knots=[2.02, 2.12, 2.24, 2.33],
            y_bot_knots=[0.745, 0.775, 0.805, 0.840],
            y_top_knots=[0.815, 0.885, 0.905, 0.892],
            w_bot_knots=[0.018, 0.028, 0.024, 0.012],
            w_top_knots=[0.016, 0.026, 0.022, 0.010],
            n_exp_knots=[2.2, 2.4, 2.4, 2.2],
            n_rings=10,
            n_seg=14,
        )
    )

    return merge_textured_parts(parts, mat_carbon)


def build_rear_wing_endplates(mat_livery: PBRMaterial) -> trimesh.Trimesh:
    """Sculpted FIA 2022+ rounded rear wing endplates curving seamlessly from upper mainplane
    down to the lower beam wing (trailing edge precisely at Z = +2.400 m -> L = 5.520 m).
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []
    for sx in (-1.0, 1.0):
        def make_rw_ep(sign_x: float):
            def rw_fn(U, V):
                # V=0 lower beam wing (Y=0.335), V=1 top crest (Y=0.942)
                # Smoothly swept FIA curved silhouette
                z_front = 1.945 - 0.045 * np.sin(np.pi * V) + 0.055 * (1.0 - V)
                z_rear = 2.240 + 0.160 * smoothstep(0.18, 0.86, V)
                Z = z_front + U * (z_rear - z_front)
                y_bot = 0.335 + 0.055 * (U ** 1.6)
                y_top = 0.895 + 0.048 * np.sin(np.pi * np.clip(U, 0.0, 1.0) ** 0.85)
                Y = y_bot + V * (y_top - y_bot)
                # Iconic FIA 2022+ S-curved waist flaring gently from beam wing up to mainplane
                x_mid = sign_x * (0.478 + 0.024 * smoothstep(0.25, 0.78, V) - 0.010 * (V ** 4))
                ht = np.full_like(Z, 0.0085)
                return x_mid, Y, Z, ht, np.zeros_like(Z), np.zeros_like(Z)

            return rw_fn

        parts.append(build_sculpted_aero_panel(14, 12, make_rw_ep(sx), (0.08, 0.92), (0.08, 0.92)))

    return merge_textured_parts(parts, mat_livery)


def build_drs_upper_flap(mat_carbon: PBRMaterial) -> trimesh.Trimesh:
    """Separate DRS upper flap mesh built in LOCAL hinge coordinates (hinge at (0, 0.905, 2.340)).
    Geometry extends forward (-Z) and downward (-Y) from the hinge so positive `rotation.x`
    (0 -> +0.49 rad) smoothly lifts the leading edge upward and opens the DRS slot gap!
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []
    x_k = [-0.486, -0.32, -0.14, 0.0, 0.14, 0.32, 0.486]

    # Leading edge sits ~28 mm above spoon mainplane; trailing edge sits directly on local hinge (0, 0, 0)
    # so rotation.x: 0 -> +0.49 rad (+28 deg) pivots the flap cleanly horizontal and opens the DRS slot!
    parts.append(
        build_swept_airfoil_wing(
            x_knots=x_k,
            z_le_knots=[-0.200, -0.212, -0.220, -0.222, -0.220, -0.212, -0.200],
            y_le_knots=[-0.086, -0.094, -0.104, -0.108, -0.104, -0.094, -0.086],
            chord_knots=[0.225, 0.238, 0.246, 0.248, 0.246, 0.238, 0.225],
            aoa_deg_knots=[24.0, 25.5, 26.5, 27.0, 26.5, 25.5, 24.0],
            camber=0.055,
            thickness=0.082,
            n_span=30,
            n_chord=14,
        )
    )

    # Twin hinge pivot clevises at X = +/-0.480 connecting cleanly into rear wing endplates
    for sx in (-1.0, 1.0):
        pts = np.array([[sx * 0.485, 0.0, 0.0], [sx * 0.440, -0.015, -0.035]], dtype=np.float64)
        parts.append(build_curved_tube(pts, 0.008, 0.008, n_rings=4, n_seg=8))

    return merge_textured_parts(parts, mat_carbon)


# ==============================================================================
# 6. TITANIUM HALO, COCKPIT INTERIOR, STEERING WHEEL, HELMET, MIRRORS, T-CAM
# ==============================================================================
def build_halo_titanium(mat_carbon: PBRMaterial) -> trimesh.Trimesh:
    """Smoothly lofted curved 3D aerodynamic Halo hoop + forward central A-pillar
    rooted cleanly into the survival cell ahead of and beside the driver.
    """
    # Curved Halo wishbone hoop (Port rear -> Port side -> Front brow -> Starboard side -> Starboard rear)
    hoop_pts = np.array(
        [
            [-0.272, 0.648, 0.185],
            [-0.278, 0.728, 0.015],
            [-0.258, 0.780, -0.195],
            [-0.175, 0.798, -0.395],
            [-0.080, 0.805, -0.495],
            [0.000, 0.806, -0.518],
            [0.080, 0.805, -0.495],
            [0.175, 0.798, -0.395],
            [0.258, 0.780, -0.195],
            [0.278, 0.728, 0.015],
            [0.272, 0.648, 0.185],
        ],
        dtype=np.float64,
    )
    hoop = build_curved_tube(
        hoop_pts,
        r_a_knots=[0.028, 0.027, 0.025, 0.023, 0.022, 0.023, 0.022, 0.023, 0.025, 0.027, 0.028],
        r_b_knots=[0.022, 0.022, 0.022, 0.022, 0.022, 0.024, 0.022, 0.022, 0.022, 0.022, 0.022],
        n_rings=44,
        n_seg=20,
        v_repeat=6.0,
    )

    # Forward central aerodynamic A-pillar strut (slender 30 mm width for crisp cockpit sightlines)
    pillar_pts = np.array(
        [
            [0.0, 0.595, -0.618],
            [0.0, 0.670, -0.588],
            [0.0, 0.742, -0.550],
            [0.0, 0.802, -0.514],
        ],
        dtype=np.float64,
    )
    pillar = build_curved_tube(
        pillar_pts,
        r_a_knots=[0.032, 0.028, 0.026, 0.025],
        r_b_knots=[0.015, 0.014, 0.014, 0.015],
        n_rings=14,
        n_seg=16,
        up_hint=(0.0, 0.0, 1.0),
    )

    return merge_textured_parts([hoop, pillar], mat_carbon)


def build_cockpit_interior(mat_carbon: PBRMaterial) -> trimesh.Trimesh:
    """Recessed cockpit bucket liner, FIA wrap-around energy-absorbing headrest collar,
    steering column shaft, dark sidepod radiator intake cavities, and airbox intake throat.
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []

    # Wrap-around sculpted FIA headrest foam collar framing the driver's helmet
    hr_pts = np.array(
        [
            [-0.205, 0.625, -0.180],
            [-0.215, 0.642, -0.020],
            [-0.185, 0.665, 0.165],
            [-0.095, 0.688, 0.255],
            [0.000, 0.695, 0.275],
            [0.095, 0.688, 0.255],
            [0.185, 0.665, 0.165],
            [0.215, 0.642, -0.020],
            [0.205, 0.625, -0.180],
        ],
        dtype=np.float64,
    )
    parts.append(build_curved_tube(hr_pts, 0.034, 0.028, n_rings=24, n_seg=14))

    # Dark cockpit bucket floor / seat back liner
    parts.append(
        loft_superellipse_z(
            z_knots=[-0.54, -0.28, 0.02, 0.24],
            y_bot_knots=[0.24, 0.20, 0.22, 0.34],
            y_top_knots=[0.42, 0.39, 0.44, 0.62],
            w_bot_knots=[0.185, 0.195, 0.190, 0.165],
            w_top_knots=[0.195, 0.205, 0.198, 0.175],
            n_exp_knots=[3.4, 3.4, 3.2, 3.0],
            n_rings=10,
            n_seg=16,
        )
    )

    # Steering column shaft connecting cockpit front bulkhead to steering wheel hub
    col_pts = np.array([[0.0, 0.505, -0.620], [0.0, 0.560, -0.460]], dtype=np.float64)
    parts.append(build_curved_tube(col_pts, 0.018, 0.018, n_rings=4, n_seg=12))

    # Left & Right recessed dark-mesh sidepod radiator intake cavities (Z ~ -0.56)
    for sx in (-1.0, 1.0):
        def make_rad(sign_x: float):
            def rad_fn(U, V):
                X = sign_x * (0.295 + U * 0.375)
                Y = 0.325 + V * 0.185
                Z = -0.535 - 0.025 * V + 0.025 * U
                hz = np.full_like(Z, 0.015)
                return X, Y, Z, np.zeros_like(Z), np.zeros_like(Z), hz

            return rad_fn

        parts.append(build_sculpted_aero_panel(8, 6, make_rad(sx)))

    # Roll-hoop dark airbox intake recess above driver's helmet (Z ~ +0.32, Y = 0.80..0.93)
    def airbox_fn(U, V):
        ang = (U - 0.5) * np.pi
        r_sc = 0.25 + 0.75 * V
        X = 0.088 * r_sc * np.sin(ang)
        Y = 0.855 + 0.068 * r_sc * np.cos(ang)
        Z = np.full_like(X, 0.315)
        hz = np.full_like(X, 0.018)
        return X, Y, Z, np.zeros_like(X), np.zeros_like(X), hz

    parts.append(build_sculpted_aero_panel(10, 4, airbox_fn))

    return merge_textured_parts(parts, mat_carbon)


def build_steering_wheel(mat_steering_dash: PBRMaterial) -> trimesh.Trimesh:
    """Authentic F1 butterfly carbon steering wheel in LOCAL hub coordinates.
    Flat front OLED faceplate sits at Z = +0.016 facing +Z (driver's eyes) with clean
    orthographic UVs (u=0 left/-X -> u=1 right/+X, v=0 bottom/-Y -> v=1 top/+Y).
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []

    # Central telemetry faceplate housing (width 0.250 m x height 0.142 m x thickness 0.032 m)
    def plate_fn(U, V):
        X = (U - 0.5) * 0.250
        Y = (V - 0.5) * 0.142
        # Subtle butterfly top/bottom waist scallops
        waist = 1.0 - 0.09 * np.exp(-((X / 0.075) ** 2))
        Y = Y * waist
        Z = np.zeros_like(X)
        hz = np.full_like(X, 0.016)
        return X, Y, Z, np.zeros_like(X), np.zeros_like(X), hz

    # Map U=0..1 (-X..+X) -> u=0.04..0.96, V=0..1 (-Y..+Y) -> v=0.04..0.96 (100% upright!)
    parts.append(build_sculpted_aero_panel(12, 8, plate_fn, (0.04, 0.96), (0.04, 0.96)))

    # Sculpted left & right ergonomic butterfly side grip handles
    for sx in (-1.0, 1.0):
        grip_pts = np.array(
            [
                [sx * 0.112, 0.066, 0.002],
                [sx * 0.138, 0.042, 0.004],
                [sx * 0.142, 0.000, 0.006],
                [sx * 0.136, -0.046, 0.004],
                [sx * 0.110, -0.068, 0.002],
            ],
            dtype=np.float64,
        )
        parts.append(build_curved_tube(grip_pts, 0.015, 0.018, n_rings=12, n_seg=10, u_repeat=0.15, v_repeat=0.25))

        # Rear carbon shift paddles
        def make_paddle(sign_x: float):
            def pad_fn(U, V):
                X = sign_x * (0.048 + U * 0.062)
                Y = -0.015 + V * 0.045
                Z = np.full_like(X, -0.026)
                hz = np.full_like(X, 0.003)
                return X, Y, Z, np.zeros_like(X), np.zeros_like(X), hz

            return pad_fn

        parts.append(build_sculpted_aero_panel(4, 3, make_paddle(sx), (0.02, 0.10), (0.02, 0.10)))

    # Rear quick-release hub boss
    boss_pts = np.array([[0.0, 0.0, -0.045], [0.0, 0.0, -0.014]], dtype=np.float64)
    parts.append(build_curved_tube(boss_pts, 0.028, 0.028, n_rings=4, n_seg=12, u_repeat=0.1, v_repeat=0.1))

    return merge_textured_parts(parts, mat_steering_dash)


def build_driver_helmet(mat_helmet: PBRMaterial) -> trimesh.Trimesh:
    """Smoothly lofted aerodynamic FIA 8860 F1 driver helmet centered at (0, 0.705, +0.095)
    with sculpted forward chin spoiler, recessed visor band, and duplicated-seam cylindrical
    UVs aligned strictly so the visor (u = 0.50) faces -Z (FORWARD).
    """
    y_k = np.array([0.585, 0.610, 0.648, 0.690, 0.732, 0.772, 0.805, 0.828, 0.838], dtype=np.float64)
    rx_fn = PchipInterpolator(y_k, [0.088, 0.106, 0.114, 0.118, 0.116, 0.106, 0.084, 0.048, 0.010])
    rz_fn = PchipInterpolator(y_k, [0.102, 0.130, 0.136, 0.134, 0.132, 0.122, 0.098, 0.056, 0.012])
    cz_fn = PchipInterpolator(y_k, [0.102, 0.092, 0.090, 0.094, 0.098, 0.102, 0.106, 0.108, 0.110])

    n_rings = 28
    n_seg = 32
    cols = n_seg + 1
    y_grid = np.linspace(y_k[0], y_k[-1], n_rings)
    y_span = float(y_k[-1] - y_k[0])

    u_frac = np.linspace(0.0, 1.0, cols)
    # phi=0 at u=0.50 -> points strictly -Z (FORWARD); seam at u=0,1 (+Z rear against headrest)
    phi = (u_frac - 0.5) * (2.0 * np.pi)
    cos_p = np.cos(phi)  # +1 at -Z front (visor), -1 at +Z rear
    sin_p = np.sin(phi)  # -1 at +X viewer-left, +1 at -X viewer-right

    verts_list = []
    uvs_list = []
    for yv in y_grid:
        vn = float((yv - y_k[0]) / y_span)
        rx = float(rx_fn(yv))
        rz = float(rz_fn(yv))
        cz = float(cz_fn(yv))

        # Sculpted forward chin aero lip (v ~ 0.15..0.34, front cos_p > 0.3)
        chin_lip = 0.011 * float(smoothstep(0.08, 0.22, vn) * (1.0 - smoothstep(0.32, 0.44, vn))) * smoothstep(0.25, 0.85, cos_p)
        # Subtle recessed dark visor strip (v ~ 0.42..0.64, front cos_p > 0.2)
        visor_rec = -0.005 * float(smoothstep(0.38, 0.46, vn) * (1.0 - smoothstep(0.60, 0.68, vn))) * smoothstep(0.15, 0.70, cos_p)
        # Rear aerodynamic spoiler lip (v ~ 0.55..0.82, rear cos_p < -0.3)
        rear_wing = 0.012 * float(smoothstep(0.50, 0.68, vn) * (1.0 - smoothstep(0.76, 0.90, vn))) * smoothstep(0.30, 0.85, -cos_p)

        x_ring = -rx * sin_p
        y_ring = np.full(cols, yv, dtype=np.float64)
        z_ring = cz - (rz + chin_lip + visor_rec) * cos_p + rear_wing * (-cos_p)

        x_ring[-1] = x_ring[0]
        y_ring[-1] = y_ring[0]
        z_ring[-1] = z_ring[0]

        verts_list.append(np.stack([x_ring, y_ring, z_ring], axis=-1))
        uvs_list.append(np.stack([u_frac, np.full(cols, 0.04 + 0.92 * vn)], axis=-1))

    verts = np.concatenate(verts_list, axis=0)
    uvs = np.concatenate(uvs_list, axis=0)

    faces = []
    # Winding: at phi=0 (-Z front), dP/d(ic) = (-X), dP/d(ir) = (+Y); (-X) x (+Y) = -Z (OUTWARD!)
    for ir in range(n_rings - 1):
        r0 = ir * cols
        r1 = (ir + 1) * cols
        for ic in range(n_seg):
            v00 = r0 + ic
            v10 = r0 + ic + 1
            v01 = r1 + ic
            v11 = r1 + ic + 1
            faces.append([v00, v10, v11])
            faces.append([v00, v11, v01])

    # Caps at neck base & crown
    b_idx = len(verts)
    t_idx = len(verts) + 1
    top_start = (n_rings - 1) * cols
    b_c = verts[0:n_seg].mean(axis=0)
    t_c = verts[top_start : top_start + n_seg].mean(axis=0)
    verts = np.vstack([verts, [b_c, t_c]])
    uvs = np.vstack([uvs, [[0.5, 0.02], [0.5, 0.98]]])
    for ic in range(n_seg):
        faces.append([b_idx, ic + 1, ic])
        faces.append([t_idx, top_start + ic, top_start + ic + 1])

    part = finalize_part(verts, np.asarray(faces, dtype=np.int64), uvs, fix_winding=True)
    return merge_textured_parts([part], mat_helmet)


def build_side_mirrors(mat_livery: PBRMaterial) -> trimesh.Trimesh:
    """Left & right sculpted aerodynamic F1 wing mirrors mounted on thin aero stay stalks."""
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []
    for sx in (-1.0, 1.0):
        # Teardrop mirror pod housing
        parts.append(
            loft_superellipse_z(
                z_knots=[-0.505, -0.465, -0.415, -0.375],
                y_bot_knots=[0.612, 0.598, 0.600, 0.606],
                y_top_knots=[0.638, 0.654, 0.652, 0.642],
                w_bot_knots=[0.028, 0.062, 0.066, 0.056],
                w_top_knots=[0.026, 0.058, 0.062, 0.052],
                cx_knots=[sx * 0.485, sx * 0.495, sx * 0.498, sx * 0.495],
                n_exp_knots=[2.2, 3.0, 3.4, 3.6],
                n_rings=10,
                n_seg=14,
                u_range=(0.15, 0.85),
                v_range=(0.25, 0.55),
            )
        )
        # Inner horizontal stay stalk anchoring cleanly into monocoque flank
        stalk_in = np.array(
            [[sx * 0.280, 0.585, -0.455], [sx * 0.390, 0.608, -0.450], [sx * 0.465, 0.618, -0.445]],
            dtype=np.float64,
        )
        parts.append(build_curved_tube(stalk_in, 0.006, 0.015, n_rings=6, n_seg=8))
        # Vertical aero vane stay dropping to sidepod top shoulder
        stalk_dn = np.array(
            [[sx * 0.525, 0.545, -0.455], [sx * 0.522, 0.608, -0.448]],
            dtype=np.float64,
        )
        parts.append(build_curved_tube(stalk_dn, 0.012, 0.005, n_rings=4, n_seg=8, up_hint=(0.0, 0.0, 1.0)))

    return merge_textured_parts(parts, mat_livery)


def build_t_cam_pod(mat_carbon: PBRMaterial) -> trimesh.Trimesh:
    """Regulation FIA T-shaped broadcast camera pod mounted atop the roll hoop
    (top at Y = 1.065 m -> total vehicle height H = 1.065 m inside 0.94..1.12 m).
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []
    # Vertical aerodynamic mast (Z=+0.36..+0.47, Y=0.945..1.048)
    mast_pts = np.array([[0.0, 0.942, 0.405], [0.0, 1.000, 0.410], [0.0, 1.048, 0.415]], dtype=np.float64)
    parts.append(build_curved_tube(mast_pts, 0.044, 0.014, n_rings=6, n_seg=12, up_hint=(0.0, 0.0, 1.0)))

    # Horizontal streamlined T-cam cross-bar (X=-0.145..+0.145, Y_top=1.065 m)
    bar_pts = np.array(
        [[-0.145, 1.051, 0.412], [-0.070, 1.052, 0.412], [0.0, 1.053, 0.412], [0.070, 1.052, 0.412], [0.145, 1.051, 0.412]],
        dtype=np.float64,
    )
    parts.append(
        build_curved_tube(
            bar_pts,
            r_a_knots=[0.011, 0.012, 0.012, 0.012, 0.011],
            r_b_knots=[0.042, 0.044, 0.046, 0.044, 0.042],
            n_rings=12,
            n_seg=14,
            up_hint=(0.0, 1.0, 0.0),
        )
    )
    return merge_textured_parts(parts, mat_carbon)


# ==============================================================================
# 7. SUSPENSION WISHBONES & REAR FIA RAIN LIGHT
# ==============================================================================
def build_suspension_wishbones(mat_carbon: PBRMaterial) -> trimesh.Trimesh:
    """Aerodynamic flattened-profile carbon double-wishbone A-arms, pushrods, pullrods,
    steering track rods, and rear half-shafts connecting chassis hardpoints to all 4 uprights.
    """
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []

    def add_arm(p0, p1, thick: float = 0.0085, chord: float = 0.022):
        p0 = np.asarray(p0, dtype=np.float64)
        p1 = np.asarray(p1, dtype=np.float64)
        mid = 0.5 * (p0 + p1)
        pts = np.vstack([p0, mid, p1])
        parts.append(build_curved_tube(pts, thick, chord, n_rings=6, n_seg=8))

    for sx in (-1.0, 1.0):
        # --- Front Suspension (hub at (±0.800, 0.360, -1.962), upright inner anchor |X|=0.635) ---
        # Upper wishbone (front & rear legs)
        add_arm([sx * 0.175, 0.435, -2.140], [sx * 0.635, 0.448, -1.955])
        add_arm([sx * 0.210, 0.445, -1.660], [sx * 0.635, 0.448, -1.955])
        # Lower wishbone (front & rear legs)
        add_arm([sx * 0.165, 0.205, -2.120], [sx * 0.635, 0.238, -1.965])
        add_arm([sx * 0.200, 0.195, -1.640], [sx * 0.635, 0.238, -1.965])
        # Front pullrod / pushrod diagonal strut
        add_arm([sx * 0.195, 0.432, -1.860], [sx * 0.625, 0.245, -1.962], thick=0.007, chord=0.015)
        # Steering track rod
        add_arm([sx * 0.185, 0.305, -2.015], [sx * 0.630, 0.318, -2.020], thick=0.007, chord=0.014)

        # --- Rear Suspension (hub at (±0.775, 0.360, +1.638), upright inner anchor |X|=0.562) ---
        # Upper wishbone
        add_arm([sx * 0.215, 0.442, 1.350], [sx * 0.562, 0.448, 1.640])
        add_arm([sx * 0.145, 0.425, 1.845], [sx * 0.562, 0.448, 1.640])
        # Lower wishbone
        add_arm([sx * 0.205, 0.208, 1.335], [sx * 0.562, 0.238, 1.635])
        add_arm([sx * 0.140, 0.215, 1.855], [sx * 0.562, 0.238, 1.635])
        # Rear pullrod diagonal
        add_arm([sx * 0.165, 0.220, 1.500], [sx * 0.558, 0.440, 1.638], thick=0.007, chord=0.015)
        # Rear drive half-shaft
        add_arm([sx * 0.165, 0.352, 1.638], [sx * 0.575, 0.360, 1.638], thick=0.012, chord=0.014)

    return merge_textured_parts(parts, mat_carbon)


def build_rear_rain_light(mat_rain_light: PBRMaterial) -> trimesh.Trimesh:
    """Recessed vertical FIA rain-light LED bar on rear crash structure (Z=+2.165, Y=0.300)."""
    def led_fn(U, V):
        X = (U - 0.5) * 0.044
        Y = 0.258 + V * 0.088
        Z = np.full_like(X, 2.164)
        hz = np.full_like(X, 0.009)
        return X, Y, Z, np.zeros_like(X), np.zeros_like(X), hz

    part = build_sculpted_aero_panel(4, 6, led_fn, (0.1, 0.9), (0.1, 0.9))
    return merge_textured_parts([part], mat_rain_light)


# ==============================================================================
# 8. ARTICULATED WHEEL CORNER ASSEMBLIES (TIRES, OPEN 10-SPOKE RIMS, BRAKES)
# ==============================================================================
def build_tire_tread(width: float, mat_tire_tread: PBRMaterial) -> trimesh.Trimesh:
    """Profiled 18-inch F1 racing slick tread with smooth PCHIP rounded shoulders.
    Hub center at (0, 0, 0); exact bottom vertex at (0, -0.360000, 0) -> Y = 0.0000 m grounded!
    """
    half_w = 0.5 * width
    # Symmetric PCHIP tire cross-section: flat-crowned slick contact patch + meaty rounded shoulder
    x_k = np.array(
        [-1.00, -0.94, -0.84, -0.70, -0.42, 0.00, 0.42, 0.70, 0.84, 0.94, 1.00],
        dtype=np.float64,
    ) * half_w
    r_k = np.array(
        [0.3180, 0.3365, 0.3510, 0.3582, 0.3598, 0.3600, 0.3598, 0.3582, 0.3510, 0.3365, 0.3180],
        dtype=np.float64,
    )
    r_fn = PchipInterpolator(x_k, r_k)

    # Odd n_prof=13 puts exact x=0.0 at index 6 (r=0.360000); n_circ=48 (divisible by 4) puts exact theta=-pi/2!
    n_prof = 13
    n_circ = 48
    cols = n_circ + 1
    x_grid = np.linspace(-half_w, half_w, n_prof)
    theta = np.linspace(0.0, 2.0 * np.pi, cols)
    st = np.sin(theta)
    ct = np.cos(theta)

    verts_list = []
    uvs_list = []
    for ix, xv in enumerate(x_grid):
        r = float(r_fn(xv))
        x_ring = np.full(cols, xv, dtype=np.float64)
        y_ring = r * st
        z_ring = r * ct
        y_ring[-1] = y_ring[0]
        z_ring[-1] = z_ring[0]

        v_val = ix / (n_prof - 1)
        u_ring = np.linspace(0.0, 3.0, cols)  # Seamless 3x repeat around circumference
        verts_list.append(np.stack([x_ring, y_ring, z_ring], axis=-1))
        uvs_list.append(np.stack([u_ring, np.full(cols, v_val)], axis=-1))

    verts = np.concatenate(verts_list, axis=0)
    uvs = np.concatenate(uvs_list, axis=0)

    faces = []
    # Winding: ir along +X, ic along +theta (at theta=0/+Z, +ic = +Y); (+X) x (+Y) = +Z (OUTWARD!)
    for ir in range(n_prof - 1):
        r0 = ir * cols
        r1 = (ir + 1) * cols
        for ic in range(n_circ):
            v00 = r0 + ic
            v10 = r0 + ic + 1
            v01 = r1 + ic
            v11 = r1 + ic + 1
            faces.append([v00, v01, v11])
            faces.append([v00, v11, v10])

    part = finalize_part(verts, np.asarray(faces, dtype=np.int64), uvs, fix_winding=False)
    # Guarantee outward radial normals explicitly
    mesh = part[0]
    radial = mesh.triangles_center.copy()
    radial[:, 0] = 0.0
    if float(np.mean(np.sum(mesh.face_normals * radial, axis=1))) < 0.0:
        mesh.invert()
    trimesh.repair.fix_normals(mesh)
    return merge_textured_parts([(mesh, part[1])], mat_tire_tread)


def build_tire_sidewall(width: float, side_sign: float, mat_tire_sidewall: PBRMaterial) -> trimesh.Trimesh:
    """Sculpted bulging outer & inner slick tire sidewalls with exact concentric planar radial UVs
    centered at (0.5, 0.5) so Pirelli compound rings & 'P ZERO' lettering align non-mirrored.
    """
    half_w = 0.5 * width
    # Radial profile from rim bead (0.226 m) with subtle sidewall bulge out to tread shoulder (0.318 m)
    r_prof = np.array([0.2260, 0.2480, 0.2780, 0.3020, 0.3180], dtype=np.float64)
    x_prof = np.array(
        [half_w - 0.011, half_w + 0.002, half_w + 0.006, half_w + 0.004, half_w],
        dtype=np.float64,
    )
    n_rad = len(r_prof)
    n_circ = 48
    cols = n_circ + 1
    theta = np.linspace(0.0, 2.0 * np.pi, cols)
    st = np.sin(theta)
    ct = np.cos(theta)
    r_uv_scale = 0.485 / 0.320

    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []
    # Build both outer sidewall (face_dir = side_sign) and inner sidewall (face_dir = -side_sign)
    for face_dir in (side_sign, -side_sign):
        verts_list = []
        uvs_list = []
        for ir in range(n_rad):
            rv = r_prof[ir]
            xv = face_dir * x_prof[ir]
            y_ring = rv * st
            z_ring = rv * ct
            y_ring[-1] = y_ring[0]
            z_ring[-1] = z_ring[0]
            x_ring = np.full(cols, xv, dtype=np.float64)

            # Non-mirrored radial planar UV when looking straight at this sidewall face
            u_ring = np.clip(0.5 - face_dir * z_ring * r_uv_scale, 0.005, 0.995)
            v_ring = np.clip(0.5 + y_ring * r_uv_scale, 0.005, 0.995)
            verts_list.append(np.stack([x_ring, y_ring, z_ring], axis=-1))
            uvs_list.append(np.stack([u_ring, v_ring], axis=-1))

        verts = np.concatenate(verts_list, axis=0)
        uvs = np.concatenate(uvs_list, axis=0)

        faces = []
        for ir in range(n_rad - 1):
            r0 = ir * cols
            r1 = (ir + 1) * cols
            for ic in range(n_circ):
                v00 = r0 + ic
                v10 = r0 + ic + 1
                v01 = r1 + ic
                v11 = r1 + ic + 1
                # (dP/dr) x (dP/dtheta) points along -X; reverse for +X face
                if face_dir < 0.0:
                    faces.append([v00, v01, v11])
                    faces.append([v00, v11, v10])
                else:
                    faces.append([v00, v11, v01])
                    faces.append([v00, v10, v11])

        mesh, uv_arr = finalize_part(verts, np.asarray(faces, dtype=np.int64), uvs, fix_winding=False)
        trimesh.repair.fix_normals(mesh)
        if float(np.mean(mesh.face_normals[:, 0] * face_dir)) < 0.0:
            mesh.invert()
        parts.append((mesh, uv_arr))

    return merge_textured_parts(parts, mat_tire_sidewall)


def build_wheel_rim(width: float, side_sign: float, mat_wheel_rim: PBRMaterial) -> trimesh.Trimesh:
    """Sculpted 18-inch forged magnesium racing wheel:
    - Outer carbon/forged aero bead lip & recessed barrel (R_bead=0.229 m, R_inner=0.204 m)
    - 10 sculpted 3D twin-Y forged spokes leaving open windows so glowing brake discs shine through!
    - Central conical hub + center-lock wheel nut
    - Concentric planar radial UVs centered at (0.5, 0.5) for `wheel_rim_forged.png`.
    """
    half_w = 0.5 * width
    r_uv_scale = 0.488 / 0.230
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []

    def project_radial_uv(verts_arr: np.ndarray) -> np.ndarray:
        u = np.clip(0.5 - side_sign * verts_arr[:, 2] * r_uv_scale, 0.005, 0.995)
        v = np.clip(0.5 + verts_arr[:, 1] * r_uv_scale, 0.005, 0.995)
        return np.stack([u, v], axis=-1).astype(np.float32)

    # --- A. Watertight Closed Revolved Rim Lip & Inner Barrel (cross-section loop) ---
    # Closed loop in (x_along_side_sign, r) around rim barrel wall thickness
    prof_x = np.array(
        [
            half_w - 0.009,   # outer flange lip top
            half_w - 0.022,   # outer aero lip face
            half_w - 0.036,   # dish step inner edge
            -(half_w - 0.016),  # inner barrel inner wall
            -(half_w - 0.012),  # inner bead flange top
            -(half_w - 0.018),  # inner barrel outer wall
            half_w - 0.018,   # outer barrel under tire bead
            half_w - 0.009,   # close loop
        ],
        dtype=np.float64,
    ) * side_sign
    prof_r = np.array([0.229, 0.214, 0.202, 0.202, 0.228, 0.222, 0.224, 0.229], dtype=np.float64)

    n_p = len(prof_x)
    n_circ = 40
    cols = n_circ + 1
    theta = np.linspace(0.0, 2.0 * np.pi, cols)
    st, ct = np.sin(theta), np.cos(theta)

    b_verts = []
    for ip in range(n_p):
        xv = prof_x[ip]
        rv = prof_r[ip]
        y_ring = rv * st
        z_ring = rv * ct
        y_ring[-1] = y_ring[0]
        z_ring[-1] = z_ring[0]
        b_verts.append(np.stack([np.full(cols, xv), y_ring, z_ring], axis=-1))

    b_verts = np.concatenate(b_verts, axis=0)
    b_faces = []
    for ip in range(n_p - 1):
        r0 = ip * cols
        r1 = (ip + 1) * cols
        for ic in range(n_circ):
            v00, v10 = r0 + ic, r0 + ic + 1
            v01, v11 = r1 + ic, r1 + ic + 1
            b_faces.append([v00, v01, v11])
            b_faces.append([v00, v11, v10])

    b_mesh, _ = finalize_part(b_verts, np.asarray(b_faces, dtype=np.int64), project_radial_uv(b_verts), fix_winding=True)
    parts.append((b_mesh, project_radial_uv(b_mesh.vertices)))

    # --- B. 10 Sculpted Twin-Y Forged Spokes (5 pairs -> crisp open brake visibility!) ---
    for k in range(5):
        base_ang = 2.0 * np.pi * k / 5.0
        for d_ang in (-0.18, +0.18):
            ang_in = base_ang + d_ang * 0.55
            ang_out = base_ang + d_ang * 1.15
            spoke_pts = np.array(
                [
                    [side_sign * (half_w - 0.030), 0.056 * np.sin(ang_in), 0.056 * np.cos(ang_in)],
                    [side_sign * (half_w - 0.025), 0.132 * np.sin(0.5 * (ang_in + ang_out)), 0.132 * np.cos(0.5 * (ang_in + ang_out))],
                    [side_sign * (half_w - 0.028), 0.210 * np.sin(ang_out), 0.210 * np.cos(ang_out)],
                ],
                dtype=np.float64,
            )
            sp_m, _ = build_curved_tube(
                spoke_pts,
                r_a_knots=[0.011, 0.009, 0.008],
                r_b_knots=[0.010, 0.009, 0.008],
                n_rings=4,
                n_seg=6,
                up_hint=(1.0, 0.0, 0.0),
            )
            parts.append((sp_m, project_radial_uv(sp_m.vertices)))

    # --- C. Central Forged Hub & Center-Lock Wheel Nut (100% watertight) ---
    nut_x = np.array([half_w - 0.052, half_w - 0.032, half_w - 0.020, half_w - 0.012], dtype=np.float64) * side_sign
    nut_r = np.array([0.068, 0.066, 0.044, 0.030], dtype=np.float64)
    n_c = 24
    c_cols = n_c + 1
    th_n = np.linspace(0.0, 2.0 * np.pi, c_cols)
    sn, cn = np.sin(th_n), np.cos(th_n)

    n_verts = []
    for ir in range(len(nut_x)):
        y_r = nut_r[ir] * sn
        z_r = nut_r[ir] * cn
        y_r[-1], z_r[-1] = y_r[0], z_r[0]
        n_verts.append(np.stack([np.full(c_cols, nut_x[ir]), y_r, z_r], axis=-1))
    n_verts = np.concatenate(n_verts, axis=0)
    n_faces = []
    for ir in range(len(nut_x) - 1):
        r0, r1 = ir * c_cols, (ir + 1) * c_cols
        for ic in range(n_c):
            v00, v10 = r0 + ic, r0 + ic + 1
            v01, v11 = r1 + ic, r1 + ic + 1
            if side_sign > 0.0:
                n_faces.append([v00, v01, v11])
                n_faces.append([v00, v11, v10])
            else:
                n_faces.append([v00, v11, v01])
                n_faces.append([v00, v10, v11])

    # Close both rear face (ir=0) and front center-lock face (ir=last) cleanly
    c_back = np.array([nut_x[0], 0.0, 0.0])
    c_front = np.array([nut_x[-1], 0.0, 0.0])
    idx_b = len(n_verts)
    idx_f = len(n_verts) + 1
    last_row = (len(nut_x) - 1) * c_cols
    n_verts = np.vstack([n_verts, c_back, c_front])
    for ic in range(n_c):
        if side_sign > 0.0:
            n_faces.append([idx_b, ic, ic + 1])
            n_faces.append([idx_f, last_row + ic + 1, last_row + ic])
        else:
            n_faces.append([idx_b, ic + 1, ic])
            n_faces.append([idx_f, last_row + ic, last_row + ic + 1])

    n_mesh, _ = finalize_part(n_verts, np.asarray(n_faces, dtype=np.int64), project_radial_uv(n_verts), fix_winding=True)
    parts.append((n_mesh, project_radial_uv(n_mesh.vertices)))

    return merge_textured_parts(parts, mat_wheel_rim)


def build_brake_rotor(width: float, side_sign: float, mat_brake_rotor: PBRMaterial) -> trimesh.Trimesh:
    """Drilled FIA carbon-carbon brake disc rotor (R = 0.184 m, thickness 0.032 m) positioned
    cleanly inside the rim barrel behind the open spokes with concentric radial UVs aligned
    1-to-1 with `brake_rotor_carbon.png` & `brake_thermal_mask.png`.
    """
    half_w = 0.5 * width
    x_center = side_sign * (half_w - 0.082)
    half_t = 0.016
    r_outer = 0.184
    r_inner = 0.055
    n_circ = 40
    cols = n_circ + 1
    theta = np.linspace(0.0, 2.0 * np.pi, cols)
    st, ct = np.sin(theta), np.cos(theta)
    r_uv_scale = 0.488 / r_outer

    # Closed rectangular rotor cross-section revolved around X
    rx_p = [x_center + side_sign * half_t, x_center + side_sign * half_t, x_center - side_sign * half_t, x_center - side_sign * half_t, x_center + side_sign * half_t]
    rr_p = [r_inner, r_outer, r_outer, r_inner, r_inner]

    verts_list = []
    for ip in range(len(rx_p)):
        y_r = rr_p[ip] * st
        z_r = rr_p[ip] * ct
        y_r[-1], z_r[-1] = y_r[0], z_r[0]
        verts_list.append(np.stack([np.full(cols, rx_p[ip]), y_r, z_r], axis=-1))
    verts = np.concatenate(verts_list, axis=0)

    u = np.clip(0.5 - side_sign * verts[:, 2] * r_uv_scale, 0.005, 0.995)
    v = np.clip(0.5 + verts[:, 1] * r_uv_scale, 0.005, 0.995)
    uvs = np.stack([u, v], axis=-1).astype(np.float32)

    faces = []
    for ip in range(len(rx_p) - 1):
        r0, r1 = ip * cols, (ip + 1) * cols
        for ic in range(n_circ):
            v00, v10 = r0 + ic, r0 + ic + 1
            v01, v11 = r1 + ic, r1 + ic + 1
            faces.append([v00, v01, v11])
            faces.append([v00, v11, v10])

    part = finalize_part(verts, np.asarray(faces, dtype=np.int64), uvs, fix_winding=True)
    return merge_textured_parts([part], mat_brake_rotor)


def build_brake_caliper(width: float, side_sign: float, is_front: bool, mat_brake_caliper: PBRMaterial) -> trimesh.Trimesh:
    """Low-mounted 6-piston monobloc racing brake caliper straddling the brake rotor cleanly
    inside the rim barrel (visible through the open rim spokes).
    """
    half_w = 0.5 * width
    x_center = side_sign * (half_w - 0.082)
    # Place lower-forward for front axle, lower-rear for rear axle (low-CoG FIA packaging)
    a0, a1 = (-2.35, -1.35) if is_front else (-1.75, -0.75)
    ang_grid = np.linspace(a0, a1, 10)
    r_mid = 0.168
    pts = np.stack(
        [np.full_like(ang_grid, x_center), r_mid * np.sin(ang_grid), r_mid * np.cos(ang_grid)],
        axis=-1,
    )
    part = build_curved_tube(
        pts,
        r_a_knots=np.full(len(ang_grid), 0.030),
        r_b_knots=np.full(len(ang_grid), 0.028),
        n_rings=12,
        n_seg=10,
        up_hint=(1.0, 0.0, 0.0),
    )
    return merge_textured_parts([part], mat_brake_caliper)


def build_brake_duct(width: float, side_sign: float, is_front: bool, mat_carbon: PBRMaterial) -> trimesh.Trimesh:
    """Inboard carbon FIA brake-cooling scoop, upright cake-tin drum shroud (anchoring
    wishbones cleanly), and FIA 2022+ over-wheel aero wake deflector winglet on front uprights.
    """
    half_w = 0.5 * width
    parts: list[tuple[trimesh.Trimesh, np.ndarray]] = []

    # Inboard upright shroud / cake-tin drum & wishbone mounting block
    x_in = -side_sign * (half_w + 0.010)
    x_out = -side_sign * (half_w - 0.042)
    pts_drum = np.array([[x_in, 0.0, 0.0], [x_out, 0.0, 0.0]], dtype=np.float64)
    parts.append(build_curved_tube(pts_drum, [0.145, 0.175], [0.145, 0.175], n_rings=4, n_seg=16))

    # Forward-facing carbon brake cooling intake scoop on inboard edge
    def scoop_fn(U, V):
        X = -side_sign * (half_w + 0.008 + 0.042 * U)
        Y = -0.025 + V * 0.165
        Z = -0.145 + U * 0.095 + 0.020 * np.sin(np.pi * V)
        hz = np.full_like(Z, 0.016)
        return X, Y, Z, np.zeros_like(Z), np.zeros_like(Z), hz

    parts.append(build_sculpted_aero_panel(6, 6, scoop_fn))

    # Iconic FIA 2022+ curved over-wheel aero wake deflector winglet on front uprights (clears R=0.360 tire!)
    if is_front:
        def brow_fn(U, V):
            # Curved carbon arc hugging upper-inboard shoulder of front slick (r=0.382 > 0.360!)
            ang = 0.72 + U * 1.18  # spans upper-rear to upper-front arc
            r_b = 0.382
            Y = r_b * np.sin(ang)
            Z = -r_b * np.cos(ang)
            X = -side_sign * (half_w + 0.022 - 0.125 * V)
            ht = np.full_like(Z, 0.0045)
            return X, Y, Z, np.zeros_like(Z), ht * np.sin(ang), -ht * np.cos(ang)

        parts.append(build_sculpted_aero_panel(10, 4, brow_fn))

    return merge_textured_parts(parts, mat_carbon)


# ==============================================================================
# SCENE GRAPH ASSEMBLY, ASSERTIONS & .GLB EXPORT
# ==============================================================================
def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load processed Nano Banana textures (or clean fallback placeholders if run pre-textures)
    livery_img = load_texture_or_fallback(["car_livery_player.png"], (175, 38, 42))
    carbon_img = load_texture_or_fallback(["car_carbon_weave.png"], (46, 48, 52), checker=True)
    tread_img = load_texture_or_fallback(["tire_slick_tread.png"], (50, 50, 52))
    sidewall_img = load_texture_or_fallback(["tire_sidewall_soft.png", "tire_sidewall_pirelli.png"], (48, 48, 52))
    rim_img = load_texture_or_fallback(["wheel_rim_forged.png"], (188, 192, 198))
    rotor_img = load_texture_or_fallback(["brake_rotor_carbon.png"], (58, 58, 62))
    helmet_img = load_texture_or_fallback(["driver_helmet_livery.png"], (225, 226, 230))
    dash_img = load_texture_or_fallback(["cockpit_steering_dash.png"], (42, 46, 54))

    # Authoritative PBRMaterial registry (matched by name in Three.js carBuilder.js)
    mat_livery = PBRMaterial(name="mat_livery", baseColorTexture=livery_img, metallicFactor=0.15, roughnessFactor=0.22)
    mat_carbon = PBRMaterial(name="mat_carbon", baseColorTexture=carbon_img, metallicFactor=0.0, roughnessFactor=0.34)
    mat_tire_tread = PBRMaterial(name="mat_tire_tread", baseColorTexture=tread_img, metallicFactor=0.0, roughnessFactor=0.56)
    mat_tire_sidewall = PBRMaterial(name="mat_tire_sidewall", baseColorTexture=sidewall_img, metallicFactor=0.0, roughnessFactor=0.58)
    mat_wheel_rim = PBRMaterial(name="mat_wheel_rim", baseColorTexture=rim_img, metallicFactor=0.75, roughnessFactor=0.24)
    mat_brake_rotor = PBRMaterial(name="mat_brake_rotor", baseColorTexture=rotor_img, metallicFactor=0.0, roughnessFactor=0.70)
    mat_brake_caliper = PBRMaterial(
        name="mat_brake_caliper",
        baseColorTexture=make_solid_patch_img((198, 40, 38)),
        metallicFactor=0.35,
        roughnessFactor=0.28,
    )
    mat_helmet = PBRMaterial(name="mat_helmet", baseColorTexture=helmet_img, metallicFactor=0.05, roughnessFactor=0.15)
    mat_steering_dash = PBRMaterial(name="mat_steering_dash", baseColorTexture=dash_img, metallicFactor=0.0, roughnessFactor=0.38)
    mat_rain_light = PBRMaterial(
        name="mat_rain_light",
        baseColorTexture=make_solid_patch_img((232, 36, 36)),
        emissiveFactor=[0.95, 0.08, 0.05],
        metallicFactor=0.0,
        roughnessFactor=0.20,
    )

    scene = trimesh.Scene()
    T = trimesh.transformations.translation_matrix
    R = trimesh.transformations.rotation_matrix

    # --- Root Chassis Hierarchy (`chassis_root` at (0, 0, 0)) ---
    scene.graph.update(frame_to="chassis_root", frame_from=scene.graph.base_frame, matrix=np.eye(4))

    chassis_parts: list[tuple[str, trimesh.Trimesh, np.ndarray | None]] = [
        ("monocoque_nose", build_monocoque_nose(mat_livery), None),
        ("sidepods_engine_cover", build_sidepods_engine_cover(mat_livery), None),
        ("front_wing_assembly", build_front_wing_assembly(mat_carbon), None),
        ("front_wing_endplates", build_front_wing_endplates(mat_livery), None),
        ("underfloor_venturi_diffuser", build_underfloor_venturi_diffuser(mat_carbon), None),
        ("rear_wing_mainplane", build_rear_wing_mainplane(mat_carbon), None),
        ("rear_wing_endplates", build_rear_wing_endplates(mat_livery), None),
        # DRS upper flap pivoted at trailing hinge (0, 0.905, 2.340) so +rotation.x opens slot gap
        ("drs_upper_flap", build_drs_upper_flap(mat_carbon), T([0.0, 0.905, 2.340])),
        ("halo_titanium", build_halo_titanium(mat_carbon), None),
        ("cockpit_interior", build_cockpit_interior(mat_carbon), None),
        # Steering wheel pivoted at (0, 0.560, -0.460) tilted -18 deg around X toward driver's eyes
        (
            "steering_wheel",
            build_steering_wheel(mat_steering_dash),
            T([0.0, 0.560, -0.460]) @ R(np.deg2rad(-18.0), [1.0, 0.0, 0.0]),
        ),
        ("driver_helmet", build_driver_helmet(mat_helmet), None),
        ("side_mirrors", build_side_mirrors(mat_livery), None),
        ("t_cam_pod", build_t_cam_pod(mat_carbon), None),
        ("suspension_wishbones", build_suspension_wishbones(mat_carbon), None),
        ("rear_rain_light", build_rear_rain_light(mat_rain_light), None),
    ]

    for name, mesh, xf in chassis_parts:
        scene.add_geometry(
            mesh,
            node_name=name,
            geom_name=name,
            parent_node_name="chassis_root",
            transform=xf if xf is not None else np.eye(4),
        )

    # --- 4 Articulated Wheel Corner Hierarchies Directly Under Root ---
    corners = [
        ("fl", (-0.800, 0.360, -1.962), 0.305, -1.0, True),
        ("fr", (+0.800, 0.360, -1.962), 0.305, +1.0, True),
        ("rl", (-0.775, 0.360, +1.638), 0.405, -1.0, False),
        ("rr", (+0.775, 0.360, +1.638), 0.405, +1.0, False),
    ]

    wheel_ground_min_y: dict[str, float] = {}
    for cid, pos, width, side_sign, is_front in corners:
        susp_node = f"wheel_{cid}_susp"
        spin_node = f"wheel_{cid}_spin"
        upright_node = f"upright_brake_{cid}"

        scene.graph.update(frame_to=susp_node, frame_from=scene.graph.base_frame, matrix=T(list(pos)))
        if is_front:
            steer_node = f"wheel_{cid}_steer"
            scene.graph.update(frame_to=steer_node, frame_from=susp_node, matrix=np.eye(4))
            hub_parent = steer_node
        else:
            hub_parent = susp_node

        scene.graph.update(frame_to=spin_node, frame_from=hub_parent, matrix=np.eye(4))
        scene.graph.update(frame_to=upright_node, frame_from=hub_parent, matrix=np.eye(4))

        tread_mesh = build_tire_tread(width, mat_tire_tread)
        sidewall_mesh = build_tire_sidewall(width, side_sign, mat_tire_sidewall)
        rim_mesh = build_wheel_rim(width, side_sign, mat_wheel_rim)

        duct_mesh = build_brake_duct(width, side_sign, is_front, mat_carbon)
        caliper_mesh = build_brake_caliper(width, side_sign, is_front, mat_brake_caliper)
        rotor_mesh = build_brake_rotor(width, side_sign, mat_brake_rotor)

        wheel_ground_min_y[cid] = float(pos[1] + tread_mesh.bounds[0, 1])

        scene.add_geometry(tread_mesh, node_name=f"tire_tread_{cid}", geom_name=f"tire_tread_{cid}", parent_node_name=spin_node)
        scene.add_geometry(sidewall_mesh, node_name=f"tire_sidewall_{cid}", geom_name=f"tire_sidewall_{cid}", parent_node_name=spin_node)
        scene.add_geometry(rim_mesh, node_name=f"rim_{cid}", geom_name=f"rim_{cid}", parent_node_name=spin_node)

        scene.add_geometry(duct_mesh, node_name=f"brake_duct_{cid}", geom_name=f"brake_duct_{cid}", parent_node_name=upright_node)
        scene.add_geometry(caliper_mesh, node_name=f"brake_caliper_{cid}", geom_name=f"brake_caliper_{cid}", parent_node_name=upright_node)
        scene.add_geometry(rotor_mesh, node_name=f"brake_rotor_{cid}", geom_name=f"brake_rotor_{cid}", parent_node_name=upright_node)

    # ==========================================================================
    # HARD GEOMETRIC, NODE GRAPH & TRIANGLE BUDGET ASSERTIONS
    # ==========================================================================
    bounds = scene.bounds
    min_x, min_y, min_z = float(bounds[0, 0]), float(bounds[0, 1]), float(bounds[0, 2])
    max_x, max_y, max_z = float(bounds[1, 0]), float(bounds[1, 1]), float(bounds[1, 2])
    width_m = max_x - min_x
    height_m = max_y - min_y
    length_m = max_z - min_z
    total_tris = int(sum(len(g.faces) for g in scene.geometry.values()))

    required_nodes = {
        "chassis_root",
        "monocoque_nose",
        "sidepods_engine_cover",
        "front_wing_assembly",
        "front_wing_endplates",
        "underfloor_venturi_diffuser",
        "rear_wing_mainplane",
        "rear_wing_endplates",
        "drs_upper_flap",
        "halo_titanium",
        "cockpit_interior",
        "steering_wheel",
        "driver_helmet",
        "side_mirrors",
        "t_cam_pod",
        "suspension_wishbones",
        "rear_rain_light",
        "wheel_fl_susp",
        "wheel_fl_steer",
        "wheel_fl_spin",
        "upright_brake_fl",
        "wheel_fr_susp",
        "wheel_fr_steer",
        "wheel_fr_spin",
        "upright_brake_fr",
        "wheel_rl_susp",
        "wheel_rl_spin",
        "upright_brake_rl",
        "wheel_rr_susp",
        "wheel_rr_spin",
        "upright_brake_rr",
    }
    for cid in ("fl", "fr", "rl", "rr"):
        required_nodes.update(
            {
                f"tire_tread_{cid}",
                f"tire_sidewall_{cid}",
                f"rim_{cid}",
                f"brake_duct_{cid}",
                f"brake_caliper_{cid}",
                f"brake_rotor_{cid}",
            }
        )

    present_nodes = set(scene.graph.nodes)
    missing_nodes = sorted(required_nodes - present_nodes)

    print("=" * 84)
    print("[F1 GLB Build Assertions]")
    print(f"  Bounds X : [{min_x:+.4f}, {max_x:+.4f}] -> Width  W = {width_m:.4f} m  (req: 1.95 .. 2.02 m)")
    print(f"  Bounds Y : [{min_y:+.4f}, {max_y:+.4f}] -> Height H = {height_m:.4f} m  (req: 0.94 .. 1.12 m, |minY|<0.002)")
    print(f"  Bounds Z : [{min_z:+.4f}, {max_z:+.4f}] -> Length L = {length_m:.4f} m  (req: 5.40 .. 5.65 m)")
    print(f"  Tire Contact Y : " + ", ".join(f"{k.upper()}={v:+.5f}m" for k, v in wheel_ground_min_y.items()))
    print(f"  Triangles      : {total_tris:,}  (req: 25,000 .. 65,000)")
    print(f"  Sub-meshes     : {len(scene.geometry)}  |  Scene Graph Nodes: {len(present_nodes)}")
    for gname, geom in scene.geometry.items():
        mat_name = getattr(getattr(geom.visual, "material", None), "name", "none")
        print(f"    - {gname:30s}: {len(geom.faces):6,d} tris  | mat={mat_name}")
    print("=" * 84)

    assert not missing_nodes, f"Missing required scene graph nodes: {missing_nodes}"
    assert 5.40 <= length_m <= 5.65, f"Length {length_m:.4f} m out of [5.40, 5.65] m!"
    assert 1.95 <= width_m <= 2.02, f"Width {width_m:.4f} m out of [1.95, 2.02] m!"
    assert 0.94 <= height_m <= 1.12, f"Height {height_m:.4f} m out of [0.94, 1.12] m!"
    assert abs(min_y) < 0.002, f"Vehicle grounding failed: minY = {min_y:.6f} m (must be < 0.002 m)!"
    for cid, wy in wheel_ground_min_y.items():
        assert abs(wy) < 0.002, f"Wheel {cid} not grounded at Y=0.000 m (got {wy:.6f} m)!"
    assert 25000 <= total_tris <= 65000, f"Triangle count {total_tris:,} out of [25,000, 65,000]!"

    out_path = OUT_DIR / "f1_car.glb"
    glb_bytes = scene.export(file_type="glb")
    out_path.write_bytes(glb_bytes)
    print(f"[F1 GLB Build Assertions] ALL PASSED -> Exported {out_path} ({len(glb_bytes) / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
