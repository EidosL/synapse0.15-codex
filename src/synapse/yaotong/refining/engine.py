from __future__ import annotations

from typing import Optional

from ..models.note import Note
from ..templates.library import Template, load_templates, detect_template


def render_markdown(note: Note, tmpl: Template) -> str:
    """Render a template-guided distilled Markdown skeleton for a note.

    This is intentionally lightweight: it creates headings from the template
    sections and fills in naive snippets from the note content. It can be
    upgraded to call LLMs for each section.
    """
    lines = [f"# {tmpl.name.title()} Distillation: {note.title}"]
    for s in tmpl.sections:
        lines.append(f"\n## {s}")
        if s.lower() in {"title"}:
            lines.append(note.title)
        else:
            # naive preview as placeholder; future: section-specific extraction
            lines.append(note.get_preview(400))
    return "\n".join(lines)


def distill_note_to_markdown(note: Note) -> Optional[str]:
    """Auto-detect a template and produce a distilled Markdown; returns None
    if no templates are available.
    """
    tmpls = load_templates()
    if not tmpls:
        return None
    chosen = detect_template(tmpls, note.title, note.content)
    if not chosen:
        return None
    return render_markdown(note, chosen)

