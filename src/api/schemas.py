import uuid
from pydantic import BaseModel

# --- API Models ---

class GenerateInsightsRequest(BaseModel):
    source_note_id: uuid.UUID

class StartResponse(BaseModel):
    job_id: str
    trace_id: str
