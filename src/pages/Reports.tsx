import React, { useState } from 'react';
import { BarChart3, Clock, CheckCircle2, XCircle, FileText, Check } from 'lucide-react';
import type { TestResult } from '../types';

export const Reports: React.FC = () => {
  const [results] = useState<TestResult[]>([
    {
      id: 'res_001',
      testName: '下属出差发票报销审批自动化流转',
      testStatus: 'success',
      task: '登录OA待办审批发票，断言已通过',
      createdAt: '2026-05-22 10:14:02',
      completedAt: '2026-05-22 10:14:48',
      stepsTotal: 5,
      stepsSuccess: 5,
      reportMarkdown: '### 执行日志汇总\n1. 统一SSO验证穿透成功 (12s)\n2. 校验Cookie安全生命期有效\n3. 执行财务报销流程填写...'
    },
    {
      id: 'res_002',
      testName: 'JIRA Bug智能报错提报至LG项目看板',
      testStatus: 'success',
      task: 'AI提取程序失败堆栈，自动填写Bug并提单',
      createdAt: '2026-05-22 09:30:15',
      completedAt: '2026-05-22 09:31:02',
      stepsTotal: 4,
      stepsSuccess: 4,
      reportMarkdown: '### Bug提单日志\nJIRA API连接完毕，AI成功分析出定位元素，无故障提单'
    },
    {
      id: 'res_003',
      testName: 'OA统一门户登录状态维持检测',
      testStatus: 'failed',
      task: '打开OA主页，断言登录态有效',
      createdAt: '2026-05-21 16:45:30',
      completedAt: '2026-05-21 16:46:12',
      stepsTotal: 4,
      stepsSuccess: 2,
      reportMarkdown: '### 登录态失效检测\n由于本地Chrome Profile目录锁冲突，无法读取对应配置，SSO断言失败'
    }
  ]);

  const successCount = results.filter(r => r.testStatus === 'success').length;
  const successRate = Math.round((successCount / results.length) * 100);

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent overflow-y-auto p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-text-primary">执行历史与测试报告</h2>
        <p className="text-xs text-text-muted">汇总并分析所有的智能测试任务，集成自愈成功率追踪</p>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-surface-1 p-5 rounded-xl border border-border flex items-center gap-4 glow">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <span className="text-[10px] text-text-muted font-semibold block uppercase">总执行次数</span>
            <span className="text-xl font-bold text-text-primary">{results.length} 次</span>
          </div>
        </div>

        <div className="bg-surface-1 p-5 rounded-xl border border-border flex items-center gap-4 glow">
          <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-success" />
          </div>
          <div>
            <span className="text-[10px] text-text-muted font-semibold block uppercase">执行成功率</span>
            <span className="text-xl font-bold text-success">{successRate}%</span>
          </div>
        </div>

        <div className="bg-surface-1 p-5 rounded-xl border border-border flex items-center gap-4 glow">
          <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
            <Clock className="w-5 h-5 text-warning" />
          </div>
          <div>
            <span className="text-[10px] text-text-muted font-semibold block uppercase">AI 均值响应</span>
            <span className="text-xl font-bold text-warning">3.4 秒</span>
          </div>
        </div>

        <div className="bg-surface-1 p-5 rounded-xl border border-border flex items-center gap-4 glow">
          <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center">
            <Check className="w-5 h-5 text-info animate-pulse" />
          </div>
          <div>
            <span className="text-[10px] text-text-muted font-semibold block uppercase">Healer 自愈次数</span>
            <span className="text-xl font-bold text-info">12 次</span>
          </div>
        </div>
      </div>

      {/* Historical logs table */}
      <div className="bg-surface-1 rounded-xl border border-border overflow-hidden glow">
        <div className="px-5 py-4 border-b border-border bg-surface-2/40 flex items-center justify-between">
          <h3 className="text-xs font-bold text-text-primary">任务执行记录列表</h3>
          <span className="text-[10px] text-text-muted">已自动归档至 PocketBase 本地数据库</span>
        </div>

        <div className="divide-y divide-border">
          {results.map((r) => (
            <div key={r.id} className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-surface-2/20 transition-all duration-200">
              <div className="flex items-start gap-3.5">
                {r.testStatus === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-success mt-0.5" />
                ) : (
                  <XCircle className="w-5 h-5 text-error mt-0.5" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-text-primary">{r.testName}</h4>
                    <span className="text-[9px] bg-surface-2 text-text-muted font-mono px-1.5 py-0.5 rounded border border-border/80">
                      {r.id}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary mt-1">{r.task}</p>
                  <div className="flex items-center gap-3 text-[10px] text-text-muted mt-2">
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {r.createdAt}</span>
                    <span>•</span>
                    <span>成功率: {r.stepsSuccess}/{r.stepsTotal} 步</span>
                  </div>
                </div>
              </div>

              {/* Status Badge & Report */}
              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                  r.testStatus === 'success' ? 'bg-success/15 text-success' : 'bg-error/15 text-error'
                }`}>
                  {r.testStatus === 'success' ? 'PASSED' : 'FAILED'}
                </span>
                <button className="h-8 px-3 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border hover:border-border-hover text-text-primary text-xs font-semibold flex items-center gap-1.5 transition-all duration-200">
                  <FileText className="w-3.5 h-3.5 text-text-muted" /> 查看报告
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
export default Reports;
