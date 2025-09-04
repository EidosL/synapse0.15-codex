from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field

from ..models.note import Note
from ..templates.library import load_templates, detect_template, Template
from ..refining.engine import render_markdown
from src.agentscope_app.telemetry import trace
from src.synapse.config.llm import llm_structured, llm_text


class TemplateSpec(BaseModel):
    name: str
    file_types: List[str] = Field(default_factory=list)
    sections: List[str] = Field(default_factory=list)
    hints: Dict[str, Any] = Field(default_factory=dict)


def _to_template(spec: TemplateSpec) -> Template:
    return Template(
        name=spec.name,
        file_types=spec.file_types,
        sections=spec.sections,
        hints=spec.hints,
    )


@trace("yaotong.refiner.select_or_synthesize_template")
async def select_or_synthesize_template(note: Note) -> Optional[Template]:
    tmpls = load_templates()
    # Try library first
    chosen = detect_template(tmpls, note.title, note.content)
    if chosen:
        return chosen

    # LLM synthesize a fitting template as structured output
    sys = (
        "You are a distillation template generator. Given a note title and content, "
        "propose a JSON template with fields: name, file_types[], sections[], hints{summary_style,cite_inline}. "
        "Sections should be appropriate headings for summarizing this content."
    )
    user = f"Title: {note.title}\n\nContent (truncated):\n{note.content[:3000]}"
    try:
        spec = await llm_structured("templateSynthesis", messages=[
            {"role": "system", "content": sys},
            {"role": "user", "content": user},
        ], structured_model=TemplateSpec, options={"temperature": 0.2})
        return _to_template(spec)
    except Exception:
        return None


@trace("yaotong.refiner.distill_markdown")
async def distill_markdown(
    note: Note,
    template: Template,
    originals: Optional[List[Tuple[str, str]]] = None,
) -> str:
    """LLM-guided distillation to Markdown; falls back to render_markdown."""
    # AgentScope-first via llm_text; fallback to rule-based render

    sections_md: List[str] = []
    # If we have originals, perform per-section LLM distillation with evidence
    if originals:
        excerpts = originals[:8]
        # Build excerpt lines without backslashes inside f-string expressions
        lines: List[str] = []
        for cid, txt in excerpts:
            safe = (txt or "").strip().replace("\n", " ")[:240]
            lines.append(f'- [chunk:{cid}] "{safe}"')
        excerpt_lines = "\n".join(lines)
        for sec in template.sections:
            sys = (
                "You are a professional distiller. Write a concise section matching the given heading. "
                "Use ONLY the provided note content and excerpts. After the paragraph, add a subheading 'Evidence' "
                "and list up to 3 bullet items citing [chunk:ID] \"quote\". Return ONLY markdown for this section."
            )
            user = (
                f"Section: {sec}\n\n"
                f"Note Title: {note.title}\n\n"
                f"Note Content (truncated):\n{note.content[:5000]}\n\n"
                f"Excerpts:\n{excerpt_lines}\n"
            )
            text = await llm_text("refineSection", sys + "\n\n" + user, temperature=0.2)
            sec_text = _linkify_chunks(text)
            sections_md.append(f"## {sec}\n{sec_text.strip()}")
        base = f"# {template.name.title()} Distillation: {note.title}\n\n" + "\n\n".join(sections_md)
    else:
        # single-pass sectioned markdown
        sections = "\n".join([f"## {s}" for s in template.sections])
        sys = (
            "You are a professional distiller. Summarize the note into the given sectioned Markdown. "
            "Use only the provided content. Be concise and structured."
        )
        user = (
            f"Target Sections (headings only):\n{sections}\n\n"
            f"Note Title: {note.title}\n\nContent:\n{note.content[:6000]}\n\n"
            "Return ONLY valid Markdown with those headings."
        )
        md = _linkify_chunks(await llm_text("refineSection", sys + "\n\n" + user, temperature=0.2))
        base = md or render_markdown(note, template)
    idx_md = _render_index_md(originals or [])
    fm = _front_matter(originals or [])
    return f"{fm}\n{base}\n\n{idx_md}".strip()


def _render_index_md(originals: List[Tuple[str, str]]) -> str:
    if not originals:
        return ""
    lines = ["## Index to Original"]
    for cid, snippet in originals[:20]:
        short = (snippet or "").strip().replace("\n", " ")
        if len(short) > 140:
            short = short[:140] + "…"
        lines.append(f"- [chunk:{cid}](app://chunk/{cid}) {short}")
    return "\n".join(lines)


def _front_matter(originals: List[Tuple[str, str]]) -> str:
    if not originals:
        return ""
    lines: List[str] = []
    for cid, snippet in originals[:50]:
        q = repr((snippet or "").strip()[:200]).replace("\\", "")
        lines.append(f"  - {{ childId: '{cid}', quote: {q} }}")
    body = "\n".join(lines)
    return f"---\nyaotongIndex:\n{body}\n---"


def _response_text(res: Any) -> str:
    """Extract concatenated text blocks from AgentScope ChatResponse."""
    text_parts: List[str] = []
    for block in getattr(res, "content", []) or []:
        if isinstance(block, dict):
            if block.get("type") == "text" and block.get("text"):
                text_parts.append(str(block.get("text")))
        else:
            try:
                t = getattr(block, "text", None)
                if t:
                    text_parts.append(str(t))
            except Exception:
                pass
    return "\n".join(text_parts).strip()


def _linkify_chunks(md: str) -> str:
    """Turn [chunk:ID] into clickable app links in markdown."""
    import re
    def repl(match: re.Match) -> str:
        cid = match.group(1)
        return f"[chunk:{cid}](app://chunk/{cid})"
    return re.sub(r"\[chunk:([^\]]+)\]", repl, md or "")
