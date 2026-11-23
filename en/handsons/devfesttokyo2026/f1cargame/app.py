"""Minimal Flask HTTP server for Tokyo GP 2026 F1 Racing Simulation.

Serves index.html at /, returns 204 No Content for /favicon.ico, and delivers
ES modules, CSS, textures, JSON manifests, and binary .glb meshes with clean
explicit MIME types and zero CORS/404 issues on localhost.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from flask import Flask, Response, abort, send_from_directory

BASE_DIR = Path(__file__).resolve().parent

# Register explicit MIME types for modern web modules and 3D assets.
MIME_OVERRIDES: dict[str, str] = {
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
}

for ext, mime in MIME_OVERRIDES.items():
    mimetypes.add_type(mime, ext)

app = Flask(__name__, static_folder=None)


def _send_asset(rel_path: str) -> Response:
    """Serve a file relative to BASE_DIR with explicit MIME typing."""
    # Reject hidden files and Python source files cleanly.
    parts = Path(rel_path).parts
    if any(part.startswith(".") for part in parts) or rel_path.endswith(".py"):
        abort(404)

    suffix = Path(rel_path).suffix.lower()
    mimetype = MIME_OVERRIDES.get(suffix)
    response = send_from_directory(BASE_DIR, rel_path, mimetype=mimetype)
    if suffix in {".html", ".js", ".mjs", ".css", ".json"}:
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/")
def serve_index() -> Response:
    """Serve the primary HTML5 simulation entry point."""
    return _send_asset("index.html")


@app.route("/favicon.ico")
def favicon() -> tuple[str, int]:
    """Suppress browser favicon 404 console errors with 204 No Content."""
    return ("", 204)


@app.route("/<path:filename>")
def serve_static(filename: str) -> Response:
    """Serve static assets (JS modules, CSS, textures, GLB meshes, manifests)."""
    return _send_asset(filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
