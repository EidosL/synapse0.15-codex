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

## 🏃‍♀️ Running Locally

**Prerequisites:** [Node.js](https://nodejs.org/)

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/synapse.git
    cd synapse
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Set up your environment variables:**
    Create a file named `.env.local` in the root of the project and add your Gemini API key. This file is not checked into version control, so your API key will remain private.
    ```
    GEMINI_API_KEY=your_api_key
    ```
4.  **Run the app:**
    ```bash
    npm run dev
    ```
The application will be available at `http://localhost:5173`.

## 🖼️ Application in Action

![Synapse in action](placeholder.gif)
