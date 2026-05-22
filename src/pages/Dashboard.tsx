import React, { useState, useEffect } from 'react';
import { Play, RotateCcw, ShieldCheck, Flame, Globe, Search, Terminal } from 'lucide-react';
import type { PlanStep, HealerLog, PageContext } from '../types';
import { defaultTemplates } from '../templates/defaultTemplates';
import { simulatePlanning, runStepSimulation } from '../agents/simulatedEngine';

export const Dashboard: React.FC = () => {
  const [taskInput, setTaskInput] = useState('自动登录OA系统并审批我的下属张三的发票报销');
  const [matchedTemplate, setMatchedTemplate] = useState(defaultTemplates[0]);
  const [planningStatus, setPlanningStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [healerLogs, setHealerLogs] = useState<HealerLog[]>([]);
  
  // Real-time Page Context representation for visualization
  const [currentPage, setCurrentPage] = useState<PageContext | null>(null);
  const [hoveredElementIdx, setHoveredElementIdx] = useState<number | null>(null);

  // Template matching algorithm based on user input
  useEffect(() => {
    const matched = defaultTemplates.find(t => 
      taskInput.toLowerCase().includes(t.name.toLowerCase()) ||
      t.tags.some(tag => taskInput.toLowerCase().includes(tag.toLowerCase()))
    ) || defaultTemplates[0];
    setMatchedTemplate(matched);
  }, [taskInput]);

  const handleStartTask = async () => {
    setIsPlanning(true);
    setIsExecuting(false);
    setSteps([]);
    setHealerLogs([]);
    setCurrentPage(null);
    
    try {
      const plannedSteps = await simulatePlanning(taskInput, (status) => {
        setPlanningStatus(status);
      });
      setSteps(plannedSteps);
      setPlanningStatus(null);
      setIsPlanning(false);

      // Trigger automatic execution
      setIsExecuting(true);
      
      // We run through steps sequentially
      for (const step of plannedSteps) {
        await runStepSimulation(
          step,
          (updatedStep) => {
            setSteps(prev => prev.map(s => s.stepId === updatedStep.stepId ? updatedStep : s));
          },
          (log) => {
            setHealerLogs(prev => [...prev, log]);
          },
          (page) => {
            setCurrentPage(page);
          }
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsExecuting(false);
    }
  };

  const resetTask = () => {
    setSteps([]);
    setHealerLogs([]);
    setCurrentPage(null);
    setIsExecuting(false);
    setIsPlanning(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent overflow-hidden animate-fade-in">
      {/* Upper Area: Split Panel */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden min-h-0 min-w-0">
        
        {/* Left Side: Setup & Steps Control */}
        <div className="w-full lg:w-[380px] shrink-0 lg:border-r border-b lg:border-b-0 border-border flex flex-col lg:h-full lg:overflow-y-auto p-6 space-y-6">
          <div>
            <h3 className="text-sm font-bold text-text-primary mb-1">新建意图执行任务</h3>
            <p className="text-xs text-text-muted">使用自然语言输入，系统将自动分解并适配最佳穿透方案</p>
          </div>

          {/* Task input card */}
          <div className="space-y-3">
            <textarea
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              disabled={isExecuting || isPlanning}
              placeholder="请输入您的操作意图，如：'批量下载JIRA LG项目中所有新建缺陷发票附件并提交报销'"
              className="w-full h-24 rounded-lg bg-surface-2 p-3 text-xs text-text-primary border border-border focus:border-brand-500 outline-none resize-none transition-all duration-200"
            />
            
            {/* Matched template info */}
            <div className="p-3 rounded-lg bg-brand-500/5 border border-brand-500/10 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-brand-400 mt-0.5" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-brand-400">已自动匹配模板:</span>
                  <span className="text-[10px] bg-brand-500/20 text-brand-300 px-1.5 py-0.5 rounded font-mono font-medium">{matchedTemplate.name}</span>
                </div>
                <p className="text-[10px] text-text-muted mt-1 leading-relaxed">{matchedTemplate.description}</p>
              </div>
            </div>
          </div>

          {/* Execution Button */}
          <div className="flex gap-3">
            <button
              onClick={handleStartTask}
              disabled={isPlanning || isExecuting}
              className="flex-1 h-10 rounded-lg bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-medium text-xs flex items-center justify-center gap-2 glow disabled:opacity-40 transition-all duration-200"
            >
              <Play className="w-3.5 h-3.5" /> {isExecuting ? '正在自动执行...' : '开始智能任务'}
            </button>
            {(steps.length > 0 || isExecuting) && (
              <button
                onClick={resetTask}
                className="w-10 h-10 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border hover:border-border-hover text-text-secondary hover:text-text-primary flex items-center justify-center transition-all duration-200"
                title="重置"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Steps Planning Breakdown View */}
          {steps.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-border animate-fade-in">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-text-primary">Planner 任务分步计划</h4>
                <span className="text-[10px] text-brand-400 font-medium">100% 本地 7B 模型生成</span>
              </div>
              <div className="space-y-2">
                {steps.map((step) => (
                  <div
                    key={step.stepId}
                    className={`p-3 rounded-lg border flex items-start justify-between gap-3 transition-all duration-200 ${
                      step.status === 'running'
                        ? 'bg-brand-500/5 border-brand-500/30'
                        : step.status === 'success'
                        ? 'bg-surface-2/40 border-border/80'
                        : 'bg-surface-2/20 border-border/50'
                    }`}
                  >
                    <div className="flex gap-2">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold mt-0.5 ${
                        step.status === 'running'
                          ? 'bg-brand-500 text-white animate-pulse'
                          : step.status === 'success'
                          ? 'bg-success/20 text-success'
                          : 'bg-surface-3 text-text-muted'
                      }`}>
                        {step.stepId}
                      </span>
                      <div>
                        <p className={`text-xs font-medium ${step.status === 'running' ? 'text-text-primary' : 'text-text-secondary'}`}>
                          {step.description}
                        </p>
                        <span className="text-[9px] text-text-muted block mt-0.5 font-mono">成功判定: {step.successCriteria}</span>
                      </div>
                    </div>

                    {/* Badge showing healers or execution status */}
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold font-mono ${
                        step.status === 'success'
                          ? 'bg-success/15 text-success'
                          : step.status === 'running'
                          ? 'bg-brand-500/20 text-brand-400 animate-pulse'
                          : 'bg-surface-3 text-text-muted'
                      }`}>
                        {step.status === 'success' ? 'SUCCESS' : step.status === 'running' ? 'RUNNING' : 'PENDING'}
                      </span>
                      {step.healed && (
                        <span className="text-[8px] bg-warning/15 text-warning px-1.5 py-0.5 rounded font-mono font-medium flex items-center gap-1 animate-pulse">
                          <Flame className="w-2.5 h-2.5" /> 自动修复自愈
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loader planning state */}
          {planningStatus && (
            <div className="flex flex-col items-center justify-center p-8 space-y-3 animate-pulse border-t border-border">
              <RotateCcw className="w-6 h-6 text-brand-400 animate-spin" />
              <p className="text-xs text-brand-300 font-mono text-center leading-relaxed">{planningStatus}</p>
            </div>
          )}
        </div>

        {/* Right Side: Virtual Browser Sandbox & Interactive Element Parser */}
        <div className="flex-1 min-w-0 flex flex-col h-full bg-transparent p-6 space-y-6 lg:overflow-y-auto">
          <div>
            <h3 className="text-sm font-bold text-text-primary mb-1">页面结构化感知层 (Accessibility Sandbox)</h3>
            <p className="text-xs text-text-muted">无需原始截图，抓取可交互DOM无障碍树进行纯文本感知，节省 90% AI Token</p>
          </div>

          <div className="flex-1 min-h-[300px] border border-border rounded-xl bg-surface-1 overflow-hidden flex flex-col glow">
            {/* Virtual Browser Top-Bar */}
            <div className="h-10 border-b border-border bg-surface-2/60 px-4 flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-error/30"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-warning/30"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-success/30"></span>
              </div>
              <div className="flex-1 max-w-lg bg-surface-0 border border-border px-3 py-1 rounded-md text-[10px] text-text-secondary font-mono flex items-center gap-2">
                <Globe className="w-3 h-3 text-text-muted" />
                <span className="truncate">{currentPage ? currentPage.url : 'about:blank'}</span>
              </div>
              <div className="text-[10px] text-text-muted font-semibold bg-surface-3 px-2 py-0.5 rounded">
                Chrome Profile
              </div>
            </div>

            {/* Sandbox main viewport */}
            <div className="flex-1 flex min-h-0 relative">
              {currentPage ? (
                <div className="flex-1 flex flex-col p-5 space-y-4">
                  {/* Page Title display */}
                  <div className="flex items-center gap-2 pb-3 border-b border-border/40">
                    <span className="text-[11px] font-bold text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded font-mono uppercase">TITLE</span>
                    <span className="text-xs text-text-primary font-medium">{currentPage.title}</span>
                  </div>

                  {/* Accessible UI Element Map */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    {currentPage.interactiveElements.map((el) => {
                      const isHovered = hoveredElementIdx === el.index;
                      return (
                        <div
                          key={el.index}
                          onMouseEnter={() => setHoveredElementIdx(el.index)}
                          onMouseLeave={() => setHoveredElementIdx(null)}
                          className={`p-3 rounded-lg border text-left cursor-pointer transition-all duration-200 ${
                            isHovered 
                              ? 'bg-brand-500/10 border-brand-500/50 shadow-md transform -translate-y-0.5' 
                              : 'bg-surface-2 border-border/80 hover:border-brand-500/30'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[9px] bg-brand-500/20 text-brand-300 font-mono font-bold px-1.5 py-0.5 rounded">
                              {el.tag}
                            </span>
                            <span className="text-[8px] text-text-muted font-mono font-medium">#{el.index}</span>
                          </div>
                          
                          <p className="text-xs font-semibold text-text-primary truncate">
                            {el.text || <span className="italic text-text-muted font-normal">空内容 / 占位输入框</span>}
                          </p>

                          {el.placeholder && (
                            <p className="text-[10px] text-text-muted mt-1 italic truncate">占位符: {el.placeholder}</p>
                          )}
                          
                          <p className="text-[9px] text-brand-400 font-mono mt-1.5 truncate">{el.selector}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-muted space-y-2">
                  <Search className="w-8 h-8 text-surface-4" />
                  <p className="text-xs">等待任务开始，实时提取的DOM结构化元数据将展示在此处</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Area: Healer Log Console */}
      <div className="h-48 bg-[#0b1121] flex flex-col p-4 font-mono select-none rounded-b-2xl border-t border-slate-800/60 shrink-0">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-brand-400" />
            <h4 className="text-xs font-bold text-slate-200">Healer 自愈引擎诊断中心</h4>
          </div>
          <span className="text-[10px] text-slate-500">本地 7B 模型实时日志监测</span>
        </div>
        <div className="flex-1 overflow-y-auto mt-2 space-y-1.5 text-[11px] leading-relaxed pr-2">
          {healerLogs.length > 0 ? (
            healerLogs.map((log, idx) => (
              <div
                key={idx}
                className={`p-1.5 rounded flex items-start gap-2.5 animate-fade-in ${
                  log.resolved ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800/40 text-slate-300'
                }`}
              >
                <span className="text-[10px] text-slate-500 shrink-0">[{log.timestamp}]</span>
                <span>{log.message}</span>
              </div>
            ))
          ) : (
            <div className="text-slate-500 h-full flex items-center justify-center">
              <span>无故障检测。Healer 自愈引擎待命...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default Dashboard;
