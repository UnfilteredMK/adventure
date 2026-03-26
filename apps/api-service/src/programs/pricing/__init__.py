from __future__ import annotations

from typing import Any, Dict


def estimate_pricing(payload: Dict[str, Any]) -> Dict[str, Any]:
    from programs.pricing.orchestrator import estimate_pricing as _estimate_pricing

    return _estimate_pricing(payload)


def generate_price_ladder_gallery(payload: Dict[str, Any]) -> Dict[str, Any]:
    from programs.pricing.price_ladder_gallery import generate_price_ladder_gallery as _generate_price_ladder_gallery

    return _generate_price_ladder_gallery(payload)


__all__ = ["estimate_pricing", "generate_price_ladder_gallery"]
