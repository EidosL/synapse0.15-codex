import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4.5.136';
import { semanticChunker, generateBatchEmbeddings } from './ai';
import type { Note, ParentChunk } from './types';
import { VectorStore } from './vectorStore';

// Ensure the worker is configured
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.5.136/build/pdf.worker.mjs`;

/**
 * Reads the content of a file, supporting text, markdown, and PDF formats.
 * @param file The file to read.
 * @returns The title and content of the file.
 */
export const readFileContent = async (file: File): Promise<{ title: string, content: string }> => {
    let content = '';
    if (file.type === 'application/pdf') {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const pageTexts = await Promise.all(
                Array.from({ length: pdf.numPages }, (_, i) => i + 1).map(async pageNum => {
                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    // Make sure to handle the type of item correctly
                    return textContent.items.map((item: any) => item.str).join(' ');
                })
            );
            content = pageTexts.join('\n\n');
        } catch (error) {
            console.error(`Failed to process PDF ${file.name}:`, error);
            content = `Error reading PDF: ${file.name}. The file might be corrupted or protected.`;
        }
    } else {
        content = await file.text();
    }
    const title = file.name.replace(/\.(md|txt|pdf)$/i, '');
    return { title, content };
};

/**
 * Chunks the content of a note.
 * @param content The text content to chunk.
 * @param title The title of the note.
 * @param language The language for chunking.
 * @returns An array of parent chunks.
 */
export const chunkNoteContent = async (
    content: string,
    title: string,
    language: string
): Promise<ParentChunk[]> => {
    return await semanticChunker(content, title, language);
};

/**
 * Generates embeddings for an array of text chunks.
 * @param chunks The text chunks to embed.
 * @returns A promise that resolves to an array of embeddings.
 */
export const embedChunks = async (chunks: string[]): Promise<number[][]> => {
    return await generateBatchEmbeddings(chunks);
};

/**
 * Adds the embeddings for a note to the vector store.
 * @param note The note whose embeddings are to be added.
 * @param embeddings The embeddings for the note's chunks.
 * @param vectorStore The vector store instance.
 */
export const addNoteVectorsToStore = (
    note: Note,
    embeddings: number[][],
    vectorStore: VectorStore
) => {
    if (!note.parentChunks) return;

    const mapping = note.parentChunks.flatMap((pc, pi) => pc.children.map((_, ci) => ({ parentIdx: pi, childIdx: ci })));

    embeddings.forEach((embedding, index) => {
        if (embedding && embedding.length > 0) {
            const { parentIdx, childIdx } = mapping[index];
            vectorStore.addVector(`${note.id}:${parentIdx}:${childIdx}`, embedding);
        } else {
            console.error(`Failed to generate embedding for chunk ${index} of note ${note.id}.`);
        }
    });
};
