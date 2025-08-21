import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeGraph } from './types';

/**
 * MindMapTool persists knowledge graphs keyed by session/insight ID
 * and can answer questions by traversing stored nodes and relations.
 */
export class MindMapTool {
    private storagePath: string;
    private graphs: Record<string, KnowledgeGraph> = {};

    constructor(storagePath = path.join(process.cwd(), 'mindmaps.json')) {
        this.storagePath = storagePath;
        this.load();
    }

    private load() {
        if (fs.existsSync(this.storagePath)) {
            const raw = fs.readFileSync(this.storagePath, 'utf8');
            if (raw.trim().length > 0) {
                try {
                    this.graphs = JSON.parse(raw);
                } catch {
                    this.graphs = {};
                }
            }
        }
    }

    private persist() {
        fs.writeFileSync(this.storagePath, JSON.stringify(this.graphs, null, 2), 'utf8');
    }

    /** Store a graph for a given session or insight ID. */
    storeGraph(id: string, graph: KnowledgeGraph): void {
        this.graphs[id] = graph;
        this.persist();
    }

    /**
     * Merge a new graph into the existing graph for the given ID.
     * Nodes and relations are deduplicated by their IDs and endpoints.
     */
    mergeGraph(id: string, graph: KnowledgeGraph): void {
        const existing = this.graphs[id] || { nodes: [], relations: [] };

        const nodeMap = new Map(existing.nodes.map(n => [n.id, n]));
        for (const node of graph.nodes) {
            if (!nodeMap.has(node.id)) {
                existing.nodes.push(node);
                nodeMap.set(node.id, node);
            }
        }

        const relKey = (r: { sourceId: string; targetId: string; description: string }) => `${r.sourceId}->${r.targetId}:${r.description}`;
        const relationSet = new Set(existing.relations.map(relKey));
        for (const rel of graph.relations) {
            const key = relKey(rel);
            if (!relationSet.has(key)) {
                existing.relations.push(rel);
                relationSet.add(key);
            }
        }

        this.graphs[id] = existing;
        this.persist();
    }

    private getNodeTitle(graph: KnowledgeGraph, id: string): string {
        const node = graph.nodes.find(n => n.id === id);
        return node ? node.title : id;
    }

    /**
     * Query the stored graph to retrieve relevant paths that match the query.
     * The query is matched against node titles, node summaries, and relation descriptions.
     */
    answer(id: string, query: string): string {
        const graph = this.graphs[id];
        if (!graph) return 'No graph found';

        const q = query.toLowerCase();
        const paths = new Set<string>();

        const matchedNodes = graph.nodes.filter(n =>
            n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q)
        );

        const matchedRelations = graph.relations.filter(r =>
            r.description.toLowerCase().includes(q)
        );

        const addPathFromRelation = (rel: { sourceId: string; targetId: string; description: string }) => {
            const sourceTitle = this.getNodeTitle(graph, rel.sourceId);
            const targetTitle = this.getNodeTitle(graph, rel.targetId);
            paths.add(`${sourceTitle} -[${rel.description}]-> ${targetTitle}`);
        };

        matchedRelations.forEach(addPathFromRelation);

        for (const node of matchedNodes) {
            const related = graph.relations.filter(r => r.sourceId === node.id || r.targetId === node.id);
            related.forEach(addPathFromRelation);
        }

        if (paths.size === 0) return 'No relevant paths found.';
        return Array.from(paths).join('\n');
    }
}

export default MindMapTool;

