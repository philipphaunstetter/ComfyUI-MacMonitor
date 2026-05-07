"""HTTP route: GET /macmonitor/stats."""

from __future__ import annotations

import logging

from aiohttp import web

from .monitor import collector

log = logging.getLogger("ComfyUI-MacMonitor")


def register_routes() -> None:
    """Attach routes to ComfyUI's running aiohttp app."""
    try:
        from server import PromptServer  # type: ignore
    except Exception as e:
        log.warning("MacMonitor: could not import ComfyUI PromptServer (%s) — routes not registered.", e)
        return

    instance = getattr(PromptServer, "instance", None)
    if instance is None or getattr(instance, "app", None) is None:
        log.warning("MacMonitor: PromptServer.instance.app unavailable — routes not registered.")
        return

    app = instance.app

    async def stats_handler(request: web.Request) -> web.Response:
        try:
            return web.json_response(collector.snapshot())
        except Exception as e:
            log.exception("MacMonitor: stats snapshot failed")
            return web.json_response(
                {"errors": [str(e)], "is_generating": collector.is_generating},
                status=200,
            )

    app.router.add_get("/macmonitor/stats", stats_handler)
    log.info("MacMonitor: registered GET /macmonitor/stats")
