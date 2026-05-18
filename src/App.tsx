import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type IdeTarget = {
  id: string;
  name: string;
  type: string;
  path: string;
};

const DEFAULT_TARGETS: IdeTarget[] = [
  { id: "cursor", name: "Cursor", type: "skills", path: "~/.cursor/skills" },
  { id: "cursor-rules", name: "Cursor Rules", type: "rules", path: "~/.cursor/rules" },
  { id: "gemini", name: "Gemini CLI", type: "skills", path: "~/.gemini/antigravity/skills" },
  { id: "claude", name: "Claude CLI", type: "skills", path: "~/.claude/skills" },
];

function App() {
  const [status, setStatus] = useState("Ready");
  const [logs, setLogs] = useState<string[]>([]);
  const [targets, setTargets] = useState<IdeTarget[]>(DEFAULT_TARGETS);
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_TARGETS.map(t => t.id));

  async function handleSync() {
    setStatus("Syncing...");
    setLogs(prev => [...prev, "Starting sync..."]);
    
    try {
      const selectedTargets = targets.filter(t => selectedIds.includes(t.id));
      
      const result = await invoke<string>("sync_workspace", {
        targets: selectedTargets,
      });
      
      setLogs(prev => [...prev, result]);
      setStatus("Sync Complete");
    } catch (error) {
      console.error(error);
      setLogs(prev => [...prev, `[Error] ${error}`]);
      setStatus("Error");
    }
  }

  const toggleTarget = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col p-6 font-sans">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">AIWorkspace</h1>
          <p className="text-sm text-slate-500 mt-1">Unified Capability Management for Agents</p>
        </div>
        <div className="px-3 py-1 bg-white border border-slate-200 rounded-full shadow-sm text-xs font-medium text-slate-600">
          Status: <span className={status === "Error" ? "text-red-500" : "text-emerald-600"}>{status}</span>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
            <h2 className="font-semibold text-slate-800">Target IDEs & Agents</h2>
          </div>
          <div className="p-2 flex-1 overflow-y-auto">
            {targets.map(target => (
              <label 
                key={target.id} 
                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${selectedIds.includes(target.id) ? 'bg-brand-50 hover:bg-brand-50' : 'hover:bg-slate-50'}`}
              >
                <div className="pt-0.5">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.includes(target.id)}
                    onChange={() => toggleTarget(target.id)}
                    className="w-4 h-4 text-brand-600 border-slate-300 rounded focus:ring-brand-600 cursor-pointer" 
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700">{target.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate font-mono">{target.path}</p>
                </div>
                <div className="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-slate-100 text-slate-500">
                  {target.type}
                </div>
              </label>
            ))}
          </div>
          <div className="p-4 border-t border-slate-100 bg-slate-50/50">
            <button 
              onClick={handleSync}
              className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:opacity-50"
              disabled={status === "Syncing..." || selectedIds.length === 0}
            >
              {status === "Syncing..." ? "Synchronizing..." : "Sync Workspace to Agents"}
            </button>
          </div>
        </section>

        <section className="bg-slate-900 rounded-xl shadow-sm border border-slate-800 overflow-hidden flex flex-col text-slate-300">
          <div className="px-5 py-3 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center">
            <h2 className="text-sm font-medium text-slate-400">Execution Log</h2>
            <button 
              onClick={() => setLogs([])}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="p-5 flex-1 overflow-y-auto font-mono text-xs leading-relaxed space-y-1">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">No activity yet. Select targets and click Sync.</p>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="break-words">
                  <span className="text-slate-500 select-none mr-2">{'>'}</span>
                  <span className={log.includes("[Error]") ? "text-rose-400" : log.includes("[+]") ? "text-emerald-400" : "text-slate-300"}>
                    {log}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
