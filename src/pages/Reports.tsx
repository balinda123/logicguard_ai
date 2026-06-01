import React, { useState, useEffect } from "react";
import {
  BarChart3,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Search,
  ArrowLeft,
  Play,
  Activity,
  Sparkles,
  FileCheck,
  Zap,
} from "lucide-react";
import type { TestResult } from "../types";

export const Reports: React.FC = () => {
  const [results, setResults] = useState<TestResult[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "success" | "failed"
  >("all");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  useEffect(() => {
    const loadReports = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        let rawList = "[]";
        try {
          rawList = await invoke<string>("load_reports_from_file");
        } catch (err) {
          console.warn("load_reports_from_file failed, falling back to localStorage", err);
          rawList = localStorage.getItem("logicguard_test_results") || "[]";
        }

        const parsed = JSON.parse(rawList);
        const realRuns = parsed.filter(
          (r: any) => !["res_001", "res_002", "res_003"].includes(r.id)
        );
        setResults(realRuns);
        
        try {
          await invoke("save_reports_to_file", { data: JSON.stringify(realRuns) });
        } catch (err) {
          localStorage.setItem("logicguard_test_results", JSON.stringify(realRuns));
        }
      } catch (e) {
        console.warn("Failed to load reports", e);
        setResults([]);
      }
    };
    loadReports();
  }, []);

  // Filter reports
  const filteredResults = results.filter((r) => {
    const matchesSearch =
      r.testName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.task.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "success" && r.testStatus === "success") ||
      (statusFilter === "failed" && r.testStatus === "failed");

    return matchesSearch && matchesStatus;
  });

  const successCount = results.filter((r) => r.testStatus === "success").length;
  const totalCount = results.length;
  const successRate =
    totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;
  const avgResponseTime =
    totalCount > 0
      ? (
          results.reduce((acc, r: any) => {
            if (r.duration !== undefined) return acc + r.duration;
            if (r.completedAt && r.createdAt) {
              const start = new Date(r.createdAt.replace(/-/g, "/")).getTime();
              const end = new Date(r.completedAt.replace(/-/g, "/")).getTime();
              if (!isNaN(start) && !isNaN(end) && end >= start) {
                return acc + (end - start) / 1000;
              }
            }
            return acc + (r.stepsTotal || 1) * 8;
          }, 0) / totalCount
        ).toFixed(1)
      : "0.0";

  const selectedReport = results.find((r) => r.id === selectedReportId);

  // Helper to trigger a fresh report (simulate adding one for developer quick verification)
  const handleSimulateNewReport = async () => {
    const newId = `res_${Math.floor(100 + Math.random() * 900)}`;
    const randomStatus =
      Math.random() > 0.35 ? ("success" as const) : ("failed" as const);
    const isHealed = randomStatus === "success" && Math.random() > 0.5;

    const newReport: TestResult = {
      id: newId,
      testName: `完美世界绩效平台 - 自动导出 ${2020 + Math.floor(Math.random() * 7)} 年底绩效报表`,
      testStatus: randomStatus,
      task: `进入绩效管理平台，展开下拉菜单，选中年份，执行导出操作并拦截结果`,
      createdAt: new Date().toISOString().replace("T", " ").substring(0, 19),
      completedAt: new Date(Date.now() + 45000)
        .toISOString()
        .replace("T", " ")
        .substring(0, 19),
      stepsTotal: 6,
      stepsSuccess:
        randomStatus === "success" ? 6 : Math.floor(2 + Math.random() * 3),
      reportMarkdown: `### 📊 模拟导出运行诊断报告 (${newId})\n\n- **执行意图**：展开绩效期间选择器，选中对应年份，点击“导出”按钮，校验下载状态。\n- **状态判定**：${randomStatus === "success" ? "✅ 执行通过，接口拦截到报表文件导出成功" : "❌ 任务失败，点击导出按钮时接口发生 500 服务器内部故障"}\n- **Healer自愈追踪**：${isHealed ? "🚑 **成功自愈 1 次**。检测到选项失焦折叠，Healer 启动智能按键流（ArrowDown + Enter）成功补救。" : "未触发重大故障干预。"}\n\n#### 📝 实时交互日志：\n1. \`click_period_select_combobox\` -> 展开“选择绩效期间”下拉框成功。\n2. \`select_target_year_option\` -> ${isHealed ? "检测到失焦收回，Healer 自愈引擎调用 ArrowDown 补救，成功选中目标年份！" : "在 teleport 浮层中精准点击目标年份，选中成功。"}\n3. \`verify_active_year_text\` -> 页面断言“当前选定期间”已刷新符合预期。\n4. \`click_export_report_button\` -> 精准点击“导出”按钮。\n5. \`intercept_api_export_response\` -> ${randomStatus === "success" ? "通过拦截接口取得流数据，导出状态码: 200 SUCCESS" : "🔴 拦截到服务端报错: 500 Internal Server Error，重试 3 次后依旧无法连接，已自动限流中止任务。"}`,
      duration: 45,
    };

    const updated = [newReport, ...results];
    setResults(updated);
    setSelectedReportId(newId);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_reports_to_file", { data: JSON.stringify(updated) });
    } catch (err) {
      console.warn("save_reports_to_file failed, falling back to localStorage", err);
      localStorage.setItem("logicguard_test_results", JSON.stringify(updated));
    }
  };

  const handleClearReports = async () => {
    if (window.confirm("确认清空所有的执行历史记录吗？")) {
      setResults([]);
      setSelectedReportId(null);

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_reports_to_file", { data: "[]" });
      } catch (err) {
        console.warn("save_reports_to_file failed, falling back to localStorage", err);
        localStorage.removeItem("logicguard_test_results");
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden p-6 space-y-6 animate-fade-in">
      {!selectedReport ? (
        <>
          {/* Header with quick action tools */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
            <div>
              <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-brand-400" />
                执行历史与测试报告
              </h2>
              <p className="text-xs text-text-muted">
                汇总并分析所有的智能测试任务，集成自愈成功率与故障根因追踪
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={handleSimulateNewReport}
                className="h-8.5 px-3 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 text-brand-400 text-xs font-semibold flex items-center gap-1.5 transition-all duration-200"
                title="手动模拟生成一个新的诊断报告"
              >
                <Sparkles className="w-3.5 h-3.5" />
                模拟生成报告
              </button>
              {results.length > 0 && (
                <button
                  onClick={handleClearReports}
                  className="h-8.5 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 text-xs font-semibold transition-all duration-200"
                >
                  清空记录
                </button>
              )}
            </div>
          </div>

          {/* Main stats layout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
            <div className="bg-surface-1 p-4.5 rounded-xl border border-border flex items-center gap-4 glow transition-all hover:border-brand-500/30">
              <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-brand-400" />
              </div>
              <div>
                <span className="text-[10px] text-text-muted font-bold block uppercase tracking-wider">
                  总执行次数
                </span>
                <span className="text-lg font-bold text-text-primary mt-0.5 block">
                  {totalCount} 次
                </span>
              </div>
            </div>

            <div className="bg-surface-1 p-4.5 rounded-xl border border-border flex items-center gap-4 glow transition-all hover:border-success/30">
              <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-success animate-pulse" />
              </div>
              <div>
                <span className="text-[10px] text-text-muted font-bold block uppercase tracking-wider">
                  运行成功率
                </span>
                <span className="text-lg font-bold text-success mt-0.5 block">
                  {successRate}%
                </span>
              </div>
            </div>

            <div className="bg-surface-1 p-4.5 rounded-xl border border-border flex items-center gap-4 glow transition-all hover:border-warning/30">
              <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <span className="text-[10px] text-text-muted font-bold block uppercase tracking-wider">
                  智能均值响应
                </span>
                <span className="text-lg font-bold text-warning mt-0.5 block">
                  {avgResponseTime} 秒
                </span>
              </div>
            </div>

            <div className="bg-surface-1 p-4.5 rounded-xl border border-border flex items-center gap-4 glow transition-all hover:border-info/30">
              <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center">
                <Zap className="w-5 h-5 text-info" />
              </div>
              <div>
                <span className="text-[10px] text-text-muted font-bold block uppercase tracking-wider">
                  Healer 自愈补救
                </span>
                <span className="text-lg font-bold text-info mt-0.5 block">
                  {
                    results.filter(
                      (r) =>
                        r.reportMarkdown?.includes("自愈") ||
                        r.reportMarkdown?.includes("Healer"),
                    ).length
                  }{" "}
                  次
                </span>
              </div>
            </div>
          </div>

          {/* Full-width list of records */}
          <div className="flex-1 bg-surface-1 rounded-xl border border-border overflow-hidden flex flex-col min-h-0 glow">
            {/* List Toolbar */}
            <div className="px-5 py-4 border-b border-border bg-surface-2/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-text-primary">
                  任务执行记录
                </span>
                <span className="text-[10px] bg-surface-3 text-text-secondary px-1.5 py-0.5 rounded font-mono font-medium">
                  {filteredResults.length} / {totalCount}
                </span>
              </div>

              {/* Filter controls */}
              <div className="flex items-center gap-2">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input
                    type="text"
                    placeholder="搜索报告名称或ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-8 pl-8 pr-3 rounded-lg bg-surface-2 text-xs text-text-primary border border-border focus:border-brand-500 outline-none w-40 sm:w-48 transition-all"
                  />
                </div>

                {/* Status tabs */}
                <div className="flex bg-surface-2 p-0.5 rounded-lg border border-border text-[10px] font-semibold shrink-0">
                  <button
                    onClick={() => setStatusFilter("all")}
                    className={`px-2 py-1 rounded-md transition-colors ${statusFilter === "all" ? "bg-surface-0 text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"}`}
                  >
                    全部
                  </button>
                  <button
                    onClick={() => setStatusFilter("success")}
                    className={`px-2 py-1 rounded-md transition-colors ${statusFilter === "success" ? "bg-surface-0 text-success shadow-sm" : "text-text-muted hover:text-success"}`}
                  >
                    通过
                  </button>
                  <button
                    onClick={() => setStatusFilter("failed")}
                    className={`px-2 py-1 rounded-md transition-colors ${statusFilter === "failed" ? "bg-surface-0 text-error shadow-sm" : "text-text-muted hover:text-error"}`}
                  >
                    失败
                  </button>
                </div>
              </div>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto divide-y divide-border custom-scrollbar min-h-0">
              {filteredResults.length > 0 ? (
                filteredResults.map((r) => {
                  const hasHealed =
                    r.reportMarkdown?.includes("自愈") ||
                    r.reportMarkdown?.includes("Healer");

                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedReportId(r.id)}
                      className="p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer transition-all duration-200 hover:bg-surface-2/20 border-l-2 border-l-transparent hover:border-l-brand-500"
                    >
                      <div className="flex items-start gap-4 min-w-0">
                        {r.testStatus === "success" ? (
                          <CheckCircle2 className="w-5 h-5 text-success mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-error mt-0.5 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-xs font-bold text-text-primary truncate max-w-sm sm:max-w-md md:max-w-lg lg:max-w-xl">
                              {r.testName}
                            </h4>
                            <span className="text-[9px] bg-surface-2 text-text-muted font-mono px-1.5 py-0.5 rounded border border-border/80 shrink-0">
                              {r.id}
                            </span>
                            {hasHealed && (
                              <span className="text-[8px] bg-amber-500/10 text-amber-400 font-mono px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0 flex items-center gap-1">
                                <Zap className="w-2 h-2 fill-current" /> 已自愈
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-text-secondary mt-1.5 truncate max-w-sm sm:max-w-xl md:max-w-2xl">
                            {r.task}
                          </p>
                          <div className="flex items-center gap-3 text-[10px] text-text-muted mt-2.5">
                            <span className="flex items-center gap-1 font-mono">
                              <Clock className="w-3.5 h-3.5 shrink-0" />{" "}
                              {r.createdAt}
                            </span>
                            <span>•</span>
                            <span className="font-mono">
                              步骤成功比例: {r.stepsSuccess} / {r.stepsTotal} 步
                            </span>
                            {r.duration !== undefined && (
                              <>
                                <span>•</span>
                                <span className="font-mono text-warning">
                                  耗时: {r.duration} 秒
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Status & View button */}
                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        <span
                          className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded font-bold font-mono ${
                            r.testStatus === "success"
                              ? "bg-success/15 text-success"
                              : "bg-error/15 text-error"
                          }`}
                        >
                          {r.testStatus === "success" ? "PASSED" : "FAILED"}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedReportId(r.id);
                          }}
                          className="h-8 px-3 rounded-lg border border-border hover:border-brand-500/30 bg-surface-2 hover:bg-brand-500/5 text-xs font-semibold text-text-primary hover:text-brand-400 flex items-center gap-1.5 transition-all"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          详情
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center text-text-muted italic space-y-2">
                  <FileCheck className="w-8 h-8 text-surface-4" />
                  <p className="text-xs">没有找到符合条件的执行记录。</p>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Full-page detailed report view */
        <div className="flex-1 flex flex-col min-h-0 bg-surface-1 rounded-xl border border-border overflow-hidden glow animate-slide-in">
          {/* Detail Header */}
          <div className="px-6 py-4.5 border-b border-border bg-surface-2/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSelectedReportId(null)}
                className="flex items-center gap-1.5 h-8.5 px-3 rounded-lg bg-surface-3 hover:bg-surface-4 border border-border text-text-primary text-xs font-semibold transition-all duration-200"
              >
                <ArrowLeft className="w-4 h-4 text-text-muted" />
                返回记录列表
              </button>
              <div className="h-5 w-[1px] bg-border hidden sm:block" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-text-primary">
                    执行诊断报告
                  </span>
                  <span className="text-[9px] bg-surface-3 text-text-secondary px-1.5 py-0.5 rounded font-mono border border-border">
                    {selectedReport.id}
                  </span>
                </div>
                <p className="text-[10px] text-text-muted mt-0.5 font-mono">
                  {selectedReport.createdAt}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded font-bold font-mono ${
                  selectedReport.testStatus === "success"
                    ? "bg-success/15 text-success"
                    : "bg-error/15 text-error"
                }`}
              >
                {selectedReport.testStatus === "success" ? "PASSED" : "FAILED"}
              </span>
            </div>
          </div>

          {/* Detail scrollable info */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar min-h-0">
            {/* Meta summary card */}
            <div className="p-5 rounded-xl bg-surface-2 border border-border space-y-4">
              <h4 className="text-sm font-bold text-text-primary">
                {selectedReport.testName}
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed bg-surface-1 p-3.5 rounded border border-border/80 font-medium">
                🔍 执行目标: "{selectedReport.task}"
              </p>

              {/* Progress chart */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs font-semibold text-text-secondary">
                  <span>步骤成功比例</span>
                  <span
                    className={
                      selectedReport.testStatus === "success"
                        ? "text-success"
                        : "text-error"
                    }
                  >
                    {selectedReport.stepsSuccess} /{" "}
                    {selectedReport.stepsTotal} (
                    {Math.round(
                      (selectedReport.stepsSuccess /
                        selectedReport.stepsTotal) *
                        100,
                    )}
                    %)
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-surface-3 overflow-hidden border border-border">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      selectedReport.testStatus === "success"
                        ? "bg-success animate-pulse"
                        : "bg-error"
                    }`}
                    style={{
                      width: `${(selectedReport.stepsSuccess / selectedReport.stepsTotal) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Status Callout */}
            <div
              className={`p-4 rounded-xl border flex items-center justify-between gap-3 text-xs font-semibold ${
                selectedReport.testStatus === "success"
                  ? "bg-success/10 border-success/20 text-success"
                  : "bg-error/10 border-error/20 text-error"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {selectedReport.testStatus === "success" ? (
                  <CheckCircle2 className="w-4.5 h-4.5 shrink-0" />
                ) : (
                  <XCircle className="w-4.5 h-4.5 shrink-0" />
                )}
                <span>
                  任务诊断判定:{" "}
                  {selectedReport.testStatus === "success"
                    ? "正常执行并通过断言"
                    : "执行超时或流程断言失败"}
                </span>
              </div>
              <span className="font-mono text-xs uppercase tracking-wider">
                {selectedReport.testStatus}
              </span>
            </div>

            {/* Report Markdown (Visual logs) */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-400" />
                <h5 className="text-sm font-bold text-text-primary">
                  测试流诊断分析 (Markdown)
                </h5>
              </div>
              <div className="p-5 rounded-xl bg-surface-2 border border-border text-xs text-text-secondary leading-relaxed font-mono whitespace-pre-wrap select-text custom-markdown min-h-[250px] overflow-y-auto max-h-[600px] custom-scrollbar">
                {selectedReport.reportMarkdown || "无可用日志报告。"}
              </div>
            </div>

            {/* Re-run button */}
            <div className="pt-2">
              <button
                onClick={() => {
                  alert(
                    `已成功复制任务意图到您的剪贴板！\n\n"${selectedReport.task}"\n\n您可前往“新建任务”面板直接粘贴重新执行。`,
                  );
                  navigator.clipboard.writeText(selectedReport.task);
                }}
                className="w-full h-11 rounded-lg bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-sm transition-all duration-200"
              >
                <Play className="w-4 h-4" />
                复制并重新运行此任务
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
