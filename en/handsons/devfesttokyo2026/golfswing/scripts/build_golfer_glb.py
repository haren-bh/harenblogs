"""Step 2 3D Asset Builder: Constructs symmetrical A-Pose `golfer.glb` (1.78m, Y-up, facing +Z,
soles at Y=0.0, ~26,000 triangles) and `golf_club.glb` (origin (0,0,0) at grip) using Python
`trimesh` + `scipy` PCHIP anatomical lofting, binding Nano Banana 1024x1024 .png PBR textures.
"""

from pathlib import Path
import numpy as np
from PIL import Image
from scipy.interpolate import PchipInterpolator
import trimesh
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial

ROOT_DIR = Path("/Users/bharen/Documents/Blogs/en/handsons/devfesttokyo2026")
TEX_DIR = ROOT_DIR / "textures"
OUT_DIR = ROOT_DIR / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def smoothstep(edge0: float, edge1: float, x):
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-12), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def gauss2d(u, v, u0: float, v0: float, su: float, sv: float):
    return np.exp(-0.5 * (((u - u0) / su) ** 2 + ((v - v0) / sv) ** 2))


def build_lofted_tube(
    s_knots,
    rx_knots,
    rz_knots,
    cx_knots=None,
    cy_knots=None,
    cz_knots=None,
    n_rings: int = 40,
    n_seg: int = 36,
    u_repeat: float = 1.0,
    v_repeat: float = 1.0,
    cap_bottom: bool = True,
    cap_top: bool = True,
    sculpt_fn=None,
) -> tuple[trimesh.Trimesh, np.ndarray]:
    """Builds a watertight, UV-mapped lofted anatomical mesh along smooth PCHIP curves.
    Azimuth phi=0 points along +Z (front), phi=+pi/2 along +X (golfer left), phi=-pi/2 along -X (golfer right).
    Returns (Trimesh, uv_array).
    """
    s_knots = np.asarray(s_knots, dtype=np.float64)
    t_grid = np.linspace(s_knots[0], s_knots[-1], n_rings)

    rx_fn = PchipInterpolator(s_knots, rx_knots)
    rz_fn = PchipInterpolator(s_knots, rz_knots)
    cx_fn = PchipInterpolator(s_knots, cx_knots if cx_knots is not None else np.zeros_like(s_knots))
    cy_fn = PchipInterpolator(s_knots, cy_knots if cy_knots is not None else s_knots)
    cz_fn = PchipInterpolator(s_knots, cz_knots if cz_knots is not None else np.zeros_like(s_knots))

    # Duplicate seam column (n_seg + 1) so cylindrical UVs wrap 0.0 -> u_repeat cleanly without seam stretching
    cols = n_seg + 1
    u_frac = np.linspace(0.0, 1.0, cols)
    # phi in [-pi, +pi]: u=0.5 -> phi=0 (+Z front), u=0.25 -> phi=-pi/2 (-X right), u=0.75 -> phi=+pi/2 (+X left)
    phi = (u_frac - 0.5) * (2.0 * np.pi)
    sin_p = np.sin(phi)  # X direction (+X = left)
    cos_p = np.cos(phi)  # Z direction (+Z = front)

    verts = []
    uvs = []
    v_span = max(1e-6, float(s_knots[-1] - s_knots[0]))

    for ir, s_val in enumerate(t_grid):
        rx = float(rx_fn(s_val))
        rz = float(rz_fn(s_val))
        cx = float(cx_fn(s_val))
        cy = float(cy_fn(s_val))
        cz = float(cz_fn(s_val))
        v_norm = float((s_val - s_knots[0]) / v_span)

        x_ring = cx + rx * sin_p
        y_ring = np.full(cols, cy, dtype=np.float64)
        z_ring = cz + rz * cos_p

        if sculpt_fn is not None:
            x_ring, y_ring, z_ring, u_custom, v_custom = sculpt_fn(
                x_ring, y_ring, z_ring, u_frac, v_norm, phi
            )
            u_arr = np.broadcast_to(np.asarray(u_custom, dtype=np.float64), (cols,))
            v_arr = np.broadcast_to(np.asarray(v_custom, dtype=np.float64), (cols,))
            ring_uv = np.stack([u_arr, v_arr], axis=-1)
        else:
            ring_uv = np.stack([u_frac * u_repeat, np.full(cols, v_norm * v_repeat)], axis=-1)

        # Guarantee exact seam vertex coincidence at col 0 and col n_seg
        x_ring[-1] = x_ring[0]
        y_ring[-1] = y_ring[0]
        z_ring[-1] = z_ring[0]

        verts.append(np.stack([x_ring, y_ring, z_ring], axis=-1))
        uvs.append(ring_uv)

    verts = np.concatenate(verts, axis=0)
    uvs = np.concatenate(uvs, axis=0)

    faces = []
    # Winding check: ir increases upward (+Y), ic increases phi from -pi -> +pi (at front +Z, +ic moves +X).
    # dP/d(ic) = (+X), dP/d(ir) = (+Y), (+X) x (+Y) = +Z (OUTWARD!).
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

    extra_verts = []
    extra_uvs = []
    if cap_bottom:
        b_idx = len(verts) + len(extra_verts)
        b_center = verts[0 : cols - 1].mean(axis=0)
        extra_verts.append(b_center)
        extra_uvs.append([0.5 * u_repeat, 0.0])
        for ic in range(n_seg):
            faces.append([b_idx, ic + 1, ic])

    if cap_top:
        t_idx = len(verts) + len(extra_verts)
        top_start = (n_rings - 1) * cols
        t_center = verts[top_start : top_start + cols - 1].mean(axis=0)
        extra_verts.append(t_center)
        extra_uvs.append([0.5 * u_repeat, v_repeat])
        for ic in range(n_seg):
            faces.append([t_idx, top_start + ic, top_start + ic + 1])

    if extra_verts:
        verts = np.vstack([verts, np.asarray(extra_verts, dtype=np.float64)])
        uvs = np.vstack([uvs, np.asarray(extra_uvs, dtype=np.float64)])

    mesh = trimesh.Trimesh(vertices=verts, faces=np.asarray(faces, dtype=np.int64), process=False)
    trimesh.repair.fix_normals(mesh)
    return mesh, uvs.astype(np.float32)


def merge_textured_parts(parts: list[tuple[trimesh.Trimesh, np.ndarray]], material: PBRMaterial) -> trimesh.Trimesh:
    """Combines multiple (mesh, uv) parts sharing a single PBRMaterial into one named sub-mesh."""
    all_v = []
    all_f = []
    all_uv = []
    offset = 0
    for m, uv in parts:
        trimesh.repair.fix_normals(m)
        all_v.append(m.vertices)
        all_f.append(m.faces + offset)
        all_uv.append(uv)
        offset += len(m.vertices)
    merged = trimesh.Trimesh(
        vertices=np.vstack(all_v),
        faces=np.vstack(all_f),
        process=False,
    )
    trimesh.repair.fix_normals(merged)
    merged.visual = TextureVisuals(uv=np.vstack(all_uv).astype(np.float32), material=material)
    return merged


def make_solid_patch_img(rgb: tuple[int, int, int], size: int = 64) -> Image.Image:
    arr = np.full((size, size, 3), rgb, dtype=np.uint8)
    return Image.fromarray(arr, mode="RGB")


# ==============================================================================
# 1. UNIFIED HEAD + NECK + EARS BUST (`head`)
# ==============================================================================
def build_head_submesh(head_mat: PBRMaterial) -> trimesh.Trimesh:
    """Builds a single continuous, watertight sculpted human neck + jaw + face + ears bust
    in local `neck` space (neck pivot at Y=1.490m in A-pose):
      y_local = -0.055 (Y=1.435m flared base deep inside polo collar)
      y_local = +0.062 (Y=1.552m chin underside)
      y_local = +0.184 (Y=1.674m eye line)
      y_local = +0.272 (Y=1.762m cranium crown)
    Facing +Z (nose along +Z, left ear +X, right ear -X). Zero neck-head gap is physically possible!
    """
    s_knots = [-0.055, -0.025, 0.015, 0.052, 0.068, 0.105, 0.145, 0.185, 0.225, 0.255, 0.272]
    rx_knots = [0.074, 0.060, 0.056, 0.056, 0.060, 0.068, 0.075, 0.078, 0.075, 0.056, 0.012]
    rz_knots = [0.070, 0.058, 0.056, 0.057, 0.068, 0.082, 0.088, 0.094, 0.092, 0.068, 0.014]
    cz_knots = [-0.008, -0.006, -0.004, -0.002, 0.006, 0.008, 0.006, 0.002, -0.002, -0.005, -0.006]

    v_map_fn = PchipInterpolator(
        [-0.055, 0.015, 0.062, 0.272],
        [0.020, 0.185, 0.228, 0.990],
    )

    def sculpt_head(x, y, z, u_frac, _v_norm, phi):
        y_val = float(y[0])
        v_tex = float(np.clip(v_map_fn(y_val), 0.01, 0.995))

        # Smooth monotonic horizontal UV warp matching 65mm human IPD, nose, lips & ears in head_albedo.png
        du = u_frac - 0.5
        front_warp = np.exp(-(du * du) / (2.0 * 0.14 * 0.14))
        u_tex = np.clip(0.5 + du * (1.0 + 0.16 * front_warp), 0.001, 0.999)

        cos_p = np.cos(phi)  # +1 at +Z front, -1 at -Z back
        sin_p = np.sin(phi)  # +1 at +X left ear, -1 at -X right ear

        # Loomis cranial frontal plane above jaw (v_tex > 0.24)
        face_mask = float(smoothstep(0.21, 0.29, v_tex))
        if face_mask > 0.001:
            # Flatten frontal orbital/cheek plane gently across eyes
            planar_boost = np.where(cos_p > 0.0, (np.maximum(cos_p, 0.0) ** 0.52 - cos_p) * 0.012, 0.0)
            z = z + planar_boost * face_mask * float(1.0 - smoothstep(0.84, 0.98, v_tex))

            # Sculpted 3D facial landmarks aligned 1-to-1 with head_albedo.png:
            #   Eyebrows: v=0.73, Eyes: v=0.67 (u=0.412, 0.588), Nose tip: v=0.53 (u=0.50),
            #   Upper lip: v=0.41, Lower lip: v=0.38, Chin prominence: v=0.28, Ears: u=0.242 & 0.758 (v=0.59)
            brow = 0.0038 * (
                gauss2d(u_tex, v_tex, 0.41, 0.73, 0.055, 0.022)
                + gauss2d(u_tex, v_tex, 0.59, 0.73, 0.055, 0.022)
            ) + 0.0020 * gauss2d(u_tex, v_tex, 0.50, 0.72, 0.035, 0.020)

            orbit = -0.0035 * (
                gauss2d(u_tex, v_tex, 0.412, 0.670, 0.040, 0.026)
                + gauss2d(u_tex, v_tex, 0.588, 0.670, 0.040, 0.026)
            )
            cornea = 0.0032 * (
                gauss2d(u_tex, v_tex, 0.412, 0.670, 0.019, 0.014)
                + gauss2d(u_tex, v_tex, 0.588, 0.670, 0.019, 0.014)
            )

            nose_bridge = 0.0105 * gauss2d(u_tex, v_tex, 0.50, 0.605, 0.022, 0.052)
            nose_tip = 0.0155 * gauss2d(u_tex, v_tex, 0.50, 0.530, 0.024, 0.026)
            nose_alae = 0.0052 * (
                gauss2d(u_tex, v_tex, 0.456, 0.526, 0.018, 0.018)
                + gauss2d(u_tex, v_tex, 0.544, 0.526, 0.018, 0.018)
            )

            cheek = 0.0040 * (
                gauss2d(u_tex, v_tex, 0.355, 0.595, 0.048, 0.042)
                + gauss2d(u_tex, v_tex, 0.645, 0.595, 0.048, 0.042)
            )

            upper_lip = 0.0048 * gauss2d(u_tex, v_tex, 0.50, 0.410, 0.045, 0.014)
            mouth_seam = -0.0018 * gauss2d(u_tex, v_tex, 0.50, 0.395, 0.046, 0.006)
            lower_lip = 0.0044 * gauss2d(u_tex, v_tex, 0.50, 0.378, 0.042, 0.014)
            chin_crease = -0.0024 * gauss2d(u_tex, v_tex, 0.50, 0.338, 0.044, 0.016)
            chin_pt = 0.0078 * gauss2d(u_tex, v_tex, 0.50, 0.280, 0.048, 0.028)

            front_gate = np.clip(cos_p + 0.15, 0.0, 1.0)
            z = z + front_gate * (
                brow + orbit + cornea + nose_bridge + nose_tip + nose_alae
                + cheek * 0.6 + upper_lip + mouth_seam + lower_lip + chin_crease + chin_pt
            )
            x = x + np.sign(sin_p) * cheek * 0.55 * front_gate

            # 3D sculpted ear pinnae at u=0.242 (-X right ear) & u=0.758 (+X left ear), v ~ 0.59
            r_ear = gauss2d(u_tex, v_tex, 0.242, 0.590, 0.022, 0.062)
            l_ear = gauss2d(u_tex, v_tex, 0.758, 0.590, 0.022, 0.062)
            r_concha = gauss2d(u_tex, v_tex, 0.252, 0.585, 0.010, 0.032)
            l_concha = gauss2d(u_tex, v_tex, 0.748, 0.585, 0.010, 0.032)
            x = x - (r_ear * 0.0115 - r_concha * 0.0038) + (l_ear * 0.0115 - l_concha * 0.0038)
            z = z - (r_ear + l_ear) * 0.0025

            # Parabolic jawline smooth blend onto cylindrical neck below jaw ramus
            abs_du = np.abs(u_tex - 0.50)
            v_jaw = 0.228 + 0.175 * smoothstep(0.03, 0.23, abs_du)
            neck_w = smoothstep(v_jaw + 0.085, v_jaw - 0.065, v_tex)
            x_neck = 0.056 * sin_p
            z_neck = -0.003 + 0.056 * cos_p
            x = x * (1.0 - neck_w) + x_neck * neck_w
            z = z * (1.0 - neck_w) + z_neck * neck_w

        return x, y, z, u_tex, np.full_like(u_tex, v_tex)

    head_mesh, head_uv = build_lofted_tube(
        s_knots, rx_knots, rz_knots, cz_knots=cz_knots,
        n_rings=54, n_seg=64, cap_bottom=True, cap_top=True, sculpt_fn=sculpt_head
    )
    head_mesh.visual = TextureVisuals(uv=head_uv, material=head_mat)
    return head_mesh


# ==============================================================================
# 2. STRUCTURED TOUR GOLF CAP + HAIR (`cap`) MAPPED WITH `cap_logo.png`
# ==============================================================================
def build_cap_submesh(cap_mat: PBRMaterial) -> trimesh.Trimesh:
    """Builds a structured 6-panel slate-charcoal tour golf cap + rounded crescent visor
    + short-cropped nape/temple hair band (using dark solid corner of cap_logo.png).
    Top of cap sits at y_local = +0.290 -> exact Y_world = 1.780 m!
    """
    parts = []

    # 1. Structured 6-panel Cap Crown seated cleanly above eyebrows (y_local = 0.228 .. 0.290)
    s_c = [0.228, 0.238, 0.254, 0.272, 0.285, 0.290]
    rx_c = [0.077, 0.079, 0.076, 0.064, 0.038, 0.008]
    rz_c = [0.094, 0.096, 0.092, 0.077, 0.044, 0.010]
    cz_c = [0.000, 0.001, -0.001, -0.003, -0.005, -0.006]

    def sculpt_crown(x, y, z, u_frac, v_norm, phi):
        du = u_frac - 0.5
        in_panel = (np.abs(du) < 0.13) & (v_norm > 0.08) & (v_norm < 0.80)
        u_logo = np.where(
            in_panel,
            0.50 + (du / 0.13) * 0.22,
            0.05 + (np.abs(du) * 0.25),
        )
        v_logo = np.where(
            in_panel,
            0.27 + ((v_norm - 0.08) / 0.72) * 0.48,
            0.05 + v_norm * 0.15,
        )
        return x, y, z, u_logo, v_logo

    crown_m, crown_uv = build_lofted_tube(
        s_c, rx_c, rz_c, cz_knots=cz_c, n_rings=24, n_seg=48, cap_bottom=False, cap_top=True, sculpt_fn=sculpt_crown
    )
    parts.append((crown_m, crown_uv))

    btn = trimesh.creation.icosphere(subdivisions=2, radius=0.0062)
    btn.apply_scale([1.0, 0.45, 1.0])
    btn.apply_translation([0.0, 0.290, -0.006])
    btn_uv = np.full((len(btn.vertices), 2), [0.10, 0.10], dtype=np.float32)
    parts.append((btn, btn_uv))

    # 2. Rounded Crescent Tour Visor seated at y_local = 0.228 so eyes (0.184) & brows (0.200) stay 100% visible!
    nu, nv = 28, 12
    u_g = np.linspace(-1.0, 1.0, nu)
    v_g = np.linspace(0.0, 1.0, nv)
    verts_v = []
    uvs_v = []
    thickness = 0.0040

    for side_sign in [1.0, -1.0]:
        for iv, vf in enumerate(v_g):
            # True rounded baseball/golf brim crescent contour (tapers smoothly to rounded tip)
            crescent = np.sqrt(np.maximum(0.04, 1.0 - 0.45 * (vf ** 1.8)))
            width_half = 0.076 * crescent
            for iu, uf in enumerate(u_g):
                vx = uf * width_half
                arch_y = 0.012 * (1.0 - uf * uf) * (0.35 + 0.65 * vf)
                vy = 0.228 + arch_y + 0.003 * vf + side_sign * (thickness * 0.5)
                # Back edge hugs front sweatband ellipse; front edge forms smooth rounded arc!
                z_base = 0.091 * np.cos(uf * 0.88)
                z_tip = 0.090 + 0.064 * np.cos(uf * 1.12)
                vz = (1.0 - vf) * z_base + vf * z_tip
                verts_v.append([vx, vy, vz])
                uvs_v.append([0.08 + (uf + 1.0) * 0.06, 0.08 + vf * 0.12])

    verts_v = np.asarray(verts_v, dtype=np.float64)
    uvs_v = np.asarray(uvs_v, dtype=np.float32)
    faces_v = []
    top_off = 0
    bot_off = nu * nv
    for iv in range(nv - 1):
        for iu in range(nu - 1):
            a, b = top_off + iv * nu + iu, top_off + iv * nu + iu + 1
            c, d = top_off + (iv + 1) * nu + iu, top_off + (iv + 1) * nu + iu + 1
            faces_v.append([a, d, b])
            faces_v.append([a, c, d])

            ab, bb = bot_off + iv * nu + iu, bot_off + iv * nu + iu + 1
            cb, db = bot_off + (iv + 1) * nu + iu, bot_off + (iv + 1) * nu + iu + 1
            faces_v.append([ab, bb, db])
            faces_v.append([ab, db, cb])

    for iu in range(nu - 1):
        t0, t1 = top_off + (nv - 1) * nu + iu, top_off + (nv - 1) * nu + iu + 1
        b0, b1 = bot_off + (nv - 1) * nu + iu, bot_off + (nv - 1) * nu + iu + 1
        faces_v.extend([[t0, b0, b1], [t0, b1, t1]])
    for iv in range(nv - 1):
        tl0, tl1 = top_off + iv * nu + (nu - 1), top_off + (iv + 1) * nu + (nu - 1)
        bl0, bl1 = bot_off + iv * nu + (nu - 1), bot_off + (iv + 1) * nu + (nu - 1)
        faces_v.extend([[tl0, tl1, bl1], [tl0, bl1, bl0]])
        tr0, tr1 = top_off + iv * nu, top_off + (iv + 1) * nu
        br0, br1 = bot_off + iv * nu, bot_off + (iv + 1) * nu
        faces_v.extend([[tr0, br1, tr1], [tr0, br0, br1]])

    visor_m = trimesh.Trimesh(vertices=verts_v, faces=np.asarray(faces_v, dtype=np.int64), process=False)
    parts.append((visor_m, uvs_v))

    # 3. Clean Tapered Short Hair around Back & Temples up to Cap Rim (y_local = 0.112 .. 0.232)
    s_h = [0.112, 0.145, 0.180, 0.210, 0.232]
    rx_h = [0.062, 0.072, 0.078, 0.079, 0.076]
    rz_h = [0.066, 0.083, 0.091, 0.094, 0.091]
    cz_h = [-0.005, -0.002, 0.002, 0.000, -0.001]

    def sculpt_hair(x, y, z, u_frac, v_norm, phi):
        cos_p = np.cos(phi)
        abs_sin = np.abs(np.sin(phi))
        front_hide = smoothstep(-0.08, 0.25, cos_p)
        ear_arch = np.where((abs_sin > 0.84) & (v_norm < 0.72), smoothstep(0.72, 0.45, v_norm), 0.0)
        recess = np.maximum(front_hide, ear_arch) * 0.025
        rad = np.hypot(x, z) + 1e-6
        scale = (rad - recess + 0.0022 * (1.0 - np.maximum(front_hide, ear_arch))) / rad
        return x * scale, y, z * scale, np.full_like(u_frac, 0.12), np.full_like(u_frac, 0.12)

    hair_m, hair_uv = build_lofted_tube(
        s_h, rx_h, rz_h, cz_knots=cz_h, n_rings=18, n_seg=44, cap_bottom=False, cap_top=False, sculpt_fn=sculpt_hair
    )
    parts.append((hair_m, hair_uv))

    return merge_textured_parts(parts, cap_mat)


# ==============================================================================
# 3. UNIFIED TAILORED POLO TORSO (`torso_polo`) + SYMMETRICAL ARMS
# ==============================================================================
def build_torso_polo_submesh(polo_mat: PBRMaterial) -> trimesh.Trimesh:
    """Builds a single continuous sculpted pique polo shirt torso with smooth sloped deltoid
    shoulder yoke so arm sleeves tuck seamlessly without shoulder-pad bumps.
    """
    parts = []

    s_t = [-0.065, -0.025, 0.020, 0.095, 0.195, 0.295, 0.385, 0.442, 0.476, 0.496]
    rx_t = [0.095, 0.145, 0.156, 0.160, 0.174, 0.194, 0.214, 0.208, 0.136, 0.070]
    rz_t = [0.072, 0.106, 0.114, 0.116, 0.124, 0.132, 0.132, 0.120, 0.088, 0.068]
    cz_t = [0.000, 0.000, 0.002, 0.003, 0.006, 0.008, 0.006, 0.002, 0.003, 0.004]

    def sculpt_torso(x, y, z, u_frac, v_norm, phi):
        cos_p = np.cos(phi)
        sin_p = np.sin(phi)
        y_val = float(y[0])
        pec_h = np.exp(-(((y_val - 0.31) / 0.075) ** 2))
        pec_w = np.exp(-(((np.abs(sin_p) - 0.45) / 0.30) ** 2)) * np.maximum(0.0, cos_p)
        spine_groove = -0.006 * np.exp(-((sin_p / 0.18) ** 2)) * np.maximum(0.0, -cos_p) * smoothstep(0.05, 0.40, y_val)
        blouse = 0.005 * np.exp(-(((y_val - 0.028) / 0.026) ** 2))
        z = z + pec_h * pec_w * 0.010 + spine_groove + blouse * cos_p
        x = x + blouse * sin_p
        return x, y, z, u_frac * 4.0, v_norm * 3.5

    body_m, body_uv = build_lofted_tube(
        s_t, rx_t, rz_t, cz_knots=cz_t, n_rings=34, n_seg=40, cap_bottom=True, cap_top=True, sculpt_fn=sculpt_torso
    )
    parts.append((body_m, body_uv))

    n_c_seg = 28
    n_c_r = 7
    ang_c = np.linspace(0.32, 2.0 * np.pi - 0.32, n_c_seg)
    v_col = []
    uv_col = []
    for ir, t_f in enumerate(np.linspace(0.0, 1.0, n_c_r)):
        if t_f <= 0.48:
            k = t_f / 0.48
            rad_x = 0.068 + 0.006 * k
            rad_z = 0.066 + 0.006 * k
            cy = 0.484 + 0.042 * k
        else:
            k = (t_f - 0.48) / 0.52
            rad_x = 0.074 + 0.020 * k
            rad_z = 0.072 + 0.020 * k
            cy = 0.526 - 0.036 * k
        for ia, a in enumerate(ang_c):
            point_drop = 0.012 * max(0.0, 1.0 - min(abs(a - 0.32), abs(a - (2 * np.pi - 0.32))) / 0.45) * max(0.0, t_f - 0.5)
            v_col.append([rad_x * np.sin(a), cy - point_drop, 0.004 + rad_z * np.cos(a)])
            uv_col.append([(ia / (n_c_seg - 1)) * 2.0, t_f * 0.6])

    v_col = np.asarray(v_col, dtype=np.float64)
    uv_col = np.asarray(uv_col, dtype=np.float32)
    f_col = []
    for ir in range(n_c_r - 1):
        for ia in range(n_c_seg - 1):
            p00 = ir * n_c_seg + ia
            p10 = p00 + 1
            p01 = (ir + 1) * n_c_seg + ia
            p11 = p01 + 1
            f_col.extend([[p00, p11, p10], [p00, p01, p11]])
    col_m = trimesh.Trimesh(vertices=v_col, faces=np.asarray(f_col, dtype=np.int64), process=False)
    parts.append((col_m, uv_col))

    placket = trimesh.creation.box(extents=[0.028, 0.125, 0.008])
    placket.apply_translation([0.0, 0.415, 0.128])
    pl_uv = (placket.vertices[:, :2] * 3.0 + 0.5).astype(np.float32)
    parts.append((placket, pl_uv))

    return merge_textured_parts(parts, polo_mat)


def build_upper_arm_submeshes(polo_mat: PBRMaterial, skin_mat: PBRMaterial) -> tuple[trimesh.Trimesh, trimesh.Trimesh]:
    """Low-profile deltoid cap (+0.032) tucking smoothly inside torso shoulder yoke without shoulder bumps."""
    s_sl = [-0.156, -0.148, -0.132, -0.075, -0.015, 0.018, 0.034]
    r_sl = [0.051, 0.056, 0.055, 0.058, 0.059, 0.048, 0.016]
    sleeve_m, sleeve_uv = build_lofted_tube(
        s_sl, r_sl, [r * 0.96 for r in r_sl], n_rings=16, n_seg=22, u_repeat=1.8, v_repeat=1.4
    )
    sleeve_m.visual = TextureVisuals(uv=sleeve_uv, material=polo_mat)

    s_bi = [-0.326, -0.308, -0.290, -0.235, -0.175, -0.138]
    rx_bi = [0.014, 0.036, 0.042, 0.047, 0.049, 0.046]
    rz_bi = [0.014, 0.036, 0.042, 0.049, 0.051, 0.046]
    biceps_m, biceps_uv = build_lofted_tube(
        s_bi, rx_bi, rz_bi, n_rings=15, n_seg=20, u_repeat=1.2, v_repeat=1.2
    )
    biceps_m.visual = TextureVisuals(uv=biceps_uv, material=skin_mat)
    return sleeve_m, biceps_m


def build_forearm_submesh(skin_mat: PBRMaterial) -> trimesh.Trimesh:
    s_fa = [-0.282, -0.265, -0.205, -0.115, -0.045, 0.000, 0.020, 0.038]
    rx_fa = [0.014, 0.028, 0.033, 0.044, 0.045, 0.042, 0.036, 0.014]
    rz_fa = [0.012, 0.024, 0.029, 0.042, 0.044, 0.042, 0.036, 0.014]
    fa_m, fa_uv = build_lofted_tube(
        s_fa, rx_fa, rz_fa, n_rings=16, n_seg=20, u_repeat=1.2, v_repeat=1.4
    )
    fa_m.visual = TextureVisuals(uv=fa_uv, material=skin_mat)
    return fa_m


# ==============================================================================
# 4. ARTICULATED HANDS (`left_glove` & `right_hand`) WITH 24° GOLF GRIP CHANNEL
# ==============================================================================
def build_hand_submesh(mat: PBRMaterial, is_left: bool) -> trimesh.Trimesh:
    """Builds an anatomically sculpted 5-finger golf hand in local wrist space (0,0,0),
    with fingers & thumb curled coaxially around the natural 24° diagonal golf-grip channel
    (axis = (0, -cos(24°), +sin(24°)) from Pinky/Butt to Index/Head) so forearms stay collinear
    with the hands while all fingers hug the club grip tightly!
    """
    inward = -1.0 if is_left else 1.0
    parts = []

    # 1. Sleek Contoured Metacarpal Palm & Wrist Shell (-0.080 .. +0.018)
    s_p = [-0.080, -0.068, -0.042, -0.016, 0.002, 0.018]
    rx_p = [0.009, 0.014, 0.016, 0.018, 0.025, 0.014]
    rz_p = [0.022, 0.038, 0.041, 0.036, 0.025, 0.014]
    cx_p = [-inward * 0.005, -inward * 0.006, -inward * 0.005, -inward * 0.002, 0.0, 0.0]
    palm_m, palm_uv = build_lofted_tube(
        s_p, rx_p, rz_p, cx_knots=cx_p, n_rings=14, n_seg=20, u_repeat=1.5, v_repeat=1.5
    )
    parts.append((palm_m, palm_uv))

    # 2. Four fingers curled coaxially around the 24° diagonal golf grip axis!
    # Grip center in wrist space: (inward * 0.014, -0.056, +0.012)
    grip_origin = np.array([inward * 0.014, -0.056, 0.012], dtype=np.float64)
    ang_diag = np.deg2rad(24.0)
    # Unit vector along club shaft from butt cap -> clubhead:
    shaft_down_u = np.array([0.0, -np.cos(ang_diag), np.sin(ang_diag)], dtype=np.float64)
    # Orthogonal radial vectors in (Y, Z) & X:
    rad_out_z = np.array([0.0, np.sin(ang_diag), np.cos(ang_diag)], dtype=np.float64)  # outward toward ball (+xClub)
    rad_palm_x = np.array([inward, 0.0, 0.0], dtype=np.float64)

    r_wrap = 0.0175
    # Pinky at negative shaft_down_u (butt cap side!), Index at positive shaft_down_u (clubhead side!)
    finger_specs = [
        ("Pinky", -0.024, 0.0065),
        ("Ring", -0.008, 0.0073),
        ("Middle", 0.008, 0.0076),
        ("Index", 0.024, 0.0074),
    ]

    for _fname, axial_off, f_rad in finger_specs:
        # Curl from dorsal (-rad_palm_x) underneath (-rad_out_z) and up palm/front (+rad_palm_x -> +rad_out_z)
        angles = np.linspace(-0.85 * np.pi, 0.45 * np.pi, 10)
        s_idx = np.linspace(0.0, 1.0, len(angles))
        base_c = grip_origin + axial_off * shaft_down_u
        pts = (
            base_c[None, :]
            + (np.sin(angles)[:, None] * rad_palm_x[None, :] - np.cos(angles)[:, None] * rad_out_z[None, :]) * r_wrap
        )
        rad_f = f_rad * (1.0 - 0.16 * s_idx)
        rad_f[0] *= 0.70
        rad_f[-1] *= 0.48
        f_mesh, f_uv = build_curve_tube(pts, rad_f, n_seg=10)
        parts.append((f_mesh, f_uv))

    # 3. Thumb resting cleanly along the top (+rad_out_z) of the 24° grip channel!
    t_pts = np.stack([
        grip_origin - 0.022 * shaft_down_u - 0.012 * rad_palm_x + 0.016 * rad_out_z,
        grip_origin - 0.004 * shaft_down_u + 0.002 * rad_palm_x + 0.019 * rad_out_z,
        grip_origin + 0.014 * shaft_down_u + 0.006 * rad_palm_x + 0.018 * rad_out_z,
        grip_origin + 0.028 * shaft_down_u + 0.006 * rad_palm_x + 0.017 * rad_out_z,
    ], axis=0)
    t_rads = np.array([0.0098, 0.0088, 0.0080, 0.0052], dtype=np.float64)
    t_mesh, t_uv = build_curve_tube(t_pts, t_rads, n_seg=10)
    parts.append((t_mesh, t_uv))

    return merge_textured_parts(parts, mat)


def build_curve_tube(centerline: np.ndarray, radii: np.ndarray, n_seg: int = 14) -> tuple[trimesh.Trimesh, np.ndarray]:
    """Sweeps circular cross-sections smoothly along an arbitrary 3D curve using parallel transport."""
    n_pts = len(centerline)
    tangents = np.gradient(centerline, axis=0)
    tangents /= np.linalg.norm(tangents, axis=-1, keepdims=True) + 1e-12

    # Initial normal orthogonal to tangents[0]
    ref = np.array([0.0, 0.0, 1.0]) if abs(tangents[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    normal = np.cross(tangents[0], ref)
    normal /= np.linalg.norm(normal) + 1e-12

    cols = n_seg + 1
    ang = np.linspace(0.0, 2.0 * np.pi, cols)
    cos_a = np.cos(ang)
    sin_a = np.sin(ang)

    verts = []
    uvs = []
    for i in range(n_pts):
        t = tangents[i]
        normal = normal - np.dot(normal, t) * t
        n_len = np.linalg.norm(normal)
        if n_len < 1e-8:
            normal = np.array([1.0, 0.0, 0.0])
        else:
            normal /= n_len
        binorm = np.cross(t, normal)
        r = radii[i]
        ring = centerline[i][None, :] + r * (cos_a[:, None] * normal[None, :] + sin_a[:, None] * binorm[None, :])
        ring[-1] = ring[0]
        verts.append(ring)
        uvs.append(np.stack([np.linspace(0.0, 1.0, cols), np.full(cols, i / max(1, n_pts - 1))], axis=-1))

    verts = np.concatenate(verts, axis=0)
    uvs = np.concatenate(uvs, axis=0)
    faces = []
    for ir in range(n_pts - 1):
        r0 = ir * cols
        r1 = (ir + 1) * cols
        for ic in range(n_seg):
            v00, v10 = r0 + ic, r0 + ic + 1
            v01, v11 = r1 + ic, r1 + ic + 1
            faces.extend([[v00, v10, v11], [v00, v11, v01]])

    b_idx = len(verts)
    t_idx = len(verts) + 1
    verts = np.vstack([verts, centerline[0], centerline[-1]])
    uvs = np.vstack([uvs, [0.5, 0.0], [0.5, 1.0]])
    top_start = (n_pts - 1) * cols
    for ic in range(n_seg):
        faces.append([b_idx, ic + 1, ic])
        faces.append([t_idx, top_start + ic, top_start + ic + 1])

    m = trimesh.Trimesh(vertices=verts, faces=np.asarray(faces, dtype=np.int64), process=False)
    trimesh.repair.fix_normals(m)
    return m, uvs.astype(np.float32)


# ==============================================================================
# 5. TAILORED CHINO SLACKS (`legs_slacks` + THIGH/SHIN) & TOUR GOLF SHOES (`shoes`)
# ==============================================================================
def build_pelvis_slacks_submesh(slacks_mat: PBRMaterial, belt_mat: PBRMaterial) -> tuple[trimesh.Trimesh, trimesh.Trimesh]:
    """Builds tailored chino pelvis/seat (`legs_slacks`) in `hips` space (Y_hips = 0.900m)
    with ZERO protruding hip spheres, plus dark leather belt!
    """
    # Pelvis spans y_local = -0.095 (Y=0.805m crotch/seat) up to y_local = +0.120 (Y=1.020m waistband)
    s_p = [-0.095, -0.065, -0.020, 0.045, 0.095, 0.120]
    rx_p = [0.125, 0.172, 0.178, 0.172, 0.162, 0.158]
    rz_p = [0.082, 0.112, 0.122, 0.120, 0.116, 0.114]
    cz_p = [-0.006, -0.008, -0.006, -0.002, 0.001, 0.002]

    def sculpt_pelvis(x, y, z, u_frac, v_norm, phi):
        cos_p = np.cos(phi)
        sin_p = np.sin(phi)
        y_val = float(y[0])
        # Subtle gluteal contour on -Z & neat flat front chino crease
        glute = -0.012 * np.exp(-(((np.abs(sin_p) - 0.45) / 0.32) ** 2)) * np.maximum(0.0, -cos_p) * np.exp(-(((y_val + 0.015) / 0.055) ** 2))
        crotch_indent = 0.018 * np.exp(-((sin_p / 0.22) ** 2)) * smoothstep(-0.04, -0.095, y_val)
        return x, y + crotch_indent, z + glute, u_frac * 3.5, v_norm * 2.0

    pelvis_m, pelvis_uv = build_lofted_tube(
        s_p, rx_p, rz_p, cz_knots=cz_p, n_rings=20, n_seg=34, sculpt_fn=sculpt_pelvis
    )
    pelvis_m.visual = TextureVisuals(uv=pelvis_uv, material=slacks_mat)

    # Leather belt + front buckle at waistband (y_local = 0.098 .. 0.128)
    s_b = [0.096, 0.112, 0.128]
    rx_b = [0.163, 0.164, 0.161]
    rz_b = [0.118, 0.119, 0.116]
    belt_m, belt_uv = build_lofted_tube(s_b, rx_b, rz_b, n_rings=6, n_seg=32)
    buckle = trimesh.creation.box(extents=[0.048, 0.036, 0.012])
    buckle.apply_translation([0.0, 0.112, 0.120])
    b_uv = np.zeros((len(buckle.vertices), 2), dtype=np.float32)
    belt_full = merge_textured_parts([(belt_m, belt_uv), (buckle, b_uv)], belt_mat)

    return pelvis_m, belt_full


def build_leg_slacks_segments(slacks_mat: PBRMaterial) -> tuple[trimesh.Trimesh, trimesh.Trimesh]:
    """Builds tapered chino thigh (`left_hip` -> `left_knee`, len=0.390m) and shin (`left_knee` -> `left_ankle`, len=0.395m).
    Top of thigh has rx=0.076m so at X=+/-0.095m its outer edge is +/-0.171m (< +/-0.178m pelvis!),
    completely eliminating hip ball protrusions!
    """
    s_th = [-0.436, -0.415, -0.390, -0.285, -0.145, -0.035, 0.000, 0.048]
    rx_th = [0.018, 0.048, 0.058, 0.064, 0.073, 0.077, 0.076, 0.026]
    rz_th = [0.018, 0.050, 0.061, 0.068, 0.079, 0.084, 0.082, 0.028]
    thigh_m, thigh_uv = build_lofted_tube(
        s_th, rx_th, rz_th, n_rings=18, n_seg=24, u_repeat=2.2, v_repeat=3.0
    )
    thigh_m.visual = TextureVisuals(uv=thigh_uv, material=slacks_mat)

    s_sh = [-0.398, -0.392, -0.375, -0.255, -0.115, 0.000, 0.026, 0.048]
    rx_sh = [0.046, 0.051, 0.050, 0.052, 0.058, 0.058, 0.049, 0.018]
    rz_sh = [0.052, 0.057, 0.055, 0.056, 0.063, 0.061, 0.051, 0.018]
    shin_m, shin_uv = build_lofted_tube(
        s_sh, rx_sh, rz_sh, n_rings=18, n_seg=24, u_repeat=2.0, v_repeat=3.0
    )
    shin_m.visual = TextureVisuals(uv=shin_uv, material=slacks_mat)
    return thigh_m, shin_m


def build_shoe_submesh(shoe_mat: PBRMaterial, sole_mat: PBRMaterial) -> tuple[trimesh.Trimesh, trimesh.Trimesh]:
    """Builds a sculpted athletic tour golf shoe in `ankle` space (`Y_ankle = 0.080m`),
    with flat cleated outsole resting at EXACT `y_local = -0.080m` -> `Y_world = 0.000m`,
    extending forward along +Z (heel at z=-0.065, toe at z=+0.195).
    """
    # Sculpted leather shoe upper (y_local = -0.066 .. +0.008)
    s_u = [-0.066, -0.052, -0.032, -0.010, 0.008]
    rx_u = [0.052, 0.053, 0.050, 0.044, 0.038]
    rz_u = [0.130, 0.132, 0.118, 0.082, 0.054]
    cz_u = [0.064, 0.064, 0.050, 0.015, -0.008]

    def sculpt_shoe(x, y, z, u_frac, v_norm, phi):
        # Taper toe box smoothly toward +Z tip and keep sole bottom dead flat
        z_rel = z - 0.064
        toe_narrow = np.where(z_rel > 0.02, 1.0 - 0.28 * ((z_rel - 0.02) / 0.115) ** 2, 1.0)
        return x * toe_narrow, y, z, u_frac * 2.0, v_norm * 1.5

    upper_m, upper_uv = build_lofted_tube(
        s_u, rx_u, rz_u, cz_knots=cz_u, n_rings=12, n_seg=24, sculpt_fn=sculpt_shoe
    )
    upper_m.visual = TextureVisuals(uv=upper_uv, material=shoe_mat)

    # Flat tour rubber outsole + midfoot stability saddle (y_local = -0.080 .. -0.062 -> Y_world = 0.000m!)
    s_s = [-0.080, -0.072, -0.063]
    rx_s = [0.053, 0.055, 0.054]
    rz_s = [0.132, 0.134, 0.132]
    cz_s = [0.064, 0.064, 0.064]
    sole_m, sole_uv = build_lofted_tube(
        s_s, rx_s, rz_s, cz_knots=cz_s, n_rings=5, n_seg=24, sculpt_fn=sculpt_shoe
    )
    # Dark midfoot saddle accent strip like golfer_apose_ref
    saddle = trimesh.creation.box(extents=[0.105, 0.038, 0.036])
    saddle.apply_translation([0.0, -0.044, 0.048])
    sad_uv = np.zeros((len(saddle.vertices), 2), dtype=np.float32)
    sole_full = merge_textured_parts([(sole_m, sole_uv), (saddle, sad_uv)], sole_mat)

    return upper_m, sole_full


# ==============================================================================
# 6. SEPARATE CLUB ASSET: `golf_club.glb` (ORIGIN (0, 0, 0) AT GRIP!)
# ==============================================================================
def build_golf_club_glb() -> trimesh.Scene:
    """Builds `golf_club.glb` with origin (0, 0, 0) at the grip center:
      +Y = butt cap (+0.095m), -Y = down shaft to hosel (-1.035m),
      +X = driver head toe (oriented at 56° tour lie angle),
      -Z = CNC-milled titanium striking face normal!
    """
    grip_mat = PBRMaterial(
        name="club_grip_elastomer",
        baseColorTexture=make_solid_patch_img((42, 45, 50)),
        metallicFactor=0.0,
        roughnessFactor=0.86,
    )
    shaft_mat = PBRMaterial(
        name="club_graphite_shaft",
        baseColorTexture=make_solid_patch_img((200, 204, 210)),
        metallicFactor=0.92,
        roughnessFactor=0.22,
    )
    crown_img = Image.open(TEX_DIR / "driver_carbon.jpg").convert("RGB").resize((512, 512), Image.Resampling.LANCZOS)
    crown_mat = PBRMaterial(
        name="club_carbon_crown",
        baseColorTexture=crown_img,
        metallicFactor=0.25,
        roughnessFactor=0.16,
    )
    ti_mat = PBRMaterial(
        name="club_forged_titanium",
        baseColorTexture=make_solid_patch_img((212, 214, 218)),
        metallicFactor=1.0,
        roughnessFactor=0.22,
    )

    # 1. Grip mesh centered around (0, 0, 0): spans y = -0.155 .. +0.062 (neat 1cm butt cap above glove!)
    s_g = [-0.155, -0.080, 0.000, 0.050, 0.062]
    r_g = [0.0108, 0.0120, 0.0132, 0.0140, 0.0146]
    grip_m, grip_uv = build_lofted_tube(s_g, r_g, r_g, n_rings=18, n_seg=24)
    grip_m.visual = TextureVisuals(uv=grip_uv, material=grip_mat)

    # 2. Tapered Tour Graphite Shaft: spans y = -1.035 .. -0.155
    s_sh = [-1.035, -0.750, -0.450, -0.155]
    r_sh = [0.0045, 0.0054, 0.0064, 0.0074]
    shaft_m, shaft_uv = build_lofted_tube(s_sh, r_sh, r_sh, n_rings=24, n_seg=20)
    shaft_m.visual = TextureVisuals(uv=shaft_uv, material=shaft_mat)

    # 3. Sculpted 460cc Aerodynamic Tour Driver Head at tip (-1.035m), counter-rotated -34° (56° lie angle)
    lie_tilt = np.deg2rad(34.0)
    head_sphere = trimesh.creation.uv_sphere(radius=1.0, count=[36, 48])
    v = head_sphere.vertices.copy()
    ux, uy, uz = v[:, 0], v[:, 1], v[:, 2]  # uv_sphere has Z as pole; remap to (X=heel-toe, Y=sole-crown, Z=face-back)
    sx, sy, sz = ux, uz, uy

    wx = sx * 0.058
    wy = sy * 0.029
    wz = sz * 0.053

    heel_taper = np.where(sx < 0, 1.0 - np.abs(sx) * 0.22, 1.0 + sx * 0.04)
    wz *= heel_taper
    wy *= np.where(sx < 0, 1.0 - np.abs(sx) * 0.14, 1.0)

    back_mask = sz > 0
    wy = np.where(back_mask, wy * (1.0 - sz * 0.42) - sz * 0.006, wy)
    wx = np.where(back_mask, wx * (1.0 - (sz ** 2) * 0.30), wx)

    # Flat 10.5° lofted hitting face on -Z
    face_mask = sz < -0.55
    f_blend = np.clip((-sz - 0.55) / 0.45, 0.0, 1.0) * 0.88
    wz = np.where(face_mask, wz * (1.0 - f_blend) + (-0.050 + wy * 0.185) * f_blend, wz)

    # Flat soleplate on -Y
    sole_mask = sy < -0.35
    s_blend = np.clip((-sy - 0.35) / 0.65, 0.0, 1.0) * 0.82
    wy = np.where(sole_mask, wy * (1.0 - s_blend) + (-0.0275 + np.abs(sx) * 0.003) * s_blend, wy)

    head_verts = np.stack([wx + 0.056, wy, wz + 0.049], axis=-1)
    head_m = trimesh.Trimesh(vertices=head_verts, faces=head_sphere.faces.copy(), process=False)
    trimesh.repair.fix_normals(head_m)
    head_uv = np.stack([(sx + 1.0) * 0.5, (sz + 1.0) * 0.5], axis=-1).astype(np.float32)

    # Rotate head by -34° around Z and translate to shaft tip (0, -1.035, 0)
    rot_head = trimesh.transformations.rotation_matrix(-lie_tilt, [0, 0, 1])
    head_m.apply_transform(rot_head)
    head_m.apply_translation([0.0, -1.035, 0.0])
    head_m.visual = TextureVisuals(uv=head_uv, material=crown_mat)

    # Titanium hosel + soleplate accent
    hosel_s = [-0.018, 0.045]
    hosel_r = [0.0098, 0.0062]
    hosel_m, hosel_uv = build_lofted_tube(hosel_s, hosel_r, hosel_r, n_rings=8, n_seg=18)
    hosel_m.apply_translation([0.0, -1.035, 0.0])

    face_plate = trimesh.creation.box(extents=[0.084, 0.040, 0.003])
    face_plate.apply_transform(trimesh.transformations.rotation_matrix(0.185, [1, 0, 0]))
    face_plate.apply_translation([0.056, 0.0, -0.002])
    face_plate.apply_transform(rot_head)
    face_plate.apply_translation([0.0, -1.035, 0.0])
    fp_uv = np.zeros((len(face_plate.vertices), 2), dtype=np.float32)

    ti_full = merge_textured_parts([(hosel_m, hosel_uv), (face_plate, fp_uv)], ti_mat)

    club_scene = trimesh.Scene()
    club_scene.add_geometry(grip_m, node_name="club_grip", geom_name="club_grip")
    club_scene.add_geometry(shaft_m, node_name="club_shaft", geom_name="club_shaft")
    club_scene.add_geometry(head_m, node_name="club_head_crown", geom_name="club_head_crown")
    club_scene.add_geometry(ti_full, node_name="club_head_titanium", geom_name="club_head_titanium")
    return club_scene


# ==============================================================================
# MAIN SCENE ASSEMBLY & EXPORT (`golfer.glb` & `golf_club.glb`)
# ==============================================================================
def main():
    polo_img = Image.open(TEX_DIR / "polo_albedo.png").convert("RGB")
    slacks_img = Image.open(TEX_DIR / "slacks_albedo.png").convert("RGB")
    glove_img = Image.open(TEX_DIR / "glove_albedo.png").convert("RGB")
    cap_img = Image.open(TEX_DIR / "cap_logo.png").convert("RGB")
    head_img = Image.open(TEX_DIR / "head_albedo.png").convert("RGB")
    skin_img = Image.open(TEX_DIR / "skin_albedo.png").convert("RGB")

    polo_mat = PBRMaterial(name="polo_pbr", baseColorTexture=polo_img, metallicFactor=0.0, roughnessFactor=0.84)
    slacks_mat = PBRMaterial(name="slacks_pbr", baseColorTexture=slacks_img, metallicFactor=0.0, roughnessFactor=0.82)
    glove_mat = PBRMaterial(name="glove_pbr", baseColorTexture=glove_img, metallicFactor=0.0, roughnessFactor=0.52)
    cap_mat = PBRMaterial(name="cap_pbr", baseColorTexture=cap_img, metallicFactor=0.0, roughnessFactor=0.76)
    head_mat = PBRMaterial(name="head_pbr", baseColorTexture=head_img, metallicFactor=0.0, roughnessFactor=0.50)
    skin_mat = PBRMaterial(name="skin_pbr", baseColorTexture=skin_img, metallicFactor=0.0, roughnessFactor=0.48)
    belt_mat = PBRMaterial(
        name="belt_pbr", baseColorTexture=make_solid_patch_img((40, 42, 46)), metallicFactor=0.0, roughnessFactor=0.38
    )
    sole_mat = PBRMaterial(
        name="shoe_sole_pbr", baseColorTexture=make_solid_patch_img((48, 52, 58)), metallicFactor=0.0, roughnessFactor=0.70
    )

    scene = trimesh.Scene()
    T = trimesh.transformations.translation_matrix
    R = trimesh.transformations.rotation_matrix

    # --- Hips Root (Y = 0.900m) ---
    scene.graph.update(frame_to="hips", frame_from=scene.graph.base_frame, matrix=T([0.0, 0.900, 0.0]))
    pelvis_mesh, belt_mesh = build_pelvis_slacks_submesh(slacks_mat, belt_mat)
    scene.add_geometry(pelvis_mesh, node_name="legs_slacks", geom_name="legs_slacks", parent_node_name="hips")
    scene.add_geometry(belt_mesh, node_name="belt_leather", geom_name="belt_leather", parent_node_name="hips")

    # --- Lower Body Legs & Shoes (soles resting at EXACT Y = 0.000m!) ---
    thigh_l, shin_l = build_leg_slacks_segments(slacks_mat)
    thigh_r, shin_r = build_leg_slacks_segments(slacks_mat)
    shoe_upper_l, shoe_sole_l = build_shoe_submesh(glove_mat, sole_mat)
    shoe_upper_r, shoe_sole_r = build_shoe_submesh(glove_mat, sole_mat)

    for side, sx in [("left", 0.095), ("right", -0.095)]:
        hip_node = f"{side}_hip"
        knee_node = f"{side}_knee"
        ankle_node = f"{side}_ankle"
        scene.graph.update(frame_to=hip_node, frame_from="hips", matrix=T([sx, -0.035, 0.0]))
        scene.graph.update(frame_to=knee_node, frame_from=hip_node, matrix=T([0.0, -0.390, 0.0]))
        scene.graph.update(frame_to=ankle_node, frame_from=knee_node, matrix=T([0.0, -0.395, 0.0]))

        th_m = thigh_l if side == "left" else thigh_r
        sh_m = shin_l if side == "left" else shin_r
        su_m = shoe_upper_l if side == "left" else shoe_upper_r
        ss_m = shoe_sole_l if side == "left" else shoe_sole_r

        scene.add_geometry(th_m, node_name=f"{side}_thigh_slacks", geom_name=f"{side}_thigh_slacks", parent_node_name=hip_node)
        scene.add_geometry(sh_m, node_name=f"{side}_shin_slacks", geom_name=f"{side}_shin_slacks", parent_node_name=knee_node)

        shoe_name = "shoes" if side == "left" else "right_shoe"
        scene.add_geometry(su_m, node_name=shoe_name, geom_name=shoe_name, parent_node_name=ankle_node)
        scene.add_geometry(ss_m, node_name=f"{side}_shoe_sole", geom_name=f"{side}_shoe_sole", parent_node_name=ankle_node)

    # --- Spine & Unified Torso Polo (Y_spine = 1.005m) ---
    scene.graph.update(frame_to="spine", frame_from="hips", matrix=T([0.0, 0.105, 0.0]))
    torso_mesh = build_torso_polo_submesh(polo_mat)
    scene.add_geometry(torso_mesh, node_name="torso_polo", geom_name="torso_polo", parent_node_name="spine")

    # --- Neck, Unified Head+Neck Bust (`head`), & Tour Cap (`cap`) (Y_neck = 1.490m, Top = 1.780m!) ---
    scene.graph.update(frame_to="neck", frame_from="spine", matrix=T([0.0, 0.485, 0.004]))
    head_mesh = build_head_submesh(head_mat)
    cap_mesh = build_cap_submesh(cap_mat)
    scene.add_geometry(head_mesh, node_name="head", geom_name="head", parent_node_name="neck")
    scene.add_geometry(cap_mesh, node_name="cap", geom_name="cap", parent_node_name="neck")

    # --- Symmetrical A-Pose Arms (36° outward angle) + `left_glove` & `right_hand` ---
    apose_rad = np.deg2rad(36.0)
    for side, sx, z_ang in [("left", 0.172, apose_rad), ("right", -0.172, -apose_rad)]:
        sh_node = f"{side}_shoulder"
        el_node = f"{side}_elbow"
        wr_node = f"{side}_wrist"

        m_sh = T([sx, 0.418, 0.004]) @ R(z_ang, [0, 0, 1])
        m_el = T([0.0, -0.285, 0.0]) @ R(np.deg2rad(-6.0), [1, 0, 0])
        m_wr = T([0.0, -0.265, 0.0])

        scene.graph.update(frame_to=sh_node, frame_from="spine", matrix=m_sh)
        scene.graph.update(frame_to=el_node, frame_from=sh_node, matrix=m_el)
        scene.graph.update(frame_to=wr_node, frame_from=el_node, matrix=m_wr)

        sleeve_m, biceps_m = build_upper_arm_submeshes(polo_mat, skin_mat)
        forearm_m = build_forearm_submesh(skin_mat)
        scene.add_geometry(sleeve_m, node_name=f"{side}_sleeve_polo", geom_name=f"{side}_sleeve_polo", parent_node_name=sh_node)
        scene.add_geometry(biceps_m, node_name=f"{side}_upper_arm", geom_name=f"{side}_upper_arm", parent_node_name=sh_node)
        scene.add_geometry(forearm_m, node_name=f"{side}_forearm", geom_name=f"{side}_forearm", parent_node_name=el_node)

        if side == "left":
            l_glove = build_hand_submesh(glove_mat, is_left=True)
            scene.add_geometry(l_glove, node_name="left_glove", geom_name="left_glove", parent_node_name=wr_node)
            scene.graph.update(frame_to="club_grip_socket", frame_from=wr_node, matrix=T([-0.014, -0.056, 0.012]))
        else:
            r_hand = build_hand_submesh(skin_mat, is_left=False)
            scene.add_geometry(r_hand, node_name="right_hand", geom_name="right_hand", parent_node_name=wr_node)

    # Validate bounding box, sub-mesh names, and triangle count
    bounds = scene.bounds
    height_m = float(bounds[1, 1] - bounds[0, 1])
    total_tris = sum(len(g.faces) for g in scene.geometry.values())
    required_names = {"head", "torso_polo", "legs_slacks", "left_glove", "right_hand", "cap", "shoes"}
    present_names = set(scene.geometry.keys())
    missing = required_names - present_names

    print(f"golfer.glb A-Pose Bounds Y: [{bounds[0, 1]:.4f}, {bounds[1, 1]:.4f}] -> Height = {height_m:.4f} m")
    print(f"golfer.glb A-Pose Bounds X: [{bounds[0, 0]:.4f}, {bounds[1, 0]:.4f}], Z: [{bounds[0, 2]:.4f}, {bounds[1, 2]:.4f}]")
    print(f"golfer.glb Total Triangles: {total_tris:,} (target: 15,000 - 35,000)")
    print(f"golfer.glb Sub-meshes ({len(present_names)}): {sorted(present_names)}")
    assert not missing, f"Missing required sub-meshes: {missing}"
    assert 1.75 <= height_m <= 1.80, f"Height {height_m} outside 1.75-1.80m target!"
    assert abs(bounds[0, 1]) < 1e-4, f"Shoe soles not at Y=0.0 (got {bounds[0, 1]})!"
    assert 15000 <= total_tris <= 35000, f"Triangle count {total_tris} outside 15k-35k!"

    golfer_path = OUT_DIR / "golfer.glb"
    golfer_path.write_bytes(scene.export(file_type="glb"))
    print(f"Exported {golfer_path} ({golfer_path.stat().st_size / 1024:.1f} KB)")

    club_scene = build_golf_club_glb()
    club_tris = sum(len(g.faces) for g in club_scene.geometry.values())
    club_path = OUT_DIR / "golf_club.glb"
    club_path.write_bytes(club_scene.export(file_type="glb"))
    print(f"Exported {club_path} ({club_path.stat().st_size / 1024:.1f} KB, {club_tris:,} tris)")


if __name__ == "__main__":
    main()
