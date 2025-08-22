# server.py
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import os
import langextract as lx
import httpx

app = FastAPI()

class ExampleExtraction(BaseModel):
    extraction_class: str
    extraction_text: str
    attributes: Dict[str, Any] = {}

class ExampleData(BaseModel):
    text: str
    extractions: List[ExampleExtraction]

class ExtractRequest(BaseModel):
    text_or_url: str
    prompt_description: str
    examples: List[ExampleData] = Field(default_factory=list)
    model_id: str = "gemini-2.5-flash"
    extraction_passes: int = 2
    max_workers: int = 8
    max_char_buffer: int = 1200
    api_key: Optional[str] = None

class Span(BaseModel):
    start: int
    end: int

class ExtractionOut(BaseModel):
    klass: str
    text: str
    attrs: Dict[str, Any]
    spans: List[Span]
    source_uri: Optional[str] = None

class ExtractResponse(BaseModel):
    items: List[ExtractionOut]

@app.post("/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest):
    if req.api_key:
        os.environ["LANGEXTRACT_API_KEY"] = req.api_key

    exs = []
    for e in req.examples:
        exs.append(
            lx.data.ExampleData(
                text=e.text,
                extractions=[
                    lx.data.Extraction(
                        extraction_class=ex.extraction_class,
                        extraction_text=ex.extraction_text,
                        attributes=ex.attributes
                    ) for ex in e.extractions
                ]
            )
        )

    result = lx.extract(
        text_or_documents=req.text_or_url,
        prompt_description=req.prompt_description,
        examples=exs,
        model_id=req.model_id,
        extraction_passes=req.extraction_passes,
        max_workers=req.max_workers,
        max_char_buffer=req.max_char_buffer
    )

    # Normalize result: each annotation → (class, text, attributes, spans, source)
    items = []
    for ann in result.annotations:  # langextract returns grounded annotations
        items.append(ExtractionOut(
            klass=ann.extraction_class,
            text=ann.extraction_text,
            attrs=getattr(ann, "attributes", {}) or {},
            spans=[Span(start=s.start, end=s.end) for s in ann.spans],
            source_uri=getattr(ann, "source_uri", getattr(result, "source", None))
        ))
    return ExtractResponse(items=items)

class WebSearchRequest(BaseModel):
    q: str
    k: int

@app.post("/search")
async def web_search(req: WebSearchRequest):
    api_key = os.environ.get("SERPAPI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="SERPAPI_API_KEY environment variable not set on the server.")

    params = {
        "engine": "google",
        "q": req.q,
        "num": str(req.k),
        "api_key": api_key,
        "google_domain": "google.com",
        "gl": "us",
        "hl": "en",
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get("https://serpapi.com/search", params=params)
            response.raise_for_status()  # Raise an exception for bad status codes
            return Response(content=response.content, media_type=response.headers.get("content-type"))
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=f"Error from SerpAPI: {e.response.text}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=500, detail=f"Could not connect to SerpAPI: {e}")
