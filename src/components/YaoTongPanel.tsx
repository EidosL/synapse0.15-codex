import React, { useState } from 'react';

type PrescribeResp = {
  prescription: any;
  plan: any;
};

type RunResp = {
  goal: string;
  result: any;
};

export const YaoTongPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [goal, setGoal] = useState("");
  const [rx, setRx] = useState<any | null>(null);
  const [rxText, setRxText] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<RunResp | null>(null);

  const prescribe = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/yaotong/prescribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal })
      });
      const data: PrescribeResp = await r.json();
      setRx(data.prescription);
      setRxText(JSON.stringify(data.prescription, null, 2));
    } finally {
      setLoading(false);
    }
  };

  const run = async () => {
    setLoading(true);
    try {
      let p: any = null;
      try { p = JSON.parse(rxText); } catch {}
      const r = await fetch(`/api/yaotong/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, prescription: p })
      });
      const data: RunResp = await r.json();
      setOutput(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>YaoTong Prescriber</h2>
          <button onClick={onClose} className="modal-close-btn">×</button>
        </div>
        <div className="note-viewer">
          <label>Goal</label>
          <input type="text" value={goal} onChange={e => setGoal(e.target.value)} placeholder="e.g., Compare retrieval strategies for my notes"/>
          <div style={{display:'flex', gap: '0.5rem'}}>
            <button className="button" onClick={prescribe} disabled={!goal || loading}>Prescribe</button>
            <button className="button-secondary" onClick={run} disabled={!goal || loading}>Run</button>
            {loading && <div className="loader-container"><div className="spinner"/> Processing...</div>}
          </div>
          <label>Prescription (editable)</label>
          <textarea value={rxText} onChange={e => setRxText(e.target.value)} rows={12} />
          {output && (
            <div style={{marginTop:'1rem'}}>
              <strong>Run Result:</strong>
              <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(output.result, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

