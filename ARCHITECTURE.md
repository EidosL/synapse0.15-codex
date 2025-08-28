# Synapse Architecture Overview

This document provides a high-level overview of the Synapse system architecture. It is intended to help developers understand the major components of the system and how they interact with each other.

## System Components

The Synapse system is composed of the following major components:

*   **Frontend (React/TypeScript)**: The user interface of the application, built with React and TypeScript. It is responsible for rendering the notes, insights, and other UI elements. The frontend code is located in the `src/components` and `src/hooks` directories.
*   **Backend (Python)**: The backend of the application, built with Python. It is responsible for the core logic of the application, including finding insights, and managing the data. The backend code is located in the `src/eureka_rag` and `src/agentic_py` directories.
*   **Vector Store**: A vector store is used to store and retrieve vector embeddings of the notes. This is a key component of the insight generation process. The vector store is managed by the `src/lib/vectorStore.ts` and `src/hooks/useVectorStore.ts` files.
*   **AI Models (Gemini/OpenAI)**: The system uses AI models from Google (Gemini) and OpenAI to perform various tasks, such as generating embeddings, summarizing text, and generating insights. The AI models are accessed via the `src/lib/ai.ts` file, which acts as a gateway to the different models.
*   **Agentic System (TypeScript/Python)**: The agentic system is responsible for the autonomous exploration of topics to uncover new information and insights. The agentic system is composed of a TypeScript part (`src/agentic`) and a Python part (`src/agentic_py`).

## Data Flow

The following is a high-level overview of the data flow when a user wants to find insights for a note:

1.  The user clicks the "Find Insights" button in the frontend.
2.  The frontend calls the `handleFindInsightsForNote` function in `src/lib/store.ts`.
3.  The `handleFindInsightsForNote` function sends a request to the Python backend via the `runInsightJob` function.
4.  The Python backend receives the request and runs the Eureka RAG pipeline (`src/eureka_rag/main.py`).
5.  The Eureka RAG pipeline embeds the notes, clusters them, and generates summaries for each cluster.
6.  The results are returned to the frontend and displayed to the user as insights.

## AI Orchestration

The `src/lib/ai.ts` file is the central orchestrator for all AI-related operations. It is responsible for:

*   Calling the Python backend to perform note clustering and initial insight synthesis.
*   Invoking the Insight Generator agent to deepen the analysis on promising insights.
*   Managing other post-processing steps like multi-hop searches and self-evolution.

This architecture allows for a separation of concerns between the frontend, backend, and AI models, making the system more modular and easier to maintain.
