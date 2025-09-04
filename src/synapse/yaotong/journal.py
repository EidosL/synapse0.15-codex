from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime
import os


@dataclass
class Journal:
    title: str
    lines: List[str] = field(default_factory=list)

    def add(self, heading: str, content: str) -> None:
        self.lines.append(f"\n## {heading}\n{content}")

    def to_markdown(self) -> str:
        header = f"# {self.title}\nGenerated at {datetime.utcnow().isoformat()}Z\n"
        return header + "\n".join(self.lines)

    def save(self, dir_path: Optional[str] = None, filename: Optional[str] = None) -> str:
        base = dir_path or os.getenv("YAOTONG_JOURNAL_DIR") or "."
        os.makedirs(base, exist_ok=True)
        name = filename or f"yaotong_run_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.md"
        path = os.path.join(base, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(self.to_markdown())
        return path

