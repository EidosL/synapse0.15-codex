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
