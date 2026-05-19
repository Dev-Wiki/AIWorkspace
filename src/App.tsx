import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Settings, FolderOpen, RefreshCw, CheckSquare, Square, ChevronRight, ChevronLeft, Terminal, AlertCircle, FileCode2, Search } from "lucide-react";
import "./App.css";

// ── Types ────────────────────────────────────────────────────────

interface Config {
  repo_root: string | null;
  linked_agents: string[];
}

interface AgentTarget {
  id: string;
  name: string;
  content_type: string;
  path: string;
  backend: string;
  available: boolean;
}

interface Item {
  name: string;
  enabled: boolean;
}

interface ItemMove {
  content_type: string;
  name: string;
  enabled: boolean;
}

interface SyncResult {
  log: string;
  moved_count: number;
  has_errors: boolean;
}

const CONTENT_TYPES = ["skills", "rules", "plugins", "mcps"] as const;
type ContentType = (typeof CONTENT_TYPES)[number];

const CONTENT_LABELS: Record<ContentType, string> = {
  skills: "Skills",
  rules: "Rules",
  plugins: "Plugins",
  mcps: "MCPs",
};

// ── App Component ────────────────────────────────────────────────

function App() {
  // Config state
  const [config, setConfig] = useState<Config>({
    repo_root: null,
    linked_agents: [],
  });

  // UI state
  const [currentType, setCurrentType] = useState<ContentType>("skills");
  const [targets, setTargets] = useState<AgentTarget[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [agentVars, setAgentVars] = useState<Record<string, boolean>>({});
  const [itemVars, setItemVars] = useState<Record<string, boolean>>({});
  const [originalItemStates, setOriginalItemStates] = useState<
    Record<string, boolean>
  >({});
  const [searchText, setSearchText] = useState("");
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [defaultRepo, setDefaultRepo] = useState("");
  const [showLogs, setShowLogs] = useState(false);

  // ── Initialization ───────────────────────────────────────────

  useEffect(() => {
    loadConfig();
    invoke<string>("get_repo_default").then(setDefaultRepo).catch(() => {});
  }, []);

  useEffect(() => {
    if (config.repo_root) {
      loadContent();
    }
  }, [config.repo_root, currentType]);

  const loadConfig = async () => {
    try {
      const cfg = await invoke<Config>("get_config");
      setConfig(cfg);
      if (cfg.repo_root) {
        setConfig(cfg);
      }
    } catch (e) {
      console.error("loadConfig:", e);
    }
  };

  const loadContent = async () => {
    try {
      const [t, i] = await Promise.all([
        invoke<AgentTarget[]>("get_targets", { contentType: currentType }),
        invoke<Item[]>("get_items", { contentType: currentType }),
      ]);
      setTargets(t);

      // Preserve existing agent checkbox states, initialize new ones based on config
      const newAgentVars: Record<string, boolean> = {};
      for (const target of t) {
        if (target.id in agentVars) {
          newAgentVars[target.id] = agentVars[target.id];
        } else {
          // Default: checked if in linked_agents, or if linked_agents is empty and target is managed
          newAgentVars[target.id] =
            config.linked_agents.length === 0
              ? true
              : config.linked_agents.includes(target.id);
        }
      }
      setAgentVars(newAgentVars);

      // Preserve existing item checkbox states, initialize new ones from disk
      const newItemVars: Record<string, boolean> = {};
      const newOriginal: Record<string, boolean> = {};
      for (const item of i) {
        if (item.name in itemVars) {
          newItemVars[item.name] = itemVars[item.name];
        } else {
          newItemVars[item.name] = item.enabled;
        }
        newOriginal[item.name] = item.enabled;
      }
      setItemVars(newItemVars);
      setOriginalItemStates(newOriginal);
      setItems(i);
      updateStatus(newAgentVars, newItemVars);
    } catch (e) {
      console.error("loadContent:", e);
    }
  };

  // ── Status ───────────────────────────────────────────────────

  const updateStatus = (
    agents: Record<string, boolean>,
    iv: Record<string, boolean>
  ) => {
    const linked = Object.values(agents).filter(Boolean).length;
    const enabled = Object.values(iv).filter(Boolean).length;
    const disabled = Object.keys(iv).length - enabled;
    const label = CONTENT_LABELS[currentType];
    if (!config.repo_root) {
      setStatus("仓库未配置");
    } else {
      setStatus(
        `已链接 Agent：${linked}    当前：${label}    已启用：${enabled}    已禁用：${disabled}`
      );
    }
  };

  // ── Actions ──────────────────────────────────────────────────

  const handleConfigureRepo = async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      defaultPath: config.repo_root || defaultRepo,
      title: "选择 Skill 仓库",
    });
    if (!dir) return;
    try {
      const cfg = await invoke<Config>("configure_repo", {
        repoRoot: dir,
      });
      setConfig(cfg);
      setLogs((prev) => [...prev, `仓库已配置：${cfg.repo_root}`]);
    } catch (e) {
      console.error("configure_repo:", e);
      setLogs((prev) => [...prev, `[错误] ${e}`]);
    }
  };

  const handleOpenRepo = () => {
    if (config.repo_root) {
      invoke("open_directory", { path: config.repo_root }).catch((e) =>
        console.error(e)
      );
    }
  };

  const handleOpenEnabled = () => {
    if (config.repo_root) {
      invoke("open_directory", {
        path: `${config.repo_root}/${currentType}/enabled`,
      }).catch((e) => console.error(e));
    }
  };

  const handleOpenDisabled = () => {
    if (config.repo_root) {
      invoke("open_directory", {
        path: `${config.repo_root}/${currentType}/disabled`,
      }).catch((e) => console.error(e));
    }
  };

  const handleRefresh = () => {
    setSearchText("");
    loadContent();
  };

  const handleSaveAndSync = async () => {
    if (!config.repo_root) {
      setLogs((prev) => [...prev, "[错误] 请先配置仓库"]);
      return;
    }

    const selectedAgents = Object.entries(agentVars)
      .filter(([, v]) => v)
      .map(([k]) => k);

    // Compute moved items
    const itemsToMove: ItemMove[] = [];
    for (const name of Object.keys(itemVars)) {
      const current = itemVars[name];
      const original = originalItemStates[name];
      if (current !== original) {
        itemsToMove.push({
          content_type: currentType,
          name,
          enabled: current,
        });
      }
    }

    // Collect items from other content types (not currently displayed) without changes
    // We don't track changes for non-visible tabs, so we send empty moves for them
    // The backend will handle the actual state from disk

    setSyncing(true);
    setLogs((prev) => [...prev, "开始同步..."]);
    try {
      const result = await invoke<SyncResult>("save_and_sync", {
        linkedAgents: selectedAgents,
        itemsToMove: itemsToMove,
      });
      setConfig((prev) => ({
        ...prev,
        linked_agents: selectedAgents,
      }));
      setLogs((prev) => [...prev, ...result.log.split("\n").filter(Boolean)]);
      setLogs((prev) => [
        ...prev,
        result.has_errors
          ? "同步完成（有警告）"
          : `同步完成，移动项目：${result.moved_count}`,
      ]);
      // Refresh items to get new state from disk after move
      const i = await invoke<Item[]>("get_items", {
        contentType: currentType,
      });
      const newItemVars: Record<string, boolean> = {};
      const newOriginal: Record<string, boolean> = {};
      for (const item of i) {
        newItemVars[item.name] = item.enabled;
        newOriginal[item.name] = item.enabled;
      }
      setItemVars(newItemVars);
      setOriginalItemStates(newOriginal);
      setItems(i);
      updateStatus(agentVars, newItemVars);
    } catch (e) {
      console.error("save_and_sync:", e);
      setLogs((prev) => [...prev, `[错误] ${e}`]);
    } finally {
      setSyncing(false);
    }
  };

  const selectAll = () => {
    setItemVars((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (searchText === "" || item.name.toLowerCase().includes(searchText.toLowerCase())) {
          next[item.name] = true;
        }
      }
      updateStatus(agentVars, next);
      return next;
    });
  };

  const deselectAll = () => {
    setItemVars((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (searchText === "" || item.name.toLowerCase().includes(searchText.toLowerCase())) {
          next[item.name] = false;
        }
      }
      updateStatus(agentVars, next);
      return next;
    });
  };

  const filteredItems = useMemo(() => {
    if (!searchText) return items;
    const q = searchText.toLowerCase();
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, searchText]);

  const linkedCount = Object.values(agentVars).filter(Boolean).length;
  const enabledCount = Object.values(itemVars).filter(Boolean).length;
  const disabledCount = Object.keys(itemVars).length - enabledCount;

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-[#020617] font-sans text-sm text-slate-200 select-none">
      {/* Header */}
      <header className="flex-shrink-0 bg-[#0F172A] border-b border-slate-800/80 px-6 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <FileCode2 className="w-5 h-5 text-emerald-500" />
            AI Workspace
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Unified Capability Management for Agents
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleConfigureRepo}
            className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium bg-[#1E293B] border border-slate-700/50 rounded-md hover:bg-slate-700 active:scale-95 transition-all text-slate-200"
          >
            <Settings className="w-3.5 h-3.5" />
            配置仓库
          </button>
          {config.repo_root && (
            <>
              <button
                onClick={handleOpenRepo}
                className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium bg-[#1E293B] border border-slate-700/50 rounded-md hover:bg-slate-700 active:scale-95 transition-all text-slate-200"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                打开仓库
              </button>
              <span className="text-xs text-slate-400 max-w-md truncate bg-[#1E293B]/50 px-2.5 py-1 rounded-md border border-slate-800">
                仓库：{config.repo_root}
              </span>
            </>
          )}
          {!config.repo_root && (
            <span className="text-xs flex items-center gap-1.5 text-amber-500/90 font-medium bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20">
              <AlertCircle className="w-3.5 h-3.5" />
              仓库未配置，请先设置路径
            </span>
          )}
        </div>
      </header>

      {/* Status bar */}
      <div className="flex-shrink-0 bg-[#0F172A]/80 border-b border-slate-800/80 px-6 py-1.5">
        <span className="text-[11px] font-medium text-slate-400 tracking-wide">{status}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Agent Links */}
        <aside className="w-80 flex-shrink-0 bg-[#0F172A] border-r border-slate-800/80 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800/50 bg-[#1E293B]/30">
            <h2 className="text-sm font-semibold text-slate-200">
              Agent 链接（{CONTENT_LABELS[currentType]}）
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {targets.length === 0 && (
              <p className="text-xs text-slate-500 italic px-3 py-2">
                未发现支持的 Agent 配置目录。
              </p>
            )}
            {targets.map((t) => (
              <label
                key={t.id}
                className="flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition-all hover:bg-[#1E293B]/80 bg-[#1E293B]/30 border border-slate-800/60 active:scale-[0.98] group"
              >
                <div className="pt-0.5 flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={agentVars[t.id] ?? false}
                    onChange={() => {
                      setAgentVars((prev) => {
                        const next = { ...prev, [t.id]: !prev[t.id] };
                        updateStatus(next, itemVars);
                        return next;
                      });
                    }}
                    className="w-3.5 h-3.5 text-emerald-500 border-slate-600 bg-slate-800 rounded focus:ring-emerald-500/30 focus:ring-2 focus:ring-offset-0 cursor-pointer"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-200 leading-tight group-hover:text-emerald-400 transition-colors">
                    {t.name}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-tight break-all">
                    {t.backend === "wsl" ? "WSL: " : ""}
                    {t.path}
                  </p>
                </div>
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-[#020617] text-slate-400 border border-slate-800">
                  {CONTENT_LABELS[t.content_type as ContentType] ?? t.content_type}
                </span>
              </label>
            ))}
          </div>
        </aside>

        {/* Right panel: Content Items */}
        <main className="flex-1 flex flex-col bg-[#020617]">
          {/* Content type tabs */}
          <div className="flex-shrink-0 border-b border-slate-800/80 bg-[#0F172A]">
            <div className="flex px-4">
              {CONTENT_TYPES.map((ct) => (
                <button
                  key={ct}
                  onClick={() => setCurrentType(ct)}
                  className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    currentType === ct
                      ? "border-emerald-500 text-emerald-400 bg-[#1E293B]/40"
                      : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600"
                  }`}
                >
                  {CONTENT_LABELS[ct]}
                </button>
              ))}
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex-shrink-0 px-4 py-2 border-b border-slate-800/50 flex items-center gap-2 bg-[#0F172A]/50">
            <span className="text-xs text-slate-400 mr-1">搜索：</span>
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="筛选项目..."
                className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-700/50 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50 bg-[#1E293B] text-slate-200 placeholder:text-slate-500 transition-all"
              />
            </div>
            <button
              onClick={selectAll}
              className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium bg-[#1E293B] border border-slate-700/50 rounded-md hover:bg-emerald-900/30 hover:border-emerald-700/50 hover:text-emerald-400 active:scale-95 transition-all whitespace-nowrap text-slate-300"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              全部启用
            </button>
            <button
              onClick={deselectAll}
              className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium bg-[#1E293B] border border-slate-700/50 rounded-md hover:bg-rose-900/30 hover:border-rose-700/50 hover:text-rose-400 active:scale-95 transition-all whitespace-nowrap text-slate-300"
            >
              <Square className="w-3.5 h-3.5" />
              全部禁用
            </button>
            <button
              onClick={handleRefresh}
              className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium bg-[#1E293B] border border-slate-700/50 rounded-md hover:bg-slate-700 hover:text-slate-200 active:scale-95 transition-all whitespace-nowrap text-slate-300 ml-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
            <button
              onClick={handleOpenEnabled}
              className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium bg-[#1E293B] border border-slate-700/50 rounded-md hover:bg-slate-700 hover:text-slate-200 active:scale-95 transition-all whitespace-nowrap text-slate-300"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              enabled
            </button>
            <button
              onClick={handleOpenDisabled}
              className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium bg-[#1E293B] border border-slate-700/50 rounded-md hover:bg-slate-700 hover:text-slate-200 active:scale-95 transition-all whitespace-nowrap text-slate-300"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              disabled
            </button>
          </div>

          {/* Item list */}
          <div className="flex-1 overflow-y-auto p-4">
            {filteredItems.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                <Terminal className="w-10 h-10 opacity-50" />
                <p className="text-xs italic text-center">
                  {config.repo_root
                    ? "暂无项目。请在仓库目录中添加 skill/rules/plugins。"
                    : "请先配置仓库。"}
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {filteredItems.map((item) => (
                <label
                  key={item.name}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#1E293B]/20 hover:bg-[#1E293B]/80 border border-transparent hover:border-slate-700/50 cursor-pointer transition-all active:scale-[0.98] group"
                >
                  <div className="flex-shrink-0 pt-0.5">
                    <input
                      type="checkbox"
                      checked={itemVars[item.name] ?? item.enabled}
                      onChange={() => {
                        setItemVars((prev) => {
                          const next = { ...prev, [item.name]: !prev[item.name] };
                          updateStatus(agentVars, next);
                          return next;
                        });
                      }}
                      className="w-4 h-4 text-emerald-500 border-slate-600 bg-slate-800 rounded focus:ring-emerald-500/30 focus:ring-2 focus:ring-offset-0 cursor-pointer transition-colors"
                    />
                  </div>
                  <span className="text-xs font-medium text-slate-300 group-hover:text-emerald-400 transition-colors truncate">
                    {item.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </main>

        {/* Log panel toggle */}
        <div className="flex-shrink-0 flex flex-col items-center justify-center w-8 bg-[#0F172A] hover:bg-[#1E293B] transition-colors cursor-pointer border-l border-slate-800/80 z-10"
             onClick={() => setShowLogs(!showLogs)}
             title={showLogs ? "关闭日志" : "打开日志"}>
          {showLogs ? (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-slate-500" />
          )}
          <span className="text-[10px] text-slate-500 leading-tight text-center select-none mt-2 rotate-180" style={{ writingMode: 'vertical-rl' }}>
            执 行 日 志
          </span>
        </div>

        {/* Log panel (collapsible right sidebar) */}
        <aside className={`flex-shrink-0 bg-[#0A0F1C] border-l border-slate-800/80 flex flex-col transition-all duration-300 ease-in-out ${showLogs ? 'w-80 opacity-100' : 'w-0 opacity-0 overflow-hidden border-none'}`}>
          <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between bg-[#0F172A]">
            <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-emerald-500" />
              执行日志
            </h3>
            <button
              onClick={() => setLogs([])}
              className="text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 px-2 py-1 rounded transition-colors"
            >
              清空
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed space-y-1 select-text">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">暂无活动记录。</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="break-words">
                  <span
                    className={
                      log.startsWith("[!]") || log.includes("错误")
                        ? "text-rose-400"
                        : log.startsWith("[+]") || log.includes("成功") || log.includes("完成")
                          ? "text-emerald-400"
                          : log.startsWith("[-]")
                            ? "text-amber-400"
                            : "text-slate-300"
                    }
                  >
                    {log}
                  </span>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* Bottom action bar */}
      <footer className="flex-shrink-0 bg-[#0F172A] border-t border-slate-800/80 px-6 py-3 flex items-center justify-between shadow-sm z-10">
        <div className="text-xs font-medium text-slate-400">
          {config.repo_root
            ? (
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                  已链接 Agent：{linkedCount}
                </span>
                <span className="flex items-center gap-1.5 border-l border-slate-700 pl-4">
                  <span className="text-emerald-400">{enabledCount} 启用</span>
                  <span className="text-slate-600">/</span>
                  <span className="text-slate-500">{disabledCount} 禁用</span>
                </span>
              </div>
            )
            : "请先配置仓库路径"}
        </div>
        <button
          onClick={handleSaveAndSync}
          disabled={syncing || !config.repo_root}
          className="px-8 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:bg-slate-800 disabled:text-slate-600 disabled:active:scale-100 text-white text-sm font-semibold rounded-md shadow-sm transition-all focus:ring-2 focus:ring-emerald-500/50 focus:outline-none flex items-center gap-2"
        >
          {syncing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              同步中...
            </>
          ) : (
            <>
              <CheckSquare className="w-4 h-4" />
              保存并同步
            </>
          )}
        </button>
      </footer>
    </div>
  );
}

export default App;
