import os
import json
import uuid
import datetime
from typing import List, Optional, Tuple, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession

from src.database import crud, models, schemas
from src.services import embedding_service


CONFIG_PATH = os.path.join(os.getcwd(), "filesync_config.json")
INDEX_PATH = os.path.join(os.getcwd(), "notes_fs_index.json")

DEFAULT_CONFIG = {
    "notes_dir": os.getenv("NOTES_DIR", os.path.join(os.getcwd(), "vault")),
    "insights_dir": os.getenv("INSIGHTS_DIR", os.path.join(os.getcwd(), "insights_out")),
    "watch_interval_sec": int(os.getenv("NOTES_WATCH_INTERVAL_SEC", "30")),
}


def load_config() -> Dict[str, Any]:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return { **DEFAULT_CONFIG, **data }
        except Exception:
            return DEFAULT_CONFIG.copy()
    return DEFAULT_CONFIG.copy()


def save_config(cfg: Dict[str, Any]):
    try:
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def get_paths() -> Tuple[str, str]:
    cfg = load_config()
    return cfg.get("notes_dir", DEFAULT_CONFIG["notes_dir"]), cfg.get("insights_dir", DEFAULT_CONFIG["insights_dir"])


def _ensure_dirs():
    notes_dir, insights_dir = get_paths()
    os.makedirs(notes_dir, exist_ok=True)
    os.makedirs(insights_dir, exist_ok=True)


def _load_index() -> dict:
    if os.path.exists(INDEX_PATH):
        try:
            with open(INDEX_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_index(idx: dict):
    try:
        with open(INDEX_PATH, 'w', encoding='utf-8') as f:
            json.dump(idx, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _read_text_file(path: str) -> str:
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        return f.read()


def _extract_title(content: str, filename: str) -> str:
    for line in content.splitlines():
        s = line.strip()
        if s.startswith('#'):
            return s.lstrip('#').strip() or filename
        if s:
            # First non-empty line
            return s[:120]
    # Fallback to filename without extension
    base = os.path.splitext(os.path.basename(filename))[0]
    return base


async def import_notes_from_folder(db: AsyncSession) -> int:
    """Scan NOTES_DIR for .md/.txt and import or update notes in DB.
    Returns number of files imported/updated.
    """
    _ensure_dirs()
    idx = _load_index()
    count = 0

    notes_dir, _ = get_paths()
    for root, _, files in os.walk(notes_dir):
        for name in files:
            if not (name.lower().endswith('.md') or name.lower().endswith('.txt')):
                continue
            fpath = os.path.join(root, name)
            try:
                mtime = os.path.getmtime(fpath)
            except OSError:
                continue

            rec = idx.get(fpath)
            if rec and rec.get('mtime') == mtime and rec.get('note_id'):
                # Up-to-date
                continue

            # Read file and upsert note
            text = _read_text_file(fpath)
            title = _extract_title(text, name)

            # If we have an existing note_id, update; else create
            note_id = rec.get('note_id') if rec else None
            if note_id:
                try:
                    # Update
                    await crud.update_note(db, uuid.UUID(note_id), schemas.NoteUpdate(title=title, content=text))
                    # Re-embed
                    db_note = await crud.get_note(db, uuid.UUID(note_id))
                    await embedding_service.generate_and_store_embeddings_for_note(db_note, db)
                except Exception:
                    # Fallback: create new note
                    created = await crud.create_note(db, schemas.NoteCreate(title=title, content=text))
                    await embedding_service.generate_and_store_embeddings_for_note(created, db)
                    note_id = str(created.id)
            else:
                created = await crud.create_note(db, schemas.NoteCreate(title=title, content=text))
                await embedding_service.generate_and_store_embeddings_for_note(created, db)
                note_id = str(created.id)

            idx[fpath] = { 'note_id': note_id, 'mtime': mtime }
            count += 1

    # Commit once at end
    await db.commit()
    _save_index(idx)
    return count


def _sanitize_filename(name: str) -> str:
    bad = '<>:"/\\|?*'
    for ch in bad:
        name = name.replace(ch, '_')
    return name


def _insight_to_markdown(insight: models.Insight) -> str:
    payload = insight.payload or {}
    title = payload.get('title') or payload.get('insightCore') or f"Insight {insight.id}"
    snippet = payload.get('snippet') or payload.get('agenticTranscript') or ''
    # Basic YAML frontmatter
    front = {
        'id': str(insight.id),
        'new_note_id': str(insight.new_note_id),
        'old_note_id': insight.old_note_id,
        'status': insight.status,
        'created_at': insight.created_at.isoformat() if insight.created_at else None,
        'updated_at': insight.updated_at.isoformat() if insight.updated_at else None,
    }
    # Render YAML manually to avoid adding deps
    def y(v):
        if v is None:
            return 'null'
        if isinstance(v, bool):
            return 'true' if v else 'false'
        return str(v).replace('\n', ' ')
    fm = '---\n' + '\n'.join([f"{k}: {y(v)}" for k, v in front.items()]) + '\n---\n'
    body = f"# {title}\n\n" + (snippet or '')
    return fm + body + '\n'


def export_insights_to_folder(insights: List[models.Insight]):
    _ensure_dirs()
    for ins in insights:
        title = (ins.payload or {}).get('title') or 'insight'
        fname = _sanitize_filename(f"{title[:60]}-{ins.id}.md")
        _, insights_dir = get_paths()
        out_path = os.path.join(insights_dir, fname)
        try:
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(_insight_to_markdown(ins))
        except Exception:
            # Best-effort; skip on error
            pass


def export_insight_to_folder(insight: models.Insight):
    export_insights_to_folder([insight])


async def watch_and_import_loop(db_factory, stop_event=None):
    """Background loop to periodically scan notes folder and import updates.
    db_factory should be an async generator like database.get_db.
    """
    import asyncio
    while True:
        cfg = load_config()
        interval = int(cfg.get("watch_interval_sec", 30))
        # Perform one scan
        async for db in db_factory():
            try:
                await import_notes_from_folder(db)
            except Exception:
                pass
            finally:
                await db.close()
        try:
            await asyncio.sleep(max(5, interval))
        except asyncio.CancelledError:
            break


def _parse_frontmatter_and_body(text: str) -> tuple[dict, str]:
    lines = text.splitlines()
    meta: dict[str, Any] = {}
    body_start = 0
    if lines and lines[0].strip() == '---':
        # read until next ---
        for i in range(1, len(lines)):
            if lines[i].strip() == '---':
                body_start = i + 1
                break
            # very simple "key: value" parser
            raw = lines[i]
            if ':' in raw:
                k, v = raw.split(':', 1)
                meta[k.strip()] = v.strip()
    body = '\n'.join(lines[body_start:])
    return meta, body


def read_insights_from_folder() -> list[dict]:
    """Parse Markdown files from insights_dir and return minimal insight records
    compatible with the frontend Insight shape (via inboxInsights.ts recordToInsight).
    """
    _ensure_dirs()
    _, insights_dir = get_paths()
    out: list[dict] = []
    for root, _, files in os.walk(insights_dir):
        for name in files:
            if not name.lower().endswith('.md'):
                continue
            path = os.path.join(root, name)
            try:
                raw = _read_text_file(path)
            except Exception:
                continue
            meta, body = _parse_frontmatter_and_body(raw)
            # Extract title: first markdown H1 or filename
            title = None
            for line in body.splitlines():
                s = line.strip()
                if s.startswith('#'):
                    title = s.lstrip('#').strip()
                    break
                if s:
                    # first non-empty becomes snippet paragraph
                    pass
            if not title:
                title = os.path.splitext(name)[0]

            # snippet: first non-empty paragraph after title
            snippet = ''
            paras = [p.strip() for p in body.split('\n\n') if p.strip()]
            if paras:
                # if first para is title line starting with #, use next
                if paras[0].lstrip().startswith('#') and len(paras) > 1:
                    snippet = paras[1][:400]
                else:
                    snippet = paras[0][:400]

            # Timestamps
            try:
                created_at = meta.get('created_at')
            except Exception:
                created_at = None
            if not created_at:
                try:
                    created_at = datetime.datetime.fromtimestamp(os.path.getmtime(path), datetime.timezone.utc).isoformat()
                except Exception:
                    created_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

            rec = {
                'id': meta.get('id') or f"file-{name}",
                'new_note_id': meta.get('new_note_id') or '',
                'old_note_id': meta.get('old_note_id'),
                'status': meta.get('status') or 'new',
                'payload': {
                    'title': title,
                    'snippet': snippet,
                },
                'created_at': created_at,
                'updated_at': meta.get('updated_at') or None,
            }
            out.append(rec)
    # Sort by created_at desc
    def _key(r: dict):
        return r.get('created_at') or ''
    out.sort(key=_key, reverse=True)
    return out
