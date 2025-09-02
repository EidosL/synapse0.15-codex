import React, { useEffect, useState } from 'react';
import { getFilesyncConfig, updateFilesyncConfig, importNotesNow, exportInsightsNow } from '../lib/api/filesync';

type Props = { open: boolean; onClose: () => void };

export const SettingsModal: React.FC<Props> = ({ open, onClose }) => {
  const [notesDir, setNotesDir] = useState('');
  const [insightsDir, setInsightsDir] = useState('');
  const [intervalSec, setIntervalSec] = useState(30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncInsightsOnline, setSyncInsightsOnline] = useState<boolean>(true);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const cfg = await getFilesyncConfig();
        setNotesDir(cfg.notes_dir || '');
        setInsightsDir(cfg.insights_dir || '');
        setIntervalSec(cfg.watch_interval_sec || 30);
        setMsg(null);
        const saved = localStorage.getItem('synapse.syncInsightsOnline');
        setSyncInsightsOnline(saved ? saved === 'true' : true);
      } catch (e: any) {
        setMsg(`加载配置失败: ${e?.message || e}`);
      }
    })();
  }, [open]);

  if (!open) return null;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const cfg = await updateFilesyncConfig({
        notes_dir: notesDir,
        insights_dir: insightsDir,
        watch_interval_sec: intervalSec,
      });
      setNotesDir(cfg.notes_dir || '');
      setInsightsDir(cfg.insights_dir || '');
      setIntervalSec(cfg.watch_interval_sec || 30);
      localStorage.setItem('synapse.syncInsightsOnline', String(syncInsightsOnline));
      setMsg('已保存');
    } catch (e: any) {
      setMsg(`保存失败: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const importNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await importNotesNow();
      setMsg(`已导入/更新 ${r.imported} 个笔记`);
    } catch (e: any) {
      setMsg(`导入失败: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const exportNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await exportInsightsNow();
      setMsg(`已导出 ${r.exported} 条 Insight`);
    } catch (e: any) {
      setMsg(`导出失败: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center'}}>
      <div style={{background:'var(--panel-bg, #1e1e1e)', color:'var(--text-color, #fff)', padding:20, borderRadius:8, width:560, maxWidth:'90%'}}>
        <h2 style={{marginTop:0}}>设置</h2>
        <div style={{display:'flex', flexDirection:'column', gap:12}}>
          <label>
            <div>笔记文件夹 (Markdown/TXT)：</div>
            <input value={notesDir} onChange={e=>setNotesDir(e.target.value)} placeholder="例如 C:\\Users\\me\\Documents\\Vault" style={{width:'100%'}} />
          </label>
          <label>
            <div>Insight 导出文件夹：</div>
            <input value={insightsDir} onChange={e=>setInsightsDir(e.target.value)} placeholder="例如 C:\\Users\\me\\Documents\\Insights" style={{width:'100%'}} />
          </label>
          <label>
            <div>自动扫描间隔（秒）：</div>
            <input type="number" min={5} value={intervalSec} onChange={e=>setIntervalSec(parseInt(e.target.value||'30',10))} />
          </label>
          <label style={{display:'flex', alignItems:'center', gap:8}}>
            <input type="checkbox" checked={syncInsightsOnline} onChange={e=>setSyncInsightsOnline(e.target.checked)} />
            <span>线上同步 Insights（保存到服务器数据库）</span>
          </label>
        </div>
        {msg && <div style={{marginTop:10, color:'#ccc'}}>{msg}</div>}
        <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:16}}>
          <button className="tab-button" onClick={exportNow} disabled={busy}>导出 Insights</button>
          <button className="tab-button" onClick={importNow} disabled={busy}>导入笔记</button>
          <button className="tab-button" onClick={save} disabled={busy}>保存</button>
          <button className="tab-button" onClick={onClose}>关闭</button>
        </div>
        <div style={{marginTop:8, fontSize:12, opacity:0.8}}>
          - 应用会周期性扫描“笔记文件夹”，自动将 Markdown/TXT 加入本地库。
          <br/>
          - 生成的 Insight 会以 Markdown 写入“Insight 导出文件夹”。
        </div>
      </div>
    </div>
  );
};
