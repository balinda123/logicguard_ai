import React, { useState } from 'react';
import { Plus, Sliders, AlertCircle } from 'lucide-react';
import { defaultTemplates } from '../templates/defaultTemplates';
import type { ScenarioTemplate } from '../types';

export const Templates: React.FC = () => {
  const [templates] = useState<ScenarioTemplate[]>(defaultTemplates);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const categories = [
    { id: 'all', label: '全部类型' },
    { id: 'login', label: '身份登录' },
    { id: 'form', label: '表单填充' },
    { id: 'approval', label: '流程审批' }
  ];

  const filteredTemplates = templates.filter(t => {
    const matchesCategory = activeCategory === 'all' || t.category === activeCategory;
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          t.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent overflow-y-auto p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">场景模板配置 (Seed Files)</h2>
          <p className="text-xs text-text-muted">预置及自定义领域知识模板，赋予本地小模型开卷参考能力</p>
        </div>
        <button className="h-9 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold flex items-center gap-2 transition-all duration-200">
          <Plus className="w-4 h-4" /> 自定义模板
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-surface-1 p-4 rounded-xl border border-border">
        {/* Category filters */}
        <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-lg border border-border w-full sm:w-auto">
          {categories.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${
                activeCategory === c.id
                  ? 'bg-surface-0 text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Search */}
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

      {/* Grid of Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map(t => (
          <div key={t.id} className="p-5 rounded-xl border border-border bg-surface-1/70 flex flex-col justify-between hover:border-brand-500/30 transition-all duration-200 glow">
            <div className="space-y-3">
              {/* Category Badge & Tags */}
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                  t.category === 'login' 
                    ? 'bg-info/10 text-info' 
                    : t.category === 'form' 
                    ? 'bg-brand-500/15 text-brand-400' 
                    : 'bg-warning/10 text-warning'
                }`}>
                  {t.category === 'login' ? 'IDENTITY LOGIN' : t.category === 'form' ? 'FORM FILL' : 'APPROVAL FLOW'}
                </span>
                <span className="text-[10px] text-text-muted font-mono">#{t.id}</span>
              </div>

              {/* Title & Desc */}
              <div>
                <h3 className="text-sm font-bold text-text-primary">{t.name}</h3>
                <p className="text-xs text-text-secondary mt-1.5 leading-relaxed min-h-[36px]">{t.description}</p>
              </div>

              {/* Step checklist overview */}
              <div className="space-y-1.5 bg-surface-0/60 p-3 rounded-lg border border-border">
                <span className="text-[9px] text-text-muted font-mono font-semibold uppercase block mb-1">参考操作流摘要 ({t.steps.length} 步)</span>
                {t.steps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[10px] text-text-secondary truncate">
                    <span className="w-4 h-4 rounded-full bg-surface-3 flex items-center justify-center text-[8px] font-bold shrink-0">{step.order}</span>
                    <span className="font-semibold text-brand-400 capitalize shrink-0 font-mono">[{step.action}]</span>
                    <span className="truncate text-text-muted">{step.description}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Actions & Tags */}
            <div className="pt-4 mt-4 border-t border-border flex flex-col gap-3">
              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {t.tags.map((tag, idx) => (
                  <span key={idx} className="text-[9px] bg-surface-2 text-text-secondary px-2 py-0.5 rounded border border-border/80">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Configure button */}
              <div className="flex gap-2">
                <button className="flex-1 h-8 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border hover:border-border-hover text-text-primary text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200">
                  <Sliders className="w-3.5 h-3.5 text-text-muted" /> 配置参数
                </button>
              </div>
            </div>
          </div>
        ))}

        {filteredTemplates.length === 0 && (
          <div className="col-span-full py-16 text-center text-text-muted space-y-2">
            <AlertCircle className="w-8 h-8 mx-auto text-surface-4" />
            <p className="text-xs">无符合条件的场景模板</p>
          </div>
        )}
      </div>
    </div>
  );
};
export default Templates;
