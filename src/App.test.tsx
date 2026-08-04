import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';

describe('App routes', () => {
  it('does not include legacy template routes or the Templates page', () => {
    expect(appSource).not.toContain("case 'templates'");
    expect(appSource).not.toContain("case 'templateModeler'");
    expect(appSource).not.toContain("case 'testcases'");
    expect(appSource).not.toContain('./pages/Templates');
  });

  it('routes test design through the persisted system-scoped lifecycle', () => {
    expect(appSource).toContain("case 'testdesign'");
    expect(appSource).toMatch(/case 'testdesign':\s*return <TestDesignPage/);
    expect(appSource).toContain('onNavigate={setActiveTab}');
  });

  it('routes the execution center without changing existing pages', () => {
    expect(appSource).toContain("case 'execution'");
    expect(appSource).toMatch(/case 'execution':\s*return <ExecutionCenter \/>/);
  });

  it('routes the developer-facing issue tracker', () => {
    expect(appSource).toContain("case 'issues'");
    expect(appSource).toContain('<IssueTracker');
  });
});
