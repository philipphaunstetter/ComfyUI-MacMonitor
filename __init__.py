"""ComfyUI-MacMonitor — UI extension for live performance monitoring on Apple Silicon.

This is a UI-only extension. It does NOT contribute workflow nodes;
NODE_CLASS_MAPPINGS stays empty intentionally (see CLAUDE.md / PRD).
"""

from __future__ import annotations

import logging

logging.getLogger("ComfyUI-MacMonitor").setLevel(logging.INFO)

from .server import register_routes
from .execution_hooks import install_hooks

register_routes()
install_hooks()

NODE_CLASS_MAPPINGS: dict = {}
NODE_DISPLAY_NAME_MAPPINGS: dict = {}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
