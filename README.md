<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 🧠 Project Synapse

In a world of information overload, it's easy to lose track of valuable connections between your ideas and research. Project Synapse is a note-taking application that acts as your personal "second brain," using artificial intelligence to help you find hidden connections between your notes. It's designed to surface relevant information, spark new insights, and help you think more creatively.

## ✨ Features

- **📝 Note-Taking:** A simple and intuitive interface for creating, editing, and deleting notes. Your notes are saved automatically.
- **☁️ AI-Powered Insights:** Synapse uses a generative AI model to find "synaptic links" between your notes, revealing hidden connections and relationships that you might have missed.
- **📂 Bulk Upload:** Easily import your existing notes from `.md`, `.txt`, and `.pdf` files.
- **🌐 Multilingual Support:** The application is available in multiple languages, and can process notes in any language supported by the AI model.
- **🔒 Privacy-Focused:** All your notes and data are stored locally in your browser's local storage. No data is sent to a server, except for the chunks of text sent to the AI model for embedding.

## 🚀 How to Use

1.  **Set your API Key:** Before you start, you need to provide your Gemini API key. The application will prompt you for it on the first run.
2.  **Create a new note:** Click the "New Note" button in the "Vault" tab to start writing. The editor supports markdown.
3.  **Upload existing notes:** Use the "Upload Files" button to add your existing notes in `.md`, `.txt`, or `.pdf` format. You can select multiple files at once.
4.  **Find connections:** After adding a few notes, click the "Find Connections" button (the icon with the arrows) on a note to see what synaptic links Synapse has discovered.
5.  **Review your insights:** New connections will appear in your "Inbox" tab. You can view the two connected notes side-by-side, and decide whether to keep or dismiss the insight.

## 🛠️ How it Works

Synapse uses a combination of techniques to find connections between your notes:

1.  **Semantic Chunking:** When you add a note, Synapse breaks it down into smaller, semantically related chunks. This allows the application to understand the meaning and context of your notes, rather than just matching keywords.
2.  **Embeddings:** Each chunk is then converted into a numerical representation called an "embedding" using a generative AI model (Google's Gemini). These embeddings capture the semantic meaning of the text.
3.  **Vector Store:** The embeddings are stored in a local vector store in your browser. A vector store is a specialized database that allows for very fast and efficient similarity searches.
4.  **Synaptic Links:** When you ask Synapse to find connections for a note, it takes the chunks from that note, generates embeddings for them, and then searches the vector store for the most similar chunks from other notes. These connections are then presented to you as "synaptic links".

## 🏃‍♀️ Getting Started: Running Synapse Locally

This guide will walk you through setting up and running Project Synapse on your local machine.

### 1. Prerequisites

Before you begin, you'll need to have a few essential tools installed on your computer.

*   **Git:** Git is a version control system used to manage code. You'll need it to download the project files.
    *   [Download Git](https://git-scm.com/downloads)
*   **Node.js:** Node.js is a JavaScript runtime environment that allows you to run JavaScript code outside of a web browser. It also includes `npm` (Node Package Manager), which you'll use to install the project's frontend dependencies.
    *   [Download Node.js](https://nodejs.org/en/download/) (We recommend the LTS version)
*   **Python:** Python is a programming language used for the project's backend.
    *   [Download Python](https://www.python.org/downloads/) (Version 3.8 or higher is recommended)

### 2. Clone the Repository

First, you need to download the project's source code. Open your terminal (on macOS or Linux) or Command Prompt/PowerShell (on Windows), navigate to the directory where you want to store the project, and run the following command:

```bash
git clone https://github.com/your-username/synapse.git
cd synapse
```

This will create a new folder named `synapse` containing all the project files.

### 3. Backend Setup

The backend is responsible for the application's core logic.

1.  **Create a Virtual Environment (Recommended):** It's a good practice to create a virtual environment to isolate the project's dependencies. This prevents conflicts with other Python projects on your system.

    ```bash
    # On macOS and Linux
    python3 -m venv venv
    source venv/bin/activate

    # On Windows
    python -m venv venv
    .\venv\Scripts\activate
    ```

2.  **Install Dependencies:** Install the required Python packages using `pip`.

    ```bash
    pip install -r requirements.txt
    ```

### 4. Frontend Setup

The frontend is the user interface of the application.

1.  **Install Dependencies:** Install the required JavaScript packages using `npm`.

    ```bash
    npm install
    ```
    This command reads the `package.json` file and downloads all the necessary libraries for the user interface.

### 5. Configuration

Synapse requires API keys for some of its features. You'll need to create a special file to store these keys securely.

1.  **Create a `.env.local` file:** In the root of the project directory, create a new file named `.env.local`.

2.  **Add API Keys:** Add the following lines to the `.env.local` file, replacing `your_api_key` with your actual keys.

    ```
    GEMINI_API_KEY=your_gemini_api_key
    SERPAPI_API_KEY=your_serpapi_key
    ```

    *   **`GEMINI_API_KEY`:** You can get a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
    *   **`SERPAPI_API_KEY`:** You can get a SerpAPI key from the [SerpAPI website](https://serpapi.com/). This is used for the web search functionality.

### 6. Running the Application

Now you're ready to start the application! You'll need to run both the backend and frontend servers in separate terminal windows.

1.  **Start the Backend Server:**
    In your first terminal window (with the Python virtual environment activated), run the following command:

    ```bash
    uvicorn server:app --reload
    ```
    The backend server will start on `http://localhost:8000`.

2.  **Start the Frontend Server:**
    In a second terminal window, run the following command:

    ```bash
    npm run dev
    ```
    The frontend development server will start on `http://localhost:5173`.

3.  **Open the Application:**
    You can now access the application by opening your web browser and navigating to `http://localhost:5173`.

## 🖼️ Application in Action

![Synapse in action](placeholder.gif)
