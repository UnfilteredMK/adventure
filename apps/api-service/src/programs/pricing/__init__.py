from __future__ import annotations

from typing import Any, Dict


def estimate_pricing(payload: Dict[str, Any]) -> Dict[str, Any]:
    from programs.pricing.orchestrator import estimate_pricing as _estimate_pricing

    return _estimate_pricing(payload)


__all__ = ["estimate_pricing"]
