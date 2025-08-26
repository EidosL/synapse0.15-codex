# -*- coding: utf-8 -*-
"""Heuristic scoring and lens selection helpers.

This module provides two functions:
- ``score_chunk`` computes an importance score for a text chunk
  based on length and salient roles.
- ``choose_lenses`` selects prompt lenses according to genre,
  importance score, and detected roles.
"""

from typing import Any, Dict, List, Set

SALIENT_ROLES: Set[str] = {
    "claim",
    "decision",
    "conflict",
    "risk",
    "motive",
    "result",
}


def score_chunk(chunk: str, role_info: Dict[str, Any]) -> float:
    """Return an importance score in the range [0, 1].

    The score combines a normalized length heuristic with the
    presence of salient roles.
    """
    length_score = min(len(chunk) / 500.0, 1.0)
    role_score = 0.3 if any(r.get("role") in SALIENT_ROLES for r in role_info.get("roles", [])) else 0.0
    raw = 0.4 * length_score + role_score
    return round(min(1.0, raw), 2)


def choose_lenses(genre: str, score: float, role_info: Dict[str, Any]) -> List[str]:
    """Select prompt lenses based on genre and importance score.

    Parameters
    ----------
    genre:
        Detected genre string, e.g. ``fiction`` or ``paper``.
    score:
        Importance score produced by :func:`score_chunk`.
    role_info:
        Output from role-tagging, containing a ``roles`` list.

    Returns
    -------
    list of str
        Ordered list of lens keys to apply. At most three lenses are
        returned to keep compute costs bounded.
    """
    if score < 0.4:
        return []

    lenses: List[str] = []
    roles = {r.get("role") for r in role_info.get("roles", [])}

    if genre == "fiction":
        lenses.append("fiction.counterfactual_plot")
        if "motive" in roles:
            lenses.append("fiction.character_goal_swap")
    elif genre == "paper":
        lenses.append("paper.boundary_case")
        if "method" in roles:
            lenses.append("paper.ablation_thought")
    elif genre == "tech_report":
        lenses.append("tech_report.tradeoff_flip")
        if "risk" in roles:
            lenses.append("tech_report.risk_matrix_think")
    else:  # default
        lenses.append("default.counterfactual")

    return lenses[:3]
