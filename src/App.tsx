import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Settings, FolderOpen, RefreshCw, CheckSquare, Square, Terminal, AlertCircle, FileCode2, Search, Save, Trash2, Plus, X, CheckCircle2, Info } from "lucide-react";
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

interface SyncResult {
  log: string;
  moved_count: number;
  has_errors: boolean;
}

interface Profile {
  name: string;
  skills: string[];
  rules: string[];
  plugins: string[];
  mcps: string[];
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
  const [items, setItems] = useState<Item[]>([]); // All items on disk for currentType
  const [agentVars, setAgentVars] = useState<Record<string, boolean>>({});
  
  // Profile state
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile>({
    name: "Custom",
    skills: [],
    rules: [],
    plugins: [],
    mcps: [],
  });

  const [searchText, setSearchText] = useState("");
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [defaultRepo, setDefaultRepo] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Modals & Toast State
  const [showLogModal, setShowLogModal] = useState(false);
  const [toast, setToast] = useState<{text: string, type: 'success' | 'error' | 'info'} | null>(null);
  const [profileModal, setProfileModal] = useState({ isOpen: false, isNew: false, inputName: "" });
  const [confirmModal, setConfirmModal] = useState<{isOpen: boolean, message: string, confirmText?: string, onConfirm: () => void}>({isOpen: false, message: "", confirmText: "确认", onConfirm: () => {}});

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({text, type});
    setTimeout(() => setToast(null), 3000);
  };

  // ── Initialization ───────────────────────────────────────────

  useEffect(() => {
    loadConfig();
    invoke<string>("get_repo_default").then(setDefaultRepo).catch(() => {});
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (config.repo_root) {
      initCurrentState();
    }
  }, [config.repo_root]);

  useEffect(() => {
    if (config.repo_root) {
      loadContent();
    }
  }, [config.repo_root, currentType]);

  const loadConfig = async () => {
    try {
      const cfg = await invoke<Config>("get_config");
      setConfig(cfg);
    } catch (e) {
      console.error("loadConfig:", e);
    }
  };

  const initCurrentState = async () => {
    try {
      const ps = await invoke<Profile[]>("get_profiles");
      setProfiles(ps);

      const [skills, rules, plugins, mcps] = await Promise.all([
        invoke<Item[]>("get_items", { contentType: "skills" }),
        invoke<Item[]>("get_items", { contentType: "rules" }),
        invoke<Item[]>("get_items", { contentType: "plugins" }),
        invoke<Item[]>("get_items", { contentType: "mcps" }),
      ]);

      const cp: Profile = {
        name: "Custom",
        skills: skills.filter((i) => i.enabled).map((i) => i.name),
        rules: rules.filter((i) => i.enabled).map((i) => i.name),
        plugins: plugins.filter((i) => i.enabled).map((i) => i.name),
        mcps: mcps.filter((i) => i.enabled).map((i) => i.name),
      };
      
      // Check if it matches an existing profile exactly
      const matched = ps.find(p => 
        JSON.stringify([...p.skills].sort()) === JSON.stringify([...cp.skills].sort()) &&
        JSON.stringify([...p.rules].sort()) === JSON.stringify([...cp.rules].sort()) &&
        JSON.stringify([...p.plugins].sort()) === JSON.stringify([...cp.plugins].sort()) &&
        JSON.stringify([...p.mcps].sort()) === JSON.stringify([...cp.mcps].sort())
      );

      setCurrentProfile(matched ? matched : cp);
    } catch (e) {
      console.error("initCurrentState:", e);
    }
  };

  const loadContent = async () => {
    try {
      const [t, i] = await Promise.all([
        invoke<AgentTarget[]>("get_targets", { contentType: currentType }),
        invoke<Item[]>("get_items", { contentType: currentType }),
      ]);
      setTargets(t);

      const newAgentVars: Record<string, boolean> = {};
      for (const target of t) {
        if (target.id in agentVars) {
          newAgentVars[target.id] = agentVars[target.id];
        } else {
          newAgentVars[target.id] =
            config.linked_agents.length === 0
              ? true
              : config.linked_agents.includes(target.id);
        }
      }
      setAgentVars(newAgentVars);
      setItems(i);
      updateStatus(newAgentVars, currentProfile, i);
    } catch (e) {
      console.error("loadContent:", e);
    }
  };

  // ── Status ───────────────────────────────────────────────────

  const updateStatus = (
    agents: Record<string, boolean>,
    profile: Profile,
    currentItems: Item[] = items
  ) => {
    const linked = Object.values(agents).filter(Boolean).length;
    const enabled = profile[currentType].length;
    const total = currentItems.length;
    const disabled = total - enabled;
    const label = CONTENT_LABELS[currentType];
    if (!config.repo_root) {
      setStatus("仓库未配置");
    } else {
      setStatus(
        `已链接 Agent：${linked}    当前：${label}    已启用：${enabled}    已禁用：${disabled >= 0 ? disabled : 0}`
      );
    }
  };

  useEffect(() => {
    updateStatus(agentVars, currentProfile, items);
  }, [agentVars, currentProfile, items, currentType]);

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
      showToast('仓库配置成功', 'success');
      setLogs((prev) => [...prev, `仓库已配置：${cfg.repo_root}`]);
    } catch (e) {
      showToast(`配置失败: ${e}`, 'error');
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

  const handleRefresh = () => {
    setSearchText("");
    initCurrentState();
    loadContent();
    showToast('已刷新配置', 'info');
  };

  const openSaveProfileModal = (saveAsNew: boolean) => {
    let name = currentProfile.name;
    setProfileModal({
      isOpen: true,
      isNew: saveAsNew,
      inputName: (saveAsNew || name === "Custom") ? "" : name
    });
  };

  const confirmSaveProfile = async () => {
    const name = profileModal.inputName.trim();
    if (!name) return;
    try {
      const newP = { ...currentProfile, name };
      await invoke("save_profile", { profile: newP });
      const ps = await invoke<Profile[]>("get_profiles");
      setProfiles(ps);
      setCurrentProfile(newP);
      showToast(`保存 Profile 成功：${name}`, 'success');
      setLogs((prev) => [...prev, `[+] 保存 Profile 成功：${name}`]);
    } catch (e) {
      showToast(`保存 Profile 失败: ${e}`, 'error');
      setLogs((prev) => [...prev, `[!] 保存 Profile 失败: ${e}`]);
    }
    setProfileModal({ ...profileModal, isOpen: false });
  };

  const handleDeleteProfile = () => {
    if (currentProfile.name === "Custom") return;
    setConfirmModal({
      isOpen: true,
      message: `确定要删除 Profile '${currentProfile.name}' 吗？此操作无法撤销。`,
      onConfirm: async () => {
        try {
          await invoke("delete_profile", { name: currentProfile.name });
          const ps = await invoke<Profile[]>("get_profiles");
          setProfiles(ps);
          setCurrentProfile({ ...currentProfile, name: "Custom" });
          showToast(`已删除 Profile：${currentProfile.name}`, 'info');
          setLogs((prev) => [...prev, `[-] 删除 Profile：${currentProfile.name}`]);
        } catch (e) {
          showToast(`删除 Profile 失败: ${e}`, 'error');
          setLogs((prev) => [...prev, `[!] 删除 Profile 失败: ${e}`]);
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleSelectProfile = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pName = e.target.value;
    if (pName === "Custom") {
      setCurrentProfile({ ...currentProfile, name: "Custom" });
      return;
    }
    const p = profiles.find((x) => x.name === pName);
    if (p) {
      setCurrentProfile(p);
    }
  };

  const handleSaveAndSync = async () => {
    if (!config.repo_root) {
      showToast("请先配置仓库", "error");
      return;
    }

    const selectedAgents = Object.entries(agentVars)
      .filter(([, v]) => v)
      .map(([k]) => k);

    setSyncing(true);
    setLogs((prev) => {
      const newLogs = [...prev, `开始同步 (Profile: ${currentProfile.name})...`];
      return newLogs.slice(-1000);
    });
    
    try {
      const result = await invoke<SyncResult>("apply_profile_and_sync", {
        repoRoot: config.repo_root,
        profile: currentProfile,
        selectedAgents: selectedAgents,
      });
      setConfig((prev) => ({ ...prev, linked_agents: selectedAgents }));
      setLogs((prev) => {
        const newLogs = [
          ...prev, 
          ...result.log.split("\n").filter(Boolean),
          result.has_errors ? "同步完成（有警告）" : "同步完成"
        ];
        return newLogs.slice(-1000); // 截断防止 UI 卡死
      });
      showToast(result.has_errors ? "同步完成（有警告）" : "同步成功", result.has_errors ? 'error' : 'success');
      loadContent();
    } catch (e) {
      console.error("apply_profile_and_sync:", e);
      showToast(`同步失败: ${e}`, 'error');
      setLogs((prev) => {
        const newLogs = [...prev, `[错误] ${e}`];
        return newLogs.slice(-1000);
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const res = await fetch("https://api.github.com/repos/Dev-Wiki/AIWorkspace/releases/latest");
      const data = await res.json();
      if (!data.tag_name) throw new Error("Invalid response");
      const latest = data.tag_name;
      const current = appVersion.startsWith("v") ? appVersion : `v${appVersion}`;
      const latestFormatted = latest.startsWith("v") ? latest : `v${latest}`;
      
      if (latestFormatted !== current) {
        setConfirmModal({
          isOpen: true,
          message: `发现新版本 ${latestFormatted} (当前 ${current})，是否前往浏览器下载？`,
          confirmText: "前往下载",
          onConfirm: async () => {
            await openUrl(data.html_url);
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          }
        });
      } else {
        showToast("当前已是最新版本", "success");
      }
    } catch (e) {
      showToast("检查更新失败，请稍后重试", "error");
      setLogs((prev) => {
        const newLogs = [...prev, `[!] 检查更新失败: ${e}`];
        return newLogs.slice(-1000);
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const toggleItem = (name: string) => {
    setCurrentProfile(prev => {
      const list = [...prev[currentType]];
      if (list.includes(name)) {
        list.splice(list.indexOf(name), 1);
      } else {
        list.push(name);
      }
      return { ...prev, name: "Custom", [currentType]: list };
    });
  };

  const selectAll = () => {
    setCurrentProfile(prev => {
      const nextList = [...prev[currentType]];
      for (const item of items) {
        if (searchText === "" || item.name.toLowerCase().includes(searchText.toLowerCase())) {
          if (!nextList.includes(item.name)) nextList.push(item.name);
        }
      }
      return { ...prev, name: "Custom", [currentType]: nextList };
    });
  };

  const deselectAll = () => {
    setCurrentProfile(prev => {
      let nextList = [...prev[currentType]];
      for (const item of items) {
        if (searchText === "" || item.name.toLowerCase().includes(searchText.toLowerCase())) {
          nextList = nextList.filter(n => n !== item.name);
        }
      }
      return { ...prev, name: "Custom", [currentType]: nextList };
    });
  };

  const filteredItems = useMemo(() => {
    if (!searchText) return items;
    const q = searchText.toLowerCase();
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, searchText]);

  const linkedCount = Object.values(agentVars).filter(Boolean).length;

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
        
        {/* Profile Selector */}
        <div className="flex items-center gap-3 bg-[#1E293B]/50 px-3 py-1.5 rounded-lg border border-slate-700/50">
          <span className="text-xs text-slate-400 font-medium">Profile:</span>
          <select 
            value={currentProfile.name}
            onChange={handleSelectProfile}
            className="bg-[#0F172A] border border-slate-700/50 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50"
          >
            <option value="Custom">Custom (未保存)</option>
            {profiles.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-1 border-l border-slate-700/50 pl-2">
            <button
              onClick={() => openSaveProfileModal(false)}
              disabled={currentProfile.name === "Custom"}
              title="保存配置"
              className="p-1 text-slate-400 hover:text-emerald-400 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
            >
              <Save className="w-4 h-4" />
            </button>
            <button
              onClick={() => openSaveProfileModal(true)}
              title="另存为新 Profile"
              className="p-1 text-slate-400 hover:text-emerald-400 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={handleDeleteProfile}
              disabled={currentProfile.name === "Custom"}
              title="删除 Profile"
              className="p-1 text-slate-400 hover:text-rose-400 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
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
                        updateStatus(next, currentProfile);
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
              {filteredItems.map((item) => {
                const isEnabled = currentProfile[currentType].includes(item.name);
                return (
                  <label
                    key={item.name}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#1E293B]/20 hover:bg-[#1E293B]/80 border border-transparent hover:border-slate-700/50 cursor-pointer transition-all active:scale-[0.98] group"
                  >
                    <div className="flex-shrink-0 pt-0.5">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => toggleItem(item.name)}
                        className="w-4 h-4 text-emerald-500 border-slate-600 bg-slate-800 rounded focus:ring-emerald-500/30 focus:ring-2 focus:ring-offset-0 cursor-pointer transition-colors"
                      />
                    </div>
                    <span className="text-xs font-medium text-slate-300 group-hover:text-emerald-400 transition-colors truncate">
                      {item.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </main>
      </div>

      {/* Bottom action bar */}
      <footer className="flex-shrink-0 bg-[#0F172A] border-t border-slate-800/80 px-6 py-3 flex items-center justify-between shadow-sm z-10 relative">
        <div className="text-xs font-medium text-slate-400 flex items-center gap-6">
          {config.repo_root
            ? (
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                  已链接 Agent：{linkedCount}
                </span>
                <span className="flex items-center gap-1.5 border-l border-slate-700 pl-4">
                  <span className="text-emerald-400">{currentProfile[currentType].length} 启用</span>
                  <span className="text-slate-600">/</span>
                  <span className="text-slate-500">{items.length - currentProfile[currentType].length} 禁用</span>
                </span>
              </div>
            )
            : "请先配置仓库路径"}
            
            {/* Version & Update Button */}
            <div className="flex items-center gap-2 border-l border-slate-700 pl-4 ml-2">
              <span className="text-slate-500">v{appVersion}</span>
              <button 
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate}
                className="text-[10px] px-2 py-0.5 rounded bg-[#1E293B] hover:bg-slate-700 text-slate-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCheckingUpdate ? "检查中..." : "检查更新"}
              </button>
            </div>
            
            {/* View Logs Button */}
            <button 
              onClick={() => setShowLogModal(true)} 
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-[#1E293B] text-slate-400 hover:text-emerald-400 transition-colors border border-transparent hover:border-slate-700/50"
            >
              <Terminal className="w-4 h-4" /> 执行日志
            </button>
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

      {/* Modals & Overlays */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-lg shadow-lg border flex items-center gap-2 animate-in slide-in-from-top-4 fade-in duration-300
          ${toast.type === 'success' ? 'bg-emerald-950/90 border-emerald-800 text-emerald-300' :
            toast.type === 'error' ? 'bg-rose-950/90 border-rose-800 text-rose-300' :
            'bg-slate-800/90 border-slate-700 text-slate-300'}`}>
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4" />}
          {toast.type === 'info' && <Info className="w-4 h-4" />}
          <span className="text-sm font-medium">{toast.text}</span>
        </div>
      )}

      {profileModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#0F172A] border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-200">
                {profileModal.isNew ? "另存为新 Profile" : "保存 Profile"}
              </h3>
              <button onClick={() => setProfileModal({...profileModal, isOpen: false})} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <label className="block text-xs font-medium text-slate-400 mb-2">Profile 名称</label>
              <input
                autoFocus
                type="text"
                value={profileModal.inputName}
                onChange={e => setProfileModal({...profileModal, inputName: e.target.value})}
                placeholder="输入名称..."
                className="w-full px-3 py-2 bg-[#1E293B] border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                onKeyDown={e => { if (e.key === 'Enter') confirmSaveProfile(); }}
              />
            </div>
            <div className="px-5 py-4 bg-[#0A0F1C] border-t border-slate-800 flex justify-end gap-3">
              <button onClick={() => setProfileModal({...profileModal, isOpen: false})} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-[#1E293B] transition-colors">
                取消
              </button>
              <button onClick={confirmSaveProfile} disabled={!profileModal.inputName.trim()} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#0F172A] border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-rose-500" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-200 mb-2">确认操作</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{confirmModal.message}</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-[#0A0F1C] border-t border-slate-800 flex justify-end gap-3">
              <button onClick={() => setConfirmModal({...confirmModal, isOpen: false})} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-[#1E293B] transition-colors">
                取消
              </button>
              <button onClick={confirmModal.onConfirm} className="px-4 py-2 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-500 text-white transition-colors">
                {confirmModal.confirmText || "确认"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLogModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-[#0F172A] border border-slate-700/80 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-[#1E293B]/30">
              <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-500" />
                执行日志
              </h3>
              <div className="flex items-center gap-4">
                <button onClick={() => setLogs([])} className="text-xs font-medium text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded bg-[#1E293B]/50 hover:bg-[#1E293B] transition-colors">
                  清空日志
                </button>
                <button onClick={() => setShowLogModal(false)} className="text-slate-400 hover:text-slate-200 transition-colors p-1 bg-transparent hover:bg-slate-800 rounded">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 font-mono text-[13px] leading-relaxed space-y-1.5 select-text bg-[#0A0F1C]">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
                  <Terminal className="w-12 h-12 opacity-30" />
                  <p className="italic">暂无活动记录。</p>
                </div>
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
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
