"""Minimal Flask web server for Ocean Flyby (DevFest Tokyo 2026).

Serves the self-contained single-file HTML5/WebGL2 underwater exploration game
cleanly over HTTP on port 8080 (index.html also runs directly from file://).
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
