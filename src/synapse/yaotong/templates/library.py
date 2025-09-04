from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import os
import glob
import yaml


@dataclass
class Template:
    name: str
    file_types: List[str]
    sections: List[str]
    hints: Dict[str, Any]


def _load_yaml(path: str) -> Optional[Template]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return Template(
            name=data.get("name", os.path.basename(path)),
            file_types=list(data.get("file_types", [])),
            sections=list(data.get("sections", [])),
            hints=dict(data.get("hints", {})),
        )
    except Exception:
        return None


def load_templates(dir_path: Optional[str] = None) -> List[Template]:
    base = dir_path or os.path.join(os.path.dirname(__file__), "specs")
    out: List[Template] = []
    for p in glob.glob(os.path.join(base, "*.yml")) + glob.glob(os.path.join(base, "*.yaml")):
        t = _load_yaml(p)
        if t:
            out.append(t)
    return out


def detect_template(templates: List[Template], title: str, content: str) -> Optional[Template]:
    """Naive heuristic template detection by keyword cues."""
    c = (title + "\n" + content[:2000]).lower()
    # prioritize technical report cues
    if any(k in c for k in ["abstract", "method", "results", "conclusion", "introduction"]):
        for t in templates:
            if "technical" in t.name.lower():
                return t
    # narrative/novel cues
    if any(k in c for k in ["chapter", "prologue", "epilogue", "he said", "she said"]):
        for t in templates:
            if "novel" in t.name.lower():
                return t
    # meeting/notes cues
    if any(k in c for k in ["action items", "attendees", "agenda", "meeting minutes"]):
        for t in templates:
            if "meeting" in t.name.lower():
                return t
    # fallback to first
    return templates[0] if templates else None

