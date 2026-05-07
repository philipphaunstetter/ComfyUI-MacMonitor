"""Hook ComfyUI's PromptExecutor to capture generation start/end + duration."""

from __future__ import annotations

import logging
import time

from .monitor import collector

log = logging.getLogger("ComfyUI-MacMonitor")


def install_hooks() -> None:
    """Wrap ComfyUI's executor to record gen time and per-node durations."""
    _install_executor_hook()
    _install_node_timing_hook()


def _install_executor_hook() -> None:
    try:
        import execution  # type: ignore
    except Exception as e:
        log.warning("MacMonitor: could not import ComfyUI 'execution' module (%s) — gen-time disabled.", e)
        return

    PromptExecutor = getattr(execution, "PromptExecutor", None)
    if PromptExecutor is None or not hasattr(PromptExecutor, "execute"):
        log.warning("MacMonitor: PromptExecutor.execute not found — gen-time disabled.")
        return

    if getattr(PromptExecutor.execute, "_macmonitor_wrapped", False):
        return

    original = PromptExecutor.execute

    def wrapped(self, *args, **kwargs):
        collector.mark_gen_start()
        t0 = time.perf_counter()
        try:
            return original(self, *args, **kwargs)
        finally:
            collector.mark_gen_end(time.perf_counter() - t0)

    wrapped._macmonitor_wrapped = True  # type: ignore[attr-defined]
    PromptExecutor.execute = wrapped
    log.info("MacMonitor: PromptExecutor.execute wrapped for gen-time capture.")


def _install_node_timing_hook() -> None:
    """Wrap PromptServer.send_sync to time each node.

    ComfyUI broadcasts 'executing' (with node_id) before a node runs and
    'executed' after. We tap that stream to record per-node durations
    without touching the executor internals.
    """
    try:
        import server as comfy_server  # type: ignore
    except Exception as e:
        log.warning("MacMonitor: could not import ComfyUI 'server' (%s) — per-node timings disabled.", e)
        return

    PromptServer = getattr(comfy_server, "PromptServer", None)
    instance = getattr(PromptServer, "instance", None) if PromptServer else None
    if instance is None or not hasattr(instance, "send_sync"):
        log.warning("MacMonitor: PromptServer.send_sync not found — per-node timings disabled.")
        return

    if getattr(instance.send_sync, "_macmonitor_wrapped", False):
        return

    original = instance.send_sync

    def wrapped(event, data, *args, **kwargs):
        try:
            if isinstance(data, dict):
                node_id = data.get("node")
                if event == "executing" and node_id is not None:
                    collector.mark_node_start(str(node_id))
                elif event == "executing" and node_id is None:
                    # 'executing' with node=None signals "no current node"
                    pass
                elif event == "executed" and node_id is not None:
                    collector.mark_node_end(str(node_id))
        except Exception:
            log.exception("MacMonitor: per-node timing hook error")
        return original(event, data, *args, **kwargs)

    wrapped._macmonitor_wrapped = True  # type: ignore[attr-defined]
    instance.send_sync = wrapped
    log.info("MacMonitor: PromptServer.send_sync wrapped for per-node timing.")
