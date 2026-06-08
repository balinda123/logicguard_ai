import React from 'react';
import { 
  Terminal, 
  Loader2, 
  Flame, 
  X,
  RefreshCw,
  Pause,
  Play,
  StopCircle
} from 'lucide-react';
import type { HealerLog } from '../types';

export interface ConsoleStep {
  stepId: number;
  action?: string;
  description: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  error?: string;
  healed?: boolean;
}

interface TaskExecutionConsoleProps {
  steps: ConsoleStep[];
  healerLogs: HealerLog[];
  runningProgressMsg: string | null;
  isRunning: boolean;
  isPaused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onTerminate?: () => void;
  showHealer: boolean;
  setShowHealer: (show: boolean) => void;
  onClose?: () => void;
  isModalMode?: boolean;
  title?: string;
  subtitle?: string;
}

export const TaskExecutionConsole: React.FC<TaskExecutionConsoleProps> = ({
  steps,
  healerLogs,
  runningProgressMsg,
  isRunning,
  isPaused = false,
  onPause,
  onResume,
  onTerminate,
  showHealer,
  setShowHealer,
  onClose,
  isModalMode = false,
  title = "AI 任务智能执行控制台",
  subtitle = "Stagehand-First 执行流 & Healer 实时自愈诊断"
}) => {

  const innerContent = (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 min-w-0 bg-surface-0 rounded-xl border border-border/80 shadow-2xl">
      {/* Left Panel: Step Progression */}
      <div className={`flex-1 shrink-0 flex flex-col h-full overflow-y-auto p-5 space-y-4 bg-surface-0 min-w-0 ${showHealer ? 'border-r border-border' : ''}`}>
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-text-primary mb-1 truncate">
              {title}
            </h3>
            <p className="text-xs text-text-muted truncate">
              {subtitle}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-4 bg-surface-2 p-1 rounded-lg border border-border">
            {isRunning && (
              <div className="flex items-center gap-1 border-r border-border/60 pr-1.5 mr-0.5">
                {onPause && onResume && (
                  isPaused ? (
                    <button
                      onClick={onResume}
                      title="继续执行"
                      className="p-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-md transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-emerald-400/20" />
                    </button>
                  ) : (
                    <button
                      onClick={onPause}
                      title="暂停执行"
                      className="p-1 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-md transition-colors"
                    >
                      <Pause className="w-3.5 h-3.5 fill-amber-400/20" />
                    </button>
                  )
                )}
                {onTerminate && (
                  <button
                    onClick={onTerminate}
                    title="终止任务"
                    className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors"
                  >
                    <StopCircle className="w-3.5 h-3.5 fill-red-400/20" />
                  </button>
                )}
              </div>
            )}

            <button
              onClick={() => setShowHealer(!showHealer)}
              title={showHealer ? "隐藏 Healer 诊断控制台" : "展开 Healer 诊断控制台"}
              className={`p-1.5 rounded-md transition-colors ${showHealer ? 'bg-brand-500/10 text-brand-400' : 'text-text-muted hover:text-text-primary hover:bg-surface-3'}`}
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
            {isModalMode && onClose && (
              <button
                onClick={onClose}
                disabled={isRunning}
                title="关闭控制台"
                className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-3 rounded-md transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Progress Msg */}
        {runningProgressMsg && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-500/10 border border-brand-500/20 text-[11px] text-brand-300 font-medium animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400 shrink-0" />
            <span>{runningProgressMsg}</span>
          </div>
        )}

        {/* Steps List */}
        <div className="space-y-2 flex-1 overflow-y-auto pr-1">
          {steps.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-text-muted space-y-2 italic text-xs py-8">
              <RefreshCw className="w-5 h-5 animate-spin text-brand-500/30" />
              <span>暂无步骤，等待 AI 规划拆解中...</span>
            </div>
          ) : (
            steps.map((step) => (
              <div
                key={step.stepId}
                className={`p-3 rounded-xl border text-left transition-all duration-300 ${
                  step.status === 'running'
                    ? 'bg-brand-500/5 border-brand-500/45 shadow-[0_0_12px_rgba(110,68,255,0.06)]'
                    : step.status === 'success'
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : step.status === 'failed'
                        ? 'bg-red-500/5 border-red-500/35'
                        : 'bg-surface-2/40 border-border/60 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex gap-2.5 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold mt-0.5 shrink-0 ${
                        step.status === 'running'
                          ? 'bg-brand-500 text-white animate-pulse'
                          : step.status === 'success'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : step.status === 'failed'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-surface-3 text-text-muted'
                      }`}
                    >
                      {step.stepId}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold leading-relaxed ${step.status === 'running' ? 'text-text-primary font-bold' : 'text-text-secondary'}`}>
                        {step.description}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {step.action && (
                          <span className="text-[9px] uppercase bg-brand-500/10 text-brand-400 font-mono font-bold px-1.5 py-0.5 rounded">
                            {step.action}
                          </span>
                        )}
                        <span className="text-[9px] bg-surface-3 text-text-muted font-mono px-1.5 py-0.5 rounded">
                          Stagehand Perception
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span
                      className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold font-mono ${
                        step.status === 'success'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : step.status === 'running'
                            ? 'bg-brand-500/20 text-brand-400 animate-pulse'
                            : step.status === 'failed'
                              ? 'bg-red-500/15 text-red-400'
                              : 'bg-surface-3 text-text-muted'
                      }`}
                    >
                      {step.status === 'success' ? 'DONE' : step.status === 'running' ? 'RUNNING' : step.status === 'failed' ? 'FAIL' : 'PENDING'}
                    </span>
                    
                    {step.healed && (
                      <span className="text-[8px] bg-warning/15 text-warning px-1.5 py-0.5 rounded font-mono font-bold flex items-center gap-0.5 animate-pulse">
                        <Flame className="w-2.5 h-2.5" /> 自动修复自愈
                      </span>
                    )}

                    {step.error && (
                      <span 
                        title={step.error} 
                        className="text-[8px] bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-1 py-0.2 rounded cursor-help transition-all max-w-[80px] truncate"
                      >
                        {step.error}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Close Button footer if finished */}
        {isModalMode && !isRunning && onClose && (
          <div className="pt-2 border-t border-border/40 flex justify-end">
            <button
              onClick={onClose}
              className="h-8 px-4 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold rounded-lg shadow-lg shadow-brand-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
            >
              完成并返回
            </button>
          </div>
        )}
      </div>

      {/* Right Panel: Healer Log Console */}
      {showHealer && (
        <div className="flex-1 bg-[#050b18] border-l border-border/80 flex flex-col font-mono h-full overflow-hidden p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/60 shrink-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-brand-400 animate-pulse" />
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Healer 自愈引擎诊断中心
              </h4>
            </div>
            <span className="text-[9px] text-slate-500 font-medium">
              CDP 协议 / 7B 实时自愈诊断监控
            </span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 text-[11px] leading-relaxed pr-2 custom-scrollbar min-h-0 text-slate-300">
            {healerLogs.length > 0 ? (
              healerLogs.map((log, idx) => {
                let textStyle = "text-slate-300 bg-slate-900/60 border-slate-800";
                if (log.resolved) {
                  textStyle = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                } else if (log.strategy === 'retry') {
                  textStyle = "bg-brand-500/5 text-brand-300 border-brand-500/15";
                } else if (log.strategy === 'abort') {
                  textStyle = "bg-red-500/10 text-red-400 border-red-500/20";
                }
                
                return (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-lg flex items-start gap-2.5 border transition-all duration-200 ${textStyle}`}
                  >
                    <span className="text-[10px] text-slate-500 shrink-0 select-none font-semibold">
                      [{log.timestamp}]
                    </span>
                    <span className="break-all whitespace-pre-wrap">{log.message}</span>
                  </div>
                );
              })
            ) : (
              <div className="text-slate-500 h-full flex flex-col items-center justify-center italic gap-2 text-xs select-none">
                <Terminal className="w-6 h-6 text-slate-700 animate-pulse" />
                <span>无故障检测。Healer 自愈引擎就绪...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (isModalMode) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
        <div className="w-full max-w-5xl h-[85vh] flex flex-col">
          {innerContent}
        </div>
      </div>
    );
  }

  return innerContent;
};
