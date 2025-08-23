# Project Agent: Insight Generator

This document describes the primary AI agent used in Project Synapse.

## Overview

The core agent is an **Insight Generator**. Its purpose is to take a single topic and explore it to uncover new information and insights. It operates in an autonomous loop, using a set of tools to build a "transcript" of its findings.

This agent is defined in `src/agentic/agenticLoop.ts`.

## How it Works

The agent follows these steps:

1.  **Planning**: Given a topic and a transcript of previous findings, the agent uses a planner (`src/agentic/planner.ts`) to decide on the next action.
2.  **Tool Use**: The agent has access to two main tools:
    *   `web_search`: It can search the web to find new information about the topic. It then summarizes the search results to extract key facts.
    *   `mind_map`: It can interact with a mind map to store and retrieve information in a structured way.
3.  **Transcript**: The agent appends its actions and the results from its tools to a running transcript. This transcript serves as the agent's "short-term memory" and context for future planning steps.
4.  **Budgeting**: The agent operates within a budget (`src/agentic/budget.ts`) that limits the number of steps and tool calls it can make in a single run. This prevents it from running indefinitely.

## Key Files

*   `src/agentic/agenticLoop.ts`: The main entry point and control loop for the agent.
*   `src/agentic/planner.ts`: Contains the logic for planning the agent's next step.
*   `src/agentic/types.ts`: Defines the data structures used by the agent, including the `ToolResult` type.
*   `src/agentic/adapters/`: Contains the code that connects the agent's abstract tool definitions to concrete implementations (e.g., calling the SerpAPI for web search).

## AI Orchestration

While the Insight Generator agent is a key component, it does not run on its own. The entire end-to-end process for finding connections between notes is orchestrated by the `findSynapticLink` function within `src/lib/ai.ts`.

This orchestrator is responsible for:
1.  Calling the backend to perform note clustering to find relevant candidate notes.
2.  Running the initial insight synthesis process.
3.  **Invoking the Insight Generator agent** via the `runAgenticRefinement` function to deepen the analysis on promising insights.
4.  Managing other post-processing steps like multi-hop searches and self-evolution.

Therefore, if you are debugging the overall "find connections" feature, `src/lib/ai.ts` is your starting point. If you are specifically working on the agent's behavior (e.g., its planning or tool use), you should focus on the files listed above.

## Note on the other "agent"

The directory `src/agents/` contains a different kind of agent loop (`src/agents/agentLoop.ts`). This appears to be a multi-agent conversation simulator. It is not currently integrated into the main Project Synapse application and should be considered a separate, experimental feature. For any work related to the user-facing "AI features" of Project Synapse, you should focus on the Insight Generator agent in `src/agentic/`.
