import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';

describe('App routes', () => {
  it('does not include legacy template routes or the Templates page', () => {
    expect(appSource).not.toContain("case 'templates'");
    expect(appSource).not.toContain("case 'templateModeler'");
    expect(appSource).not.toContain("case 'testcases'");
    expect(appSource).not.toContain('./pages/Templates');
  });

  it('keeps test design routed to TestCases without obsolete props', () => {
    expect(appSource).toContain("case 'testdesign'");
    expect(appSource).toMatch(/case 'testdesign':\s*return <TestCases \/>/);
  });
});
