import React, { useState, useEffect } from "react";
import {
  Plus,
  Sliders,
  AlertCircle,
  FileText,
  RefreshCw,
  Sparkles,
  Trash2,
  Play,
  Save,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings,
  ListPlus,
  PlayCircle,
  ArrowLeft,
  FileSpreadsheet,
  Zap,
} from "lucide-react";
import { defaultTemplates } from "../templates/defaultTemplates";
import type { ScenarioTemplate, ParameterSet, HealerLog } from "../types";
import { TaskExecutionConsole } from "../components/TaskExecutionConsole";
import { getPageContent } from "../api/browserBridge";
import {
  generateTemplateFromDocument,
  loadCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  updateTemplateParameterSets,
} from "../api/templateGenerator";
import { getLlmConfig } from "../api/llmBridge";

// 自动提取并合并步骤中的 {{变量}} 和 {变量} 占位符
function extractVariablesFromSteps(steps: any[], existingVars: any[]): any[] {
  const detectedNames = new Set<string>();
  const doubleBraceRegex = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  const singleBraceRegex = /\{([a-zA-Z0-9_]+)\}/g;

  steps.forEach((s) => {
    let match;
    // 扫描步骤的 description
    doubleBraceRegex.lastIndex = 0;
    while ((match = doubleBraceRegex.exec(s.description)) !== null) {
      detectedNames.add(match[1]);
    }
    if (s.selectorHint) {
      doubleBraceRegex.lastIndex = 0;
      while ((match = doubleBraceRegex.exec(s.selectorHint)) !== null) {
        detectedNames.add(match[1]);
      }
    }

    // 扫描步骤的 description (单括号占位符作为兼容备用)
    singleBraceRegex.lastIndex = 0;
    while ((match = singleBraceRegex.exec(s.description)) !== null) {
      detectedNames.add(match[1]);
    }
    if (s.selectorHint) {
      singleBraceRegex.lastIndex = 0;
      while ((match = singleBraceRegex.exec(s.selectorHint)) !== null) {
        detectedNames.add(match[1]);
      }
    }
  });

  const updatedVars = [...existingVars];
  // 将新识别出来的变量补充至变量数组中
  detectedNames.forEach((name) => {
    if (!updatedVars.some((v) => v.name === name)) {
      updatedVars.push({
        name,
        label: name, // 默认使用变量名作为友好 Label
        type: "text",
        required: true,
        defaultValue: "",
      });
    }
  });

  return updatedVars;
}

export const Templates: React.FC = () => {
  // ─── 页面视图控制 ────────────────────────────────────────────────────────
  const [currentView, setCurrentView] = useState<"list" | "generate" | "configure">("list");

  // ─── 状态管理 ──────────────────────────────────────────────────────────
  const [customTemplates, setCustomTemplates] = useState<ScenarioTemplate[]>(
    [],
  );
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [selectedTemplate, setSelectedTemplate] =
    useState<ScenarioTemplate | null>(null);

  // ─── 从需求文档生成页面（Full-page View）的状态 ────────────────────────────────
  const [docText, setDocText] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [isFetchingPage, setIsFetchingPage] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // 生成出的草稿模板，供用户预览和微调
  const [draftTemplate, setDraftTemplate] = useState<ScenarioTemplate | null>(
    null,
  );
  // 是否正在编辑已存在的模板
  const [isEditingExisting, setIsEditingExisting] = useState(false);

  // ─── 参数配置页面的状态 ──────────────────────────────────────────────────
  const [currentValues, setCurrentValues] = useState<Record<string, string>>(
    {},
  );
  const [newSetName, setNewSetName] = useState("");
  const [selectedSets, setSelectedSets] = useState<Record<string, boolean>>({});

  // 执行状态监控
  const [isRunningTask, setIsRunningTask] = useState(false);
  const [runningSetId, setRunningSetId] = useState<string | null>(null);
  const [runningProgressMsg, setRunningProgressMsg] = useState<string | null>(
    null,
  );

  // ─── Reusable Task Execution Console & Healer states ───
  const [healerLogs, setHealerLogs] = useState<HealerLog[]>([]);
  const [showHealer, setShowHealer] = useState(true);

  // ─── 交互式单步执行相关状态 ──────────────────────────────────────────────
  interface RunningStep {
    order: number;
    action: string;
    description: string;
    status: "pending" | "running" | "success" | "failed";
    error?: string;
    healed?: boolean;
  }
  const [runningStepsList, setRunningStepsList] = useState<RunningStep[]>([]);

  // ─── 初始化加载 ────────────────────────────────────────────────────────
  useEffect(() => {
    setCustomTemplates(loadCustomTemplates());
  }, []);

  // 合并默认模板与自定义模板 (自定义模板可以覆盖同 ID 的默认模板)
  const templates = [
    ...customTemplates,
    ...defaultTemplates.filter(
      (dt) => !customTemplates.some((ct) => ct.id === dt.id),
    ),
  ];

  const categories = [
    { id: "all", label: "全部类型" },
    { id: "login", label: "身份登录" },
    { id: "form", label: "表单填充" },
    { id: "approval", label: "流程审批" },
    { id: "query", label: "查询筛选" },
    { id: "other", label: "其他" },
  ];

  // 过滤模板列表
  const filteredTemplates = templates.filter((t) => {
    const matchesCategory =
      activeCategory === "all" || t.category === activeCategory;
    const matchesSearch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.tags.some((tag) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    return matchesCategory && matchesSearch;
  });

  // ─── 一键抓取当前 CDP 页面文字 (零 Token 消耗) ──────────────────────────────────
  const handleFetchCurrentPage = async () => {
    setIsFetchingPage(true);
    setFetchError(null);
    try {
      // 传递 keyword 过滤，让 Node.js 端按段落过滤，只返回相关内容！
      const result = await getPageContent(keyword);
      setDocText(result.content);
      setDocUrl(result.url);
      if (keyword) {
        setFetchError(
          `💡 已成功抓取并按关键词 "${keyword}" 过滤出 ${result.paragraphCount} 个相关段落`,
        );
      } else {
        setFetchError(null);
      }
    } catch (e: any) {
      setFetchError(`抓取页面内容失败: ${e.message || e}`);
    } finally {
      setIsFetchingPage(false);
    }
  };

  // ─── AI 生成测试模板 ───────────────────────────────────────────────────
  const handleGenerateTemplate = async () => {
    if (!docText.trim()) return;
    setIsGenerating(true);
    setGenError(null);
    setDraftTemplate(null);
    try {
      const template = await generateTemplateFromDocument(docText, {
        targetUrl: docUrl,
        onProgress: (status) => setGenProgress(status),
      });
      setDraftTemplate(template);
    } catch (e: any) {
      setGenError(e.message || String(e));
    } finally {
      setIsGenerating(false);
      setGenProgress(null);
    }
  };

  // 保存生成好的草稿模板
  const handleSaveDraftTemplate = () => {
    if (!draftTemplate) return;

    // 自动扫描步骤，提取所有 {{变量}} / {变量} 并注入 variables 数组中
    const mergedVariables = extractVariablesFromSteps(
      draftTemplate.steps,
      draftTemplate.variables,
    );
    const finalTemplate = {
      ...draftTemplate,
      variables: mergedVariables,
    };

    const updated = saveCustomTemplate(finalTemplate);
    setCustomTemplates(updated);
    setCurrentView("list");
    setDraftTemplate(null);
    setDocText("");
    setDocUrl("");
    setKeyword("");
    setFetchError(null);
  };

  // 删除自定义模板
  const handleDeleteTemplate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("确定要删除该场景模板吗？此操作不可恢复。")) {
      const updated = deleteCustomTemplate(id);
      setCustomTemplates(updated);
      if (selectedTemplate?.id === id) {
        setSelectedTemplate(null);
        setCurrentView("list");
      }
    }
  };

  // ─── 打开参数配置页面 ────────────────────────────────────────────────────
  const openParamDrawer = (template: ScenarioTemplate) => {
    // 动态同步并补充可能出现在步骤中但未显式在 variables 声明的变量
    const synchedVariables = extractVariablesFromSteps(
      template.steps,
      template.variables,
    );
    const synchedTemplate = {
      ...template,
      variables: synchedVariables,
    };

    setSelectedTemplate(synchedTemplate);
    setCurrentView("configure");

    // 初始化当前变量输入值为默认值
    const initVals: Record<string, string> = {};
    synchedVariables.forEach((v) => {
      initVals[v.name] = v.defaultValue || "";
    });
    setCurrentValues(initVals);
    setNewSetName("");
    setSelectedSets({});
    setRunningProgressMsg(null);
    setIsRunningTask(false);
    setRunningSetId(null);
    setRunningStepsList([]);
    setHealerLogs([]);
  };

  // 终止正在运行的 Agent 任务
  const handleTerminate = async () => {
    if (!window.confirm("确定要终止当前正在运行的任务吗？")) return;
    if (isRunningTask) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("browser_terminate_agent");
      } catch (e) {
        console.error("Failed to terminate sidecar process:", e);
      }
    }
  };

  // 添加一个新的参数集
  const handleAddParameterSet = () => {
    if (!selectedTemplate || !newSetName.trim()) return;

    const newSet: ParameterSet = {
      id: `ps_${Date.now()}`,
      name: newSetName.trim(),
      values: { ...currentValues },
    };

    const updater = (all: ScenarioTemplate[]) => {
      return all.map((t) => {
        if (t.id === selectedTemplate.id) {
          const sets = t.parameterSets || [];
          return { ...t, parameterSets: [...sets, newSet] };
        }
        return t;
      });
    };

    // 更新本地与内存状态
    let nextTemplates: ScenarioTemplate[];
    if (customTemplates.some((t) => t.id === selectedTemplate.id)) {
      nextTemplates = updateTemplateParameterSets(selectedTemplate.id, updater);
      setCustomTemplates(nextTemplates);
    } else {
      const customTpl = {
        ...selectedTemplate,
        parameterSets: [...(selectedTemplate.parameterSets || []), newSet],
      };
      nextTemplates = saveCustomTemplate(customTpl);
      setCustomTemplates(nextTemplates);
    }

    // 重新拉取选中模板更新UI
    const fresh = nextTemplates.find((t) => t.id === selectedTemplate.id);
    if (fresh) setSelectedTemplate(fresh);

    setNewSetName("");
  };

  // 删除一个参数集
  const handleDeleteParameterSet = (setId: string) => {
    if (!selectedTemplate) return;

    const updater = (all: ScenarioTemplate[]) => {
      return all.map((t) => {
        if (t.id === selectedTemplate.id) {
          const sets = (t.parameterSets || []).filter((s) => s.id !== setId);
          return { ...t, parameterSets: sets };
        }
        return t;
      });
    };

    let nextTemplates: ScenarioTemplate[];
    if (customTemplates.some((t) => t.id === selectedTemplate.id)) {
      nextTemplates = updateTemplateParameterSets(selectedTemplate.id, updater);
      setCustomTemplates(nextTemplates);
    } else {
      const customTpl = {
        ...selectedTemplate,
        parameterSets: (selectedTemplate.parameterSets || []).filter(
          (s) => s.id !== setId,
        ),
      };
      nextTemplates = saveCustomTemplate(customTpl);
      setCustomTemplates(nextTemplates);
    }

    const fresh = nextTemplates.find((t) => t.id === selectedTemplate.id);
    if (fresh) setSelectedTemplate(fresh);
  };

  const saveReport = async (
    testName: string,
    task: string,
    testStatus: "success" | "failed",
    stepsTotal: number,
    stepsSuccess: number,
    reportMarkdown: string,
    startTime: number
  ) => {
    const duration = Math.round((Date.now() - startTime) / 1000);
    const newId = `res_${Math.floor(100 + Math.random() * 900)}`;
    const newReport = {
      id: newId,
      testName,
      testStatus,
      task,
      createdAt: new Date(startTime).toISOString().replace("T", " ").substring(0, 19),
      completedAt: new Date().toISOString().replace("T", " ").substring(0, 19),
      stepsTotal,
      stepsSuccess,
      reportMarkdown,
      duration,
    };

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      let existingReports: any[] = [];
      try {
        const raw = await invoke<string>("load_reports_from_file");
        if (raw) existingReports = JSON.parse(raw);
      } catch (e) {
        const localRaw = localStorage.getItem("logicguard_test_results");
        if (localRaw) existingReports = JSON.parse(localRaw);
      }

      const updated = [newReport, ...existingReports];
      try {
        await invoke("save_reports_to_file", { data: JSON.stringify(updated) });
      } catch (e) {
        localStorage.setItem("logicguard_test_results", JSON.stringify(updated));
      }
    } catch (err) {
      console.error("Failed to save report:", err);
      try {
        let existingReports: any[] = [];
        const localRaw = localStorage.getItem("logicguard_test_results");
        if (localRaw) existingReports = JSON.parse(localRaw);
        const updated = [newReport, ...existingReports];
        localStorage.setItem("logicguard_test_results", JSON.stringify(updated));
      } catch (innerErr) {}
    }
  };

  // ─── 执行单个测试参数集 ────────────────────────────────────────────────
  const runParameterSet = async (
    paramValues: Record<string, string>,
    name: string,
    setId?: string,
  ) => {
    if (!selectedTemplate) return;

    setIsRunningTask(true);
    setHealerLogs([]);
    if (setId) setRunningSetId(setId);
    setRunningProgressMsg("🚀 正在启动 Stagehand 闭环自主 Agent...");

    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    const config = getLlmConfig();

    let success = false;
    const startTime = Date.now();
    const localLogs: HealerLog[] = [];

    const appendHealerLog = (log: Omit<HealerLog, "timestamp">) => {
      const fullLog = {
        timestamp: new Date().toLocaleTimeString(),
        ...log,
      };
      localLogs.push(fullLog);
      setHealerLogs((prev) => [...prev, fullLog]);
    };

    // 预渲染步骤列表以便 UI 展示
    const initialSteps: RunningStep[] = selectedTemplate.steps.map((s) => {
      let desc = s.description;
      Object.entries(paramValues).forEach(([k, v]) => {
        desc = desc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
        desc = desc.replace(new RegExp(`\\{${k}\\}`, "g"), v);
      });
      return {
        order: s.order,
        action: s.action,
        description: desc,
        status: "pending",
        healed: false,
        error: undefined,
      };
    });

    const localSteps = initialSteps.map((s) => ({ ...s }));
    if (localSteps.length > 0) {
      localSteps[0].status = "running";
    }
    setRunningStepsList([...localSteps]);

    let unlistenFn: (() => void) | null = null;
    let prompt = `目标URL: ${selectedTemplate.targetUrl || ""}\n`;
    prompt += `执行测试场景: "${selectedTemplate.name} - ${name}"，请依次按顺序在当前浏览器页面完成交互动作：\n`;
    selectedTemplate.steps.forEach((step, idx) => {
      let desc = step.description;
      Object.entries(paramValues).forEach(([k, v]) => {
        desc = desc.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
        desc = desc.replace(new RegExp(`\\{${k}\\}`, "g"), v);
      });
      prompt += `${idx + 1}. [${step.action.toUpperCase()}] ${desc}`;
      if (step.selectorHint) {
        let hint = step.selectorHint;
        Object.entries(paramValues).forEach(([k, v]) => {
          hint = hint.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v);
          hint = hint.replace(new RegExp(`\\{${k}\\}`, "g"), v);
        });
        prompt += ` (操作目标提示: ${hint})`;
      }
      prompt += "\n";
    });
    prompt += `\n关键交互输入参数：\n`;
    Object.entries(paramValues).forEach(([k, v]) => {
      prompt += `- ${k}: "${v}"\n`;
    });

    let currentStepIdx = 0;

    try {
      unlistenFn = await listen<{
        type: string;
        description: string;
        detail: string | null;
        timestamp: string;
      }>("stagehand-agent-step", (event) => {
        const { type, description } = event.payload;
        let strategy: HealerLog["strategy"] = "retry";
        let emoji = "🤖";

        if (type === "thinking") {
          strategy = "ai_diagnose";
          emoji = "🧠";
        } else if (type === "done") {
          strategy = "re_perceive";
          emoji = "✅";
        } else if (type === "error") {
          strategy = "abort";
          emoji = "❌";
        }

        appendHealerLog({
          stepId: Math.min(currentStepIdx + 1, localSteps.length || 1),
          strategy,
          message: `${emoji} ${description}`,
          resolved: type === "done",
        });

        if (type === "action") {
          if (currentStepIdx < localSteps.length) {
            localSteps[currentStepIdx].status = "success";
            localSteps[currentStepIdx].description = `${localSteps[currentStepIdx].description} (${description})`;
            currentStepIdx++;
            if (currentStepIdx < localSteps.length) {
              localSteps[currentStepIdx].status = "running";
            }
            setRunningStepsList([...localSteps]);
          } else {
            localSteps.push({
              order: localSteps.length + 1,
              action: "agent",
              description: description,
              status: "success",
              healed: false,
              error: undefined,
            });
            setRunningStepsList([...localSteps]);
          }
        } else if (type === "error") {
          if (currentStepIdx < localSteps.length) {
            localSteps[currentStepIdx].status = "failed";
            localSteps[currentStepIdx].error = description;
            setRunningStepsList([...localSteps]);
          }
        } else if (type === "done") {
          for (let k = currentStepIdx; k < localSteps.length; k++) {
            localSteps[k].status = "success";
          }
          setRunningStepsList([...localSteps]);
        }
      });

      setRunningProgressMsg("🤖 Agent 已启动，正在操控 Chrome 执行操作...");

      await invoke("browser_run_agent", {
        instruction: prompt,
        port: 9222,
        config,
      });

      success = true;
    } catch (e: any) {
      success = false;
      const errMsg = e?.message || String(e);
      appendHealerLog({
        stepId: Math.min(currentStepIdx + 1, localSteps.length || 1),
        strategy: "abort",
        message: `❌ 执行中断: ${errMsg}`,
        resolved: false,
      });
      if (currentStepIdx < localSteps.length) {
        localSteps[currentStepIdx].status = "failed";
        localSteps[currentStepIdx].error = errMsg;
      }
      setRunningStepsList([...localSteps]);
    } finally {
      if (unlistenFn) unlistenFn();
      setIsRunningTask(false);
      setRunningProgressMsg(null);
      setRunningSetId(null);

      // 生成并保存测试报告
      const successCount = localSteps.filter((s) => s.status === "success").length;
      let md = `### ${success ? "🏆" : "🔴"} Stagehand 智能 Agent 测试报告\n\n`;
      md += `- **模板名称**: ${selectedTemplate.name}\n`;
      md += `- **测试参数集**: ${name}\n`;
      md += `- **测试状态**: ${success ? "✅ 成功" : "❌ 失败"}\n`;
      md += `- **运行模式**: Stagehand 闭环自主 Agent + 步骤映射\n`;
      md += `- **测试耗时**: ${Math.round((Date.now() - startTime) / 1000)} 秒\n\n`;
      md += `#### 📝 步骤执行轨迹 (${successCount}/${localSteps.length}):\n`;
      md += localSteps
        .map(
          (s, idx) => {
            let line = `${idx + 1}. [${s.status.toUpperCase()}] ${s.description}`;
            if (s.error) line += `\n   - 错误: ${s.error}`;
            return line;
          }
        )
        .join("\n") + "\n\n";
      md += `#### 🚑 Healer 诊断自愈控制台日志:\n`;
      md += localLogs
        .map((log) => `- [${log.timestamp}] ${log.message}`)
        .join("\n");

      saveReport(
        `场景模板 Agent 测试: ${selectedTemplate.name}`,
        `测试参数集: ${name}`,
        success ? "success" : "failed",
        localSteps.length || 1,
        successCount,
        md,
        startTime
      );
    }

    // 回写状态到 LocalStorage/内存
    if (setId) {
      const updater = (all: ScenarioTemplate[]) => {
        return all.map((t) => {
          if (t.id === selectedTemplate.id) {
            const sets = (t.parameterSets || []).map((s) => {
              if (s.id === setId) {
                return {
                  ...s,
                  lastRunStatus: (success ? "success" : "failed") as any,
                  lastRunAt: new Date().toISOString(),
                };
              }
              return s;
            });
            return { ...t, parameterSets: sets };
          }
          return t;
        });
      };

      let nextTemplates: ScenarioTemplate[];
      if (customTemplates.some((t) => t.id === selectedTemplate.id)) {
        nextTemplates = updateTemplateParameterSets(
          selectedTemplate.id,
          updater,
        );
        setCustomTemplates(nextTemplates);
      } else {
        const customTpl = {
          ...selectedTemplate,
          parameterSets: (selectedTemplate.parameterSets || []).map((s) => {
            if (s.id === setId) {
              return {
                ...s,
                lastRunStatus: (success ? "success" : "failed") as any,
                lastRunAt: new Date().toISOString(),
              };
            }
            return s;
          }),
        };
        nextTemplates = saveCustomTemplate(customTpl);
        setCustomTemplates(nextTemplates);
      }

      const fresh = nextTemplates.find((t) => t.id === selectedTemplate.id);
      if (fresh) setSelectedTemplate(fresh);
    }
  };

  // 批量运行选中的参数集
  const runSelectedParameterSets = async () => {
    if (!selectedTemplate) return;
    const sets = selectedTemplate.parameterSets || [];
    const selectedList = sets.filter((s) => selectedSets[s.id]);

    if (selectedList.length === 0) {
      alert("请先勾选需要批量执行的参数集！");
      return;
    }

    for (const set of selectedList) {
      await runParameterSet(set.values, set.name, set.id);
    }
  };

  // ─── 渲染：列表视图 ──────────────────────────────────────────────────────
  if (currentView === "list") {
    return (
      <div className="flex-1 flex flex-col h-full bg-transparent overflow-y-auto p-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-text-primary">
              场景模板配置 (Seed Files)
            </h2>
            <p className="text-xs text-text-muted">
              预置及自定义需求场景模板，支持全屏分析内网需求文档自动建置用例步骤
            </p>
          </div>
          <button
            onClick={() => {
              setDraftTemplate(null);
              setIsEditingExisting(false);
              setDocText("");
              setDocUrl("");
              setKeyword("");
              setFetchError(null);
              setGenError(null);
              setCurrentView("generate");
            }}
            className="h-9 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold flex items-center gap-2 transition-all duration-200 glow"
          >
            <Sparkles className="w-4 h-4" /> 📄 从需求文档生成
          </button>
        </div>

        {/* 过滤栏 */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-surface-1 p-4 rounded-xl border border-border">
          <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-lg border border-border w-full sm:w-auto">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${
                  activeCategory === c.id
                    ? "bg-surface-0 text-text-primary shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-80">
            <input
              type="text"
              placeholder="搜索模板名称、描述或标签..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-2 border border-border focus:border-brand-500 text-xs text-text-primary outline-none transition-all duration-200"
            />
            <Plus className="w-3.5 h-3.5 text-text-muted absolute left-3 top-2.5 rotate-45" />
          </div>
        </div>

        {/* 模板卡片列表 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((t) => {
            const isCustom = customTemplates.some((ct) => ct.id === t.id);
            return (
              <div
                key={t.id}
                className="p-5 rounded-xl border border-border bg-surface-1/70 flex flex-col justify-between hover:border-brand-500/30 transition-all duration-200 glow relative group"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                        t.category === "login"
                          ? "bg-info/10 text-info"
                          : t.category === "form"
                            ? "bg-brand-500/15 text-brand-400"
                            : t.category === "approval"
                              ? "bg-success/15 text-success"
                              : t.category === "query"
                                ? "bg-warning/10 text-warning"
                                : "bg-text-muted/10 text-text-secondary"
                      }`}
                    >
                      {t.category === "login"
                        ? "IDENTITY LOGIN"
                        : t.category === "form"
                          ? "FORM FILL"
                          : t.category === "approval"
                            ? "APPROVAL FLOW"
                            : t.category === "query"
                              ? "QUERY FILTER"
                              : "OTHER"}
                    </span>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-muted font-mono">
                        #{t.id}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                      {t.name}
                      {isCustom && (
                        <span className="text-[9px] bg-brand-500/20 text-brand-300 px-1.5 py-0.2 rounded font-medium">
                          自定义
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-text-secondary mt-1.5 leading-relaxed min-h-[36px]">
                      {t.description}
                    </p>
                  </div>

                  <div className="space-y-1.5 bg-surface-0/60 p-3 rounded-lg border border-border">
                    <span className="text-[9px] text-text-muted font-mono font-semibold uppercase block mb-1">
                      参考操作流 ({t.steps.length} 步)
                    </span>
                    {t.steps.slice(0, 3).map((step, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-[10px] text-text-secondary truncate"
                      >
                        <span className="w-4 h-4 rounded-full bg-surface-3 flex items-center justify-center text-[8px] font-bold shrink-0">
                          {step.order}
                        </span>
                        <span className="font-semibold text-brand-400 capitalize shrink-0 font-mono">
                          [{step.action}]
                        </span>
                        <span className="truncate text-text-muted">
                          {step.description}
                        </span>
                      </div>
                    ))}
                    {t.steps.length > 3 && (
                      <span className="text-[9px] text-text-muted block text-right pt-0.5">
                        ...以及另外 {t.steps.length - 3} 步
                      </span>
                    )}
                  </div>

                  {t.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center">
                      <span className="text-[9px] text-text-muted mr-1">
                        模板变量:
                      </span>
                      {t.variables.map((v, idx) => (
                        <span
                          key={idx}
                          className="text-[9px] bg-surface-3 text-text-muted px-1.5 py-0.2 rounded font-mono"
                        >
                          {v.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-4 mt-4 border-t border-border flex flex-col gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    {t.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="text-[9px] bg-surface-2 text-text-secondary px-2 py-0.5 rounded border border-border/80"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => openParamDrawer(t)}
                      className="flex-1 h-8 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border hover:border-border-hover text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200"
                    >
                      <Sliders className="w-3.5 h-3.5 text-text-muted" />{" "}
                      配置参数 & 运行
                    </button>
                    <button
                      onClick={() => {
                        setDraftTemplate(JSON.parse(JSON.stringify(t)));
                        setIsEditingExisting(true);
                        setCurrentView("generate");
                      }}
                      className="h-8 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border hover:border-border-hover text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200"
                      title="编辑模板步骤与变量"
                    >
                      <Settings className="w-3.5 h-3.5 text-text-muted" />{" "}
                      编辑步骤
                    </button>
                    {isCustom && (
                      <button
                        onClick={(e) => handleDeleteTemplate(t.id, e)}
                        className="h-8 px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 text-red-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200"
                        title="删除此自定义模板"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>删除</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {filteredTemplates.length === 0 && (
            <div className="col-span-full py-16 text-center text-text-muted space-y-2">
              <AlertCircle className="w-8 h-8 mx-auto text-surface-4" />
              <p className="text-xs">无符合条件的场景模板</p>
            </div>
          )}
        </div>

        {/* ─── 参数集配置抽屉（保留，因为配置少量参数很适合用抽屉展示） ─── */}
      </div>
    );
  }

  // ─── 渲染：参数变量配置与运行页面 (Integrated Full-Page View) ───────────────────
  if (currentView === "configure" && selectedTemplate) {
    return (
      <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-surface-0 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setCurrentView("list");
                setSelectedTemplate(null);
              }}
              className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-all duration-200"
              title="返回模板列表"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-border"></div>
            <div>
              <h2 className="text-sm font-bold text-text-primary flex items-center gap-2">
                <span>配置模板参数 & 测试运行</span>
                <span className="text-[10px] bg-brand-500/20 text-brand-300 px-1.5 py-0.5 rounded font-mono font-medium">
                  {selectedTemplate.name}
                </span>
              </h2>
            </div>
          </div>
        </div>

        {/* Main Area: Split Layout */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 min-w-0">
          {/* Left Side: Parameters Setup (width: 380px) */}
          <div className="w-full lg:w-[380px] shrink-0 flex flex-col h-full overflow-y-auto p-6 space-y-6 bg-surface-0 border-r border-border">
            {/* Setup Variable Form */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-brand-400" />
                <span>配置当前运行参数</span>
              </h3>

              {selectedTemplate.variables.length === 0 ? (
                <div className="text-[11px] text-text-muted bg-surface-1 p-3 rounded-lg border border-border">
                  该模板无变量参数。
                </div>
              ) : (
                <div className="bg-surface-1 p-4 rounded-xl border border-border space-y-3">
                  {selectedTemplate.variables.map((v) => (
                    <div key={v.name} className="space-y-1">
                      <label className="text-[11px] font-semibold text-text-secondary flex items-center gap-1">
                        <span>{v.label}</span>
                        <span className="text-[9px] text-text-muted font-mono">
                          ({v.name})
                        </span>
                        {v.required && (
                          <span className="text-red-400 text-xs">*</span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={currentValues[v.name] || ""}
                        onChange={(e) =>
                          setCurrentValues({
                            ...currentValues,
                            [v.name]: e.target.value,
                          })
                        }
                        className="w-full h-8 px-3 rounded bg-surface-2 border border-border text-xs text-text-primary focus:border-brand-500 outline-none"
                        placeholder={v.defaultValue || `请输入 ${v.label}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Save as Reusable parameter set */}
            <div className="bg-surface-1 p-4 rounded-xl border border-border space-y-3">
              <h3 className="text-xs font-bold text-text-primary">
                保存为复用参数集
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSetName}
                  onChange={(e) => setNewSetName(e.target.value)}
                  placeholder="例如: '开发环境管理员账号测试'"
                  className="flex-1 h-8 px-3 rounded bg-surface-2 border border-border text-xs text-text-primary focus:border-brand-500 outline-none"
                />
                <button
                  onClick={handleAddParameterSet}
                  disabled={!newSetName.trim()}
                  className="h-8 px-3 bg-brand-500 hover:bg-brand-600 disabled:bg-surface-3 text-white text-xs font-semibold rounded flex items-center gap-1 transition-all"
                >
                  <ListPlus className="w-3.5 h-3.5" /> 保存
                </button>
              </div>
            </div>

            {/* Saved Parameter Sets List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-text-primary">
                  已保存的参数集 ({selectedTemplate.parameterSets?.length || 0})
                </h3>
                {selectedTemplate.parameterSets &&
                  selectedTemplate.parameterSets.length > 0 && (
                    <button
                      onClick={runSelectedParameterSets}
                      disabled={
                        isRunningTask ||
                        Object.values(selectedSets).filter(Boolean).length === 0
                      }
                      className="h-7 px-2.5 bg-brand-500 hover:bg-brand-600 disabled:bg-surface-3 text-white text-[10px] font-bold rounded flex items-center gap-1 transition-all glow"
                    >
                      <PlayCircle className="w-3.5 h-3.5" /> 批量运行 ({Object.values(selectedSets).filter(Boolean).length})
                    </button>
                  )}
              </div>

              {!selectedTemplate.parameterSets ||
              selectedTemplate.parameterSets.length === 0 ? (
                <div className="text-[11px] text-text-muted bg-surface-1 p-3 rounded-lg border border-border text-center">
                  暂未配置参数集
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {selectedTemplate.parameterSets.map((set) => {
                    const isSelected = !!selectedSets[set.id];
                    const isThisRunning = runningSetId === set.id;
                    return (
                      <div
                        key={set.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border bg-surface-1 hover:border-brand-500/20 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) =>
                              setSelectedSets({
                                ...selectedSets,
                                [set.id]: e.target.checked,
                              })
                            }
                            className="rounded border-border bg-surface-2 text-brand-500 focus:ring-brand-500"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-text-primary">
                                {set.name}
                              </span>
                              {set.lastRunStatus && (
                                <span
                                  className={`text-[8px] px-1 py-0.2 rounded font-mono font-medium ${
                                    set.lastRunStatus === "success"
                                      ? "bg-success/20 text-success"
                                      : "bg-red-500/20 text-red-300"
                                  }`}
                                >
                                  {set.lastRunStatus === "success"
                                    ? "SUCCESS"
                                    : "FAILED"}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2 text-[9px] text-text-muted font-mono mt-1">
                              {Object.entries(set.values).map(([k, v]) => (
                                <span key={k}>
                                  {k}={v}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              runParameterSet(set.values, set.name, set.id)
                            }
                            disabled={isRunningTask}
                            className="h-7 px-2.5 bg-surface-2 hover:bg-surface-3 border border-border text-[10px] font-bold text-text-primary rounded flex items-center gap-1 transition-all"
                          >
                            {isThisRunning ? (
                              <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
                            ) : (
                              <Play className="w-3 h-3 text-text-muted" />
                            )}
                            运行
                          </button>
                          <button
                            onClick={() => handleDeleteParameterSet(set.id)}
                            disabled={isRunningTask}
                            className="p-1.5 text-text-muted hover:text-red-400 rounded hover:bg-surface-2 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Execute Button */}
            <div className="pt-4 border-t border-border flex flex-col gap-2">
              <button
                onClick={() => runParameterSet(currentValues, "当前临时参数")}
                disabled={isRunningTask}
                className="w-full h-10 bg-brand-500 hover:bg-brand-600 disabled:bg-surface-3 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all glow"
              >
                <Zap className="w-3.5 h-3.5" /> 开始 AI 智能执行
              </button>
            </div>
          </div>

          {/* Right Side: Execution Console */}
          <div className="flex-1 h-full overflow-hidden p-4 bg-surface-1 flex flex-col">
            {runningStepsList.length > 0 || isRunningTask ? (
              <TaskExecutionConsole
                steps={runningStepsList.map((s, idx) => ({
                  stepId: s.order || idx + 1,
                  action: s.action,
                  description: s.description,
                  status: s.status,
                  error: s.error,
                  healed: s.healed,
                }))}
                healerLogs={healerLogs}
                runningProgressMsg={runningProgressMsg}
                isRunning={isRunningTask}
                onTerminate={handleTerminate}
                showHealer={showHealer}
                setShowHealer={setShowHealer}
                isModalMode={false}
                title={`模板测试运行: ${selectedTemplate.name}`}
                subtitle="Stagehand AI 闭环执行 · Healer 自动诊断自愈"
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-surface-0 rounded-xl border border-border/80 shadow-inner space-y-3 animate-fade-in">
                <div className="w-12 h-12 rounded-full bg-brand-500/10 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-brand-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-text-primary">等待测试执行</h4>
                  <p className="text-xs text-text-muted mt-1 max-w-sm">
                    配置左侧的模板变量参数值，点击下方“开始 AI 智能执行”或使用已保存参数集，即可在此实时查看浏览器执行轨迹和 Healer 自愈报告。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── 渲染：独立的“从需求文档生成测试模板”全屏编辑页面 ─────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full bg-surface-0 overflow-hidden animate-fade-in">
      {/* Page Header */}
      <div className="h-14 px-6 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setCurrentView("list");
              setDraftTemplate(null);
            }}
            className="p-1.5 rounded-lg hover:bg-surface-2 border border-border hover:border-border-hover text-text-secondary hover:text-text-primary transition-all duration-200"
            title="返回模板列表"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-4 w-px bg-border"></div>
          <div className="flex items-center gap-2">
            {isEditingExisting ? (
              <Settings className="w-4 h-4 text-brand-400" />
            ) : (
              <Sparkles className="w-4 h-4 text-brand-400" />
            )}
            <span className="text-sm font-bold text-text-primary">
              {isEditingExisting
                ? `编辑测试模板: ${draftTemplate?.name}`
                : "从需求文档智能提取生成自动化测试用例"}
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            setCurrentView("list");
            setDraftTemplate(null);
          }}
          className="text-xs text-text-secondary hover:text-text-primary font-medium"
        >
          返回列表
        </button>
      </div>

      {/* 两栏/全宽式布局 */}
      <div className="flex-1 flex p-6 gap-6 overflow-hidden min-h-0 min-w-0">
        {/* 左栏：需求正文输入区（仅在非编辑已有模板模式下展示） */}
        {!isEditingExisting && (
          <div className="w-1/2 flex flex-col h-full bg-surface-1 rounded-xl border border-border p-5 space-y-4 min-w-0">
            <div className="flex items-center justify-between shrink-0">
              <h3 className="text-xs font-bold text-text-primary flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-400" />
                <span>1. 需求正文内容来源</span>
              </h3>
              <span className="text-[10px] text-text-muted font-mono bg-surface-2 px-2 py-0.5 rounded border border-border">
                {docText.length} / 20000 字符
              </span>
            </div>

            {/* 预过滤配置与抓取面板 */}
            <div className="p-4 bg-surface-2 rounded-lg border border-border space-y-3 shrink-0">
              <div className="flex flex-col space-y-1.5">
                <label className="text-[11px] font-bold text-text-secondary">
                  目标测试板块的关键词段落过滤 (强烈建议)
                </label>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="例如: '请假申请', '规则配置', '提交列表' (将自动提取相关段落，显著节省 Token 并提高精准度)"
                  className="w-full h-8 px-3 rounded bg-surface-0 border border-border text-xs text-text-primary focus:border-brand-500 outline-none transition-all"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  onClick={handleFetchCurrentPage}
                  disabled={isFetchingPage}
                  className="h-8 px-4 bg-surface-0 hover:bg-surface-3 border border-border text-xs font-semibold text-text-primary rounded flex items-center gap-2 transition-all shrink-0 hover:border-brand-500/20 hover:text-brand-400"
                >
                  {isFetchingPage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 text-text-muted" />
                  )}
                  一键抓取托管 Chrome 活跃网页
                </button>

                <span
                  className="text-[10px] text-text-muted truncate max-w-[200px] font-mono text-right"
                  title={docUrl}
                >
                  {docUrl ? `URL: ${docUrl}` : "未关联网页"}
                </span>
              </div>

              <div className="pt-2 border-t border-border/50 text-[10px] text-text-muted leading-relaxed space-y-1">
                <p>
                  💡 <b>提示</b>
                  ：如遇网页由于动态渲染导致抓取不全，您可以在文档页面中直接{" "}
                  <b>Ctrl+A 全选并复制 (Ctrl+C)</b>
                  ，然后粘贴到下方文本框中即可。
                </p>
              </div>
            </div>

            {/* 抓取/过滤的辅助反馈 */}
            {fetchError && (
              <div className="p-3 bg-brand-500/5 border border-brand-500/10 text-brand-400 text-[11px] rounded-lg leading-relaxed flex items-start gap-2 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-brand-400" />
                <span>{fetchError}</span>
              </div>
            )}

            {/* 巨大且宽敞的文本正文编辑区域 */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
              <textarea
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                placeholder="请在此输入、粘贴需求规格说明书文本，或者直接点击上方按钮从托管浏览器抓取内容进行分析。您可以在这里编辑、删除多余的内容..."
                className="w-full flex-1 p-4 rounded-lg bg-surface-2 border border-border text-xs text-text-primary focus:border-brand-500 outline-none resize-none font-sans leading-relaxed min-h-0"
              />
            </div>

            {/* 触发 AI 分析按钮 */}
            <div className="flex justify-end shrink-0 pt-2 border-t border-border">
              <button
                onClick={handleGenerateTemplate}
                disabled={isGenerating || !docText.trim()}
                className="h-10 px-6 bg-brand-500 hover:bg-brand-600 disabled:bg-surface-3 text-white text-xs font-semibold rounded-lg flex items-center gap-2 transition-all glow"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{genProgress || "AI 正在解析页面数据中..."}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>2. 🧠 AI 智能解析需求并建模</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* 右栏/主栏：AI 解析与测试用例编辑器 */}
        <div
          className={`${isEditingExisting ? "w-full" : "w-1/2"} flex flex-col h-full bg-surface-1 rounded-xl border border-border p-5 min-w-0`}
        >
          {/* 未生成状态 */}
          {!draftTemplate && !isGenerating && !genError && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
              <div className="w-12 h-12 rounded-full bg-surface-2 border border-border flex items-center justify-center text-text-muted">
                <FileSpreadsheet className="w-6 h-6 text-text-muted" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-text-primary">
                  暂无用例草稿
                </h4>
                <p className="text-[11px] text-text-secondary max-w-xs mt-1.5 leading-relaxed">
                  请在左侧获取或填入需求文档文本，然后点击按钮触发 AI 解析。 AI
                  将根据文档为您提炼测试步骤和需要填充的测试参数。
                </p>
              </div>
            </div>
          )}

          {/* 生成中状态 */}
          {isGenerating && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
              <div>
                <h4 className="text-xs font-bold text-text-primary">
                  {genProgress || "AI 正在对需求建模中..."}
                </h4>
                <p className="text-[10px] text-text-secondary mt-1 max-w-xs leading-relaxed">
                  大模型正在为您提取测试场景流。这通常需要 10-20
                  秒，请耐心等待。
                </p>
              </div>
            </div>
          )}

          {/* 生成失败 */}
          {genError && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
              <XCircle className="w-8 h-8 text-red-400" />
              <div>
                <h4 className="text-xs font-bold text-red-400">建模失败</h4>
                <p className="text-[11px] text-text-secondary mt-1.5 max-w-xs leading-relaxed">
                  解析过程中遇到了问题：{genError}。请检查您的 API Key
                  或减小左侧文本的正文长度后重试。
                </p>
              </div>
            </div>
          )}

          {/* 生成成功：显示编辑器 */}
          {draftTemplate && !isGenerating && (
            <div className="flex-1 flex flex-col h-full min-h-0 min-w-0">
              <div className="flex items-center gap-1.5 shrink-0 pb-3 border-b border-border mb-4">
                <CheckCircle2 className="w-4 h-4 text-success" />
                <h4 className="text-xs font-bold text-text-primary">
                  用例建模编辑面板 (AI 识别草稿)
                </h4>
              </div>

              {/* 滚动编辑区 */}
              <div className="flex-1 overflow-y-auto space-y-5 pr-1 min-w-0 min-h-0">
                {/* 1. 基本信息 */}
                <div className="bg-surface-2 p-4 rounded-lg border border-border space-y-3">
                  <h5 className="text-[11px] font-bold text-text-primary uppercase tracking-wider">
                    基本配置
                  </h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-text-secondary font-bold">
                        模板名称
                      </label>
                      <input
                        type="text"
                        value={draftTemplate.name}
                        onChange={(e) =>
                          setDraftTemplate({
                            ...draftTemplate,
                            name: e.target.value,
                          })
                        }
                        className="w-full h-8 px-2.5 rounded bg-surface-0 border border-border text-xs text-text-primary focus:border-brand-500 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-text-secondary font-bold">
                        用例类型
                      </label>
                      <select
                        value={draftTemplate.category}
                        onChange={(e) =>
                          setDraftTemplate({
                            ...draftTemplate,
                            category: e.target.value as any,
                          })
                        }
                        className="w-full h-8 px-2.5 rounded bg-surface-0 border border-border text-xs text-text-primary focus:border-brand-500 outline-none"
                      >
                        <option value="login">身份登录 (login)</option>
                        <option value="form">表单填充 (form)</option>
                        <option value="approval">流程审批 (approval)</option>
                        <option value="query">查询筛选 (query)</option>
                        <option value="other">其他 (other)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-text-secondary font-bold">
                      业务场景描述
                    </label>
                    <input
                      type="text"
                      value={draftTemplate.description}
                      onChange={(e) =>
                        setDraftTemplate({
                          ...draftTemplate,
                          description: e.target.value,
                        })
                      }
                      className="w-full h-8 px-2.5 rounded bg-surface-0 border border-border text-xs text-text-primary focus:border-brand-500 outline-none"
                    />
                  </div>
                </div>

                {/* 2. 用例步骤流 */}
                <div className="space-y-2.5">
                  <h5 className="text-[11px] font-bold text-text-primary uppercase tracking-wider flex items-center justify-between">
                    <span>测试执行步骤流 ({draftTemplate.steps.length})</span>
                    <span className="text-[9px] text-text-muted lowercase">
                      action / description / targetHint
                    </span>
                  </h5>

                  <div className="space-y-2">
                    {draftTemplate.steps.map((step, idx) => (
                      <div
                        key={idx}
                        className="flex gap-2 items-center bg-surface-2 p-2.5 rounded-lg border border-border group/step"
                      >
                        <span className="w-5 h-5 rounded-full bg-surface-3 flex items-center justify-center text-[9px] font-bold shrink-0">
                          {step.order}
                        </span>
                        <select
                          value={step.action}
                          onChange={(e) => {
                            const steps = [...draftTemplate.steps];
                            steps[idx].action = e.target.value;
                            setDraftTemplate({ ...draftTemplate, steps });
                          }}
                          className="h-7 px-1 rounded bg-surface-0 border border-border text-[10px] text-text-primary outline-none"
                        >
                          <option value="navigate">navigate</option>
                          <option value="click">click</option>
                          <option value="type">type</option>
                          <option value="select">select</option>
                          <option value="assert">assert</option>
                          <option value="wait">wait</option>
                        </select>

                        <input
                          type="text"
                          value={step.description}
                          onChange={(e) => {
                            const steps = [...draftTemplate.steps];
                            steps[idx].description = e.target.value;
                            setDraftTemplate({ ...draftTemplate, steps });
                          }}
                          className="flex-1 h-7 px-2 rounded bg-surface-0 border border-border text-[10px] text-text-primary outline-none"
                          placeholder="操作描述"
                        />

                        <input
                          type="text"
                          value={step.selectorHint || ""}
                          onChange={(e) => {
                            const steps = [...draftTemplate.steps];
                            steps[idx].selectorHint = e.target.value;
                            setDraftTemplate({ ...draftTemplate, steps });
                          }}
                          className="w-28 h-7 px-2 rounded bg-surface-0 border border-border text-[10px] text-text-primary outline-none"
                          placeholder="元素提示 (可选)"
                        />

                        <button
                          onClick={() => {
                            const steps = draftTemplate.steps
                              .filter((_, i) => i !== idx)
                              .map((s, i) => ({ ...s, order: i + 1 }));
                            setDraftTemplate({ ...draftTemplate, steps });
                          }}
                          className="text-text-muted hover:text-red-400 p-1 transition-all opacity-40 group-hover/step:opacity-100"
                          title="删除此步骤"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      const newStep = {
                        order: draftTemplate.steps.length + 1,
                        description: "新步骤",
                        action: "click",
                      };
                      setDraftTemplate({
                        ...draftTemplate,
                        steps: [...draftTemplate.steps, newStep],
                      });
                    }}
                    className="h-8 w-full rounded border border-dashed border-border hover:border-brand-500 text-text-secondary hover:text-text-primary text-[10px] flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> 添加测试步骤
                  </button>
                </div>

                {/* 3. 参数变量设定 */}
                <div className="space-y-2.5">
                  <h5 className="text-[11px] font-bold text-text-primary uppercase tracking-wider flex items-center justify-between">
                    <span>
                      抽离的输入变量 ({draftTemplate.variables.length})
                    </span>
                    <span className="text-[9px] text-text-muted lowercase">
                      variable / label / defaultVal
                    </span>
                  </h5>

                  <div className="space-y-2">
                    {draftTemplate.variables.map((v, idx) => (
                      <div
                        key={idx}
                        className="flex gap-2 items-center bg-surface-2 p-2.5 rounded-lg border border-border group/var"
                      >
                        <input
                          type="text"
                          value={v.name}
                          onChange={(e) => {
                            const variables = [...draftTemplate.variables];
                            variables[idx].name = e.target.value;
                            setDraftTemplate({ ...draftTemplate, variables });
                          }}
                          placeholder="变量名称"
                          className="flex-1 h-7 px-2 rounded bg-surface-0 border border-border text-[10px] text-text-primary outline-none font-mono"
                        />

                        <input
                          type="text"
                          value={v.label}
                          onChange={(e) => {
                            const variables = [...draftTemplate.variables];
                            variables[idx].label = e.target.value;
                            setDraftTemplate({ ...draftTemplate, variables });
                          }}
                          placeholder="显示标签"
                          className="flex-1 h-7 px-2 rounded bg-surface-0 border border-border text-[10px] text-text-primary outline-none"
                        />

                        <input
                          type="text"
                          value={v.defaultValue || ""}
                          onChange={(e) => {
                            const variables = [...draftTemplate.variables];
                            variables[idx].defaultValue = e.target.value;
                            setDraftTemplate({ ...draftTemplate, variables });
                          }}
                          placeholder="默认值"
                          className="w-28 h-7 px-2 rounded bg-surface-0 border border-border text-[10px] text-text-primary outline-none"
                        />

                        <button
                          onClick={() => {
                            const variables = draftTemplate.variables.filter(
                              (_, i) => i !== idx,
                            );
                            setDraftTemplate({ ...draftTemplate, variables });
                          }}
                          className="text-text-muted hover:text-red-400 p-1 transition-all opacity-40 group-hover/var:opacity-100"
                          title="删除变量"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      const newVar = {
                        name: `var_${Date.now().toString(36).slice(-4)}`,
                        label: "输入参数",
                        type: "text" as const,
                        required: true,
                        defaultValue: "",
                      };
                      setDraftTemplate({
                        ...draftTemplate,
                        variables: [...draftTemplate.variables, newVar],
                      });
                    }}
                    className="h-8 w-full rounded border border-dashed border-border hover:border-brand-500 text-text-secondary hover:text-text-primary text-[10px] flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" /> 声明参数变量
                  </button>
                </div>

                {/* 4. 标签 */}
                <div className="space-y-1">
                  <label className="text-[10px] text-text-secondary font-bold">
                    标签分类 (英文逗号分隔)
                  </label>
                  <input
                    type="text"
                    value={draftTemplate.tags.join(", ")}
                    onChange={(e) =>
                      setDraftTemplate({
                        ...draftTemplate,
                        tags: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className="w-full h-8 px-2.5 rounded bg-surface-2 border border-border text-xs text-text-primary focus:border-brand-500 outline-none"
                    placeholder="例如: 财务, 表单, 审批流程"
                  />
                </div>
              </div>

              {/* 右栏底部控制按钮 */}
              <div className="flex justify-end gap-3 pt-3 border-t border-border shrink-0 mt-4">
                <button
                  onClick={() => {
                    setDraftTemplate(null);
                    if (isEditingExisting) setCurrentView("list");
                  }}
                  className="h-9 px-4 rounded bg-surface-2 hover:bg-surface-3 border border-border text-xs font-semibold text-text-primary transition-all"
                >
                  {isEditingExisting ? "取消" : "放弃草稿"}
                </button>
                <button
                  onClick={handleSaveDraftTemplate}
                  className="h-9 px-5 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all glow"
                >
                  <Save className="w-4 h-4" />
                  <span>{isEditingExisting ? "保存修改" : "保存至模板库"}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      </div>
  );
};

export default Templates;
