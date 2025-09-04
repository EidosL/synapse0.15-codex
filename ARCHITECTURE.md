# Synapse Architecture Overview

This document provides a high-level overview of the Synapse system architecture. It is intended to help developers understand the major components of the system and how they interact with each other.

## System Components

The Synapse system is composed of the following major components:

*   **Frontend (React/TypeScript)**: The user interface of the application, built with React and TypeScript. It is responsible for rendering the notes, insights, and other UI elements. The frontend communicates with the backend via a REST API. The frontend code is located in the `src/components`, `src/hooks`, and `src/lib` directories.
*   **Backend (Python/FastAPI)**: The backend of the application, built with Python and FastAPI. It is responsible for all core logic, including note management, insight generation, and data persistence. The backend code is located in the `src/` directory, with API routers in `src/api`.
*   **Database (SQLite)**: A SQLite database is used to persist all user data, including notes, chunks of notes, and their vector embeddings. This allows for a stateful backend and removes the need for the client to manage data.
*   **Vector Store (FAISS)**: A FAISS index is used for efficient similarity search on note embeddings. The index is managed by the backend and persisted to disk, allowing for fast retrieval of candidate notes for insight generation.
*   **AI Models (Gemini/OpenAI)**: The system uses AI models from Google (Gemini) and OpenAI to perform various tasks, such as generating embeddings, summarizing text, and generating insights.
*   **Agentic System (TypeScript/Python)**: The agentic system is responsible for the autonomous exploration of topics to uncover new information and insights.

## Data Flow for Note Management

1.  The user interacts with the UI to create, edit, or delete a note.
2.  The frontend calls the appropriate endpoint on the backend's Note API (`/api/notes`).
3.  The backend handles the request, performing the necessary database operations (Create, Read, Update, Delete).
4.  When a note is created or updated, the backend automatically chunks its content, generates vector embeddings, and updates the FAISS index.
5.  The frontend's state is updated with the response from the API.

## Data Flow for Insight Generation

1.  The user clicks the "Find Connections" button in the frontend for a specific note.
2.  The frontend sends a request to the backend's `/api/generate-insights` endpoint, providing only the ID of the source note.
3.  The backend starts an asynchronous job to handle the request.
4.  The backend job runs the Eureka RAG pipeline, which now fetches all necessary data from the database and uses the backend FAISS index to find candidate notes.
5.  The frontend polls the job status endpoint (`/api/jobs/{job_id}`) to get progress updates and the final result.
6.  The results are returned to the frontend and displayed to the user as insights.

This stateful backend architecture provides a clean separation of concerns, enhances scalability, and lays the foundation for future features like multi-device sync and collaboration.

## AgentScope Orchestration

The insight pipeline has been refactored to an AgentScope-style orchestration while preserving API compatibility:

- Wrapper: `src/backend_pipeline.py` keeps the original `run_full_insight_pipeline` name and delegates to `src/agentscope_app/flow/pipeline.py`.
- Agents:
  - Candidate miner: `src/agentscope_app/agents/candidate_miner.py`
  - Fusion crucible: `src/agentscope_app/agents/fusion_crucible.py`
  - Verifier: `src/agentscope_app/agents/verifier.py`
- Tools:
  - FAISS store wrapper: `src/agentscope_app/tools/faiss_store.py`
  - Web search (SERP): `src/agentscope_app/tools/web_search.py`

Environment switches:
- `SERPAPI_API_KEY` enables external verification/search; when missing, verification gracefully degrades without failing the pipeline.
- `SYNAPSE_DATA_DIR`, `VECTOR_INDEX_PATH`, `VECTOR_ID_MAPPING_PATH` control FAISS storage locations.

Tracing (AgentScope + OpenTelemetry):
- Enable by setting `AGENTSCOPE_STUDIO_URL` or `AGENTSCOPE_TRACING_URL` (HTTP OTLP endpoint).
- Required deps are included in `requirements.txt`: `opentelemetry-sdk`, `opentelemetry-exporter-otlp`.
- Spans cover pipeline phases, retrieval, fusion, verification, and tools. When AgentScope is not configured, decorators no-op.

Note CRUD triggers chunking/embedding on create/update. Deletions now also remove corresponding vectors from FAISS (requirement 1.2).

## Runbook

- Create and activate venv (optional if repo venv is used):
  - Windows: `synapse0.15-codex\venv\Scripts\activate`
- Set desired environment variables:
  - LLM (preferred): `VERCEL_AI_GATEWAY_URL`, `VERCEL_AI_GATEWAY_TOKEN`
  - or Google: `GOOGLE_API_KEY` or `GEMINI_API_KEY`
  - External search (optional): `SERPAPI_API_KEY`
  - AgentScope telemetry (optional): `AGENTSCOPE_STUDIO_URL` / `AGENTSCOPE_TRACING_URL`
- Start server:
  - `uvicorn server:app --host 127.0.0.1 --port 8000 --reload`
- Health check:
  - `GET /api/health` shows configured capabilities

## Fallback Strategy

- Tracing: If AgentScope is not installed/configured, `src/agentscope_app/telemetry.py` uses no-op decorators.
- LLM routing: `src/synapse/config/llm.py` tries AgentScope ChatModel → Vercel AI Gateway → Google → (optional) Hugging Face.
- External search: Absent `SERPAPI_API_KEY` disables web verification but the pipeline completes.
- Pipeline: `src/backend_pipeline.py` tries the new AgentScope flow and falls back to the legacy implementation on import/runtime errors.
