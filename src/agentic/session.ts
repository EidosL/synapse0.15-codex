import { runAgenticInsight } from './agenticLoop';
import type { Tier } from './budget';

export class InsightSession {
  id: string; tier: Tier; topic: string;
  transcript: string[] = [];
  mindHints: string[] = [];
  tools: any; hooks?: any;

  constructor(id: string, tier: Tier, topic: string, tools:any, hooks?:any){
    this.id = id; this.tier = tier; this.topic = topic;
    this.tools = tools; this.hooks = hooks;
  }

  seedFromInsight(insightCore: string, evidenceQuotes: string[]){
    this.transcript.push(`INSIGHT: ${insightCore}`);
    if (evidenceQuotes.length) {
      this.transcript.push(`EVIDENCE:\n${evidenceQuotes.map(q=>`> ${q}`).join('\n')}`);
    }
  }

  async userMessage(msg: string){
    this.transcript.push(`USER: ${msg}`);
    await runAgenticInsight({
      tier: this.tier, topic: this.topic,
      transcript: this.transcript, mindHints: this.mindHints, hooks: this.hooks
    }, this.tools);
    return this.transcript.slice(-8).join('\n');
  }

  getFullTranscript(){ return this.transcript.join('\n'); }
}
