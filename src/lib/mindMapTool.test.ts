import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import MindMapTool from './mindMapTool';
import type { KnowledgeGraph } from './types';

function makeTempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindmap-'));
  return path.join(dir, 'graphs.json');
}

test('stores graphs keyed by session and answers using paths', () => {
  const file = makeTempFile();
  const tool = new MindMapTool(file);
  const graph: KnowledgeGraph = {
    nodes: [
      { id: '1', title: 'Node A', summary: 'A', embedding: [], childChunkIds: [] },
      { id: '2', title: 'Node B', summary: 'B', embedding: [], childChunkIds: [] },
      { id: '3', title: 'Node C', summary: 'C', embedding: [], childChunkIds: [] },
    ],
    relations: [
      { sourceId: '1', targetId: '2', description: 'connects' },
      { sourceId: '2', targetId: '3', description: 'leads to' },
    ],
  };

  tool.storeGraph('session1', graph);

  // New instance should load persisted graph
  const tool2 = new MindMapTool(file);
  const answer = tool2.answer('session1', 'Node A');
  assert.ok(answer.includes('Node A -[connects]-> Node B'));
});

test('mergeGraph adds new nodes and relations without duplicates', () => {
  const file = makeTempFile();
  const tool = new MindMapTool(file);
  const base: KnowledgeGraph = {
    nodes: [
      { id: '1', title: 'Node A', summary: 'A', embedding: [], childChunkIds: [] },
      { id: '2', title: 'Node B', summary: 'B', embedding: [], childChunkIds: [] },
      { id: '3', title: 'Node C', summary: 'C', embedding: [], childChunkIds: [] },
    ],
    relations: [
      { sourceId: '1', targetId: '2', description: 'connects' },
      { sourceId: '2', targetId: '3', description: 'leads to' },
    ],
  };
  tool.storeGraph('s1', base);

  const update: KnowledgeGraph = {
    nodes: [
      { id: '3', title: 'Node C', summary: 'C', embedding: [], childChunkIds: [] },
      { id: '4', title: 'Node D', summary: 'D', embedding: [], childChunkIds: [] },
    ],
    relations: [
      { sourceId: '2', targetId: '3', description: 'leads to' },
      { sourceId: '3', targetId: '4', description: 'results in' },
    ],
  };

  tool.mergeGraph('s1', update);

  const tool2 = new MindMapTool(file);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(stored['s1'].nodes.length, 4);
  assert.equal(stored['s1'].relations.length, 3);

  const answer = tool2.answer('s1', 'Node C');
  assert.ok(answer.includes('Node C -[results in]-> Node D'));
});

