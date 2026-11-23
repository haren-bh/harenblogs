"""Minimal Flask web server for GolfSwing Studio (DevFest Tokyo 2026).

Serves the static HTML5/WebGL2 golf driving simulator cleanly over HTTP
so ES modules load without local file:// CORS restrictions.
"""

from pathlib import Path
from flask import Flask, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=None)


@app.route("/")
def serve_index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/favicon.ico")
def serve_favicon():
    return ("", 204)


@app.route("/<path:asset_path>")
def serve_asset(asset_path: str):
    return send_from_directory(BASE_DIR, asset_path)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
