import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
    <div className="h-screen flex flex-col bg-slate-100 font-sans text-sm text-slate-800 select-none">
      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-slate-800 tracking-tight">
            AI Workspace
          </h1>
          <p className="text-xs text-slate-400">
            Unified Capability Management for Agents
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleConfigureRepo}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
          >
            配置仓库
          </button>
          {config.repo_root && (
            <>
              <button
                onClick={handleOpenRepo}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
              >
                打开仓库
              </button>
              <span className="text-xs text-slate-500 max-w-md truncate">
                仓库：{config.repo_root}
              </span>
            </>
          )}
          {!config.repo_root && (
            <span className="text-xs text-amber-600 font-medium">
              仓库：未配置。同步前请先配置 skill 仓库。
            </span>
          )}
        </div>
      </header>

      {/* Status bar */}
      <div className="flex-shrink-0 bg-slate-200/70 border-b border-slate-300 px-6 py-1.5">
        <span className="text-xs text-slate-600">{status}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Agent Links */}
        <aside className="w-80 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">
              Agent 链接（{CONTENT_LABELS[currentType]}）
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {targets.length === 0 && (
              <p className="text-xs text-slate-400 italic px-3 py-2">
                未发现支持的 Agent 配置目录。
              </p>
            )}
            {targets.map((t, idx) => (
              <label
                key={t.id}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition-colors ${
                  idx % 2 === 0
                    ? "bg-white hover:bg-slate-50"
                    : "bg-slate-50/70 hover:bg-slate-100"
                } border border-slate-200/60`}
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
                    className="w-3.5 h-3.5 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 cursor-pointer"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 leading-tight">
                    {t.name}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-tight break-all">
                    {t.backend === "wsl" ? "WSL: " : ""}
                    {t.path}
                  </p>
                </div>
                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-slate-100 text-slate-500">
                  {CONTENT_LABELS[t.content_type as ContentType] ?? t.content_type}
                </span>
              </label>
            ))}
          </div>
        </aside>

        {/* Right panel: Content Items */}
        <main className="flex-1 flex flex-col bg-white">
          {/* Content type tabs */}
          <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/50">
            <div className="flex px-4">
              {CONTENT_TYPES.map((ct) => (
                <button
                  key={ct}
                  onClick={() => setCurrentType(ct)}
                  className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    currentType === ct
                      ? "border-emerald-500 text-emerald-700 bg-white"
                      : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                  }`}
                >
                  {CONTENT_LABELS[ct]}
                </button>
              ))}
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex-shrink-0 px-4 py-2 border-b border-slate-100 flex items-center gap-2 bg-white">
            <span className="text-xs text-slate-500 mr-1">搜索：</span>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="筛选项目..."
              className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50"
            />
            <button
              onClick={selectAll}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-emerald-50 hover:border-emerald-300 transition-colors whitespace-nowrap"
            >
              启用当前列表
            </button>
            <button
              onClick={deselectAll}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-amber-50 hover:border-amber-300 transition-colors whitespace-nowrap"
            >
              禁用当前列表
            </button>
            <button
              onClick={handleRefresh}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              刷新列表
            </button>
            <button
              onClick={handleOpenEnabled}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              打开 enabled
            </button>
            <button
              onClick={handleOpenDisabled}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              打开 disabled
            </button>
          </div>

          {/* Item list */}
          <div className="flex-1 overflow-y-auto p-3">
            {filteredItems.length === 0 && (
              <p className="text-xs text-slate-400 italic text-center py-8">
                {config.repo_root
                  ? "暂无项目。请在仓库目录中添加 skill/rules/plugins。"
                  : "请先配置仓库。"}
              </p>
            )}
            {filteredItems.map((item) => (
              <label
                key={item.name}
                className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <div className="flex-shrink-0">
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
                    className="w-3.5 h-3.5 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 cursor-pointer"
                  />
                </div>
                <span className="text-xs text-slate-700">{item.name}</span>
              </label>
            ))}
          </div>
        </main>

        {/* Log panel toggle */}
        <div className="flex-shrink-0 flex flex-col items-center justify-center w-7 bg-slate-200 hover:bg-slate-300 transition-colors cursor-pointer border-l border-slate-300"
             onClick={() => setShowLogs(!showLogs)}
             title={showLogs ? "关闭日志" : "打开日志"}>
          <span className="text-[10px] text-slate-500 leading-tight text-center select-none">
            {showLogs ? "▶" : "◀"}
          </span>
          <span className="text-[9px] text-slate-400 leading-tight text-center select-none mt-0.5">
            日志
          </span>
        </div>

        {/* Log panel (collapsible right sidebar) */}
        {showLogs && (
        <aside className="w-72 flex-shrink-0 bg-slate-900 border-l border-slate-800 flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-xs font-medium text-slate-400">执行日志</h3>
            <button
              onClick={() => setLogs([])}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
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
                      log.startsWith("[!]")
                        ? "text-rose-400"
                        : log.startsWith("[+]")
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
        )}
      </div>

      {/* Bottom action bar */}
      <footer className="flex-shrink-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="text-xs text-slate-500">
          {config.repo_root
            ? `已链接 Agent：${linkedCount}　　${CONTENT_LABELS[currentType]}：${enabledCount} 启用 / ${disabledCount} 禁用`
            : "请先配置仓库路径"}
        </div>
        <button
          onClick={handleSaveAndSync}
          disabled={syncing || !config.repo_root}
          className="px-8 py-2.5 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
        >
          {syncing ? "同步中..." : "保存并同步"}
        </button>
      </footer>
    </div>
  );
}

export default App;
