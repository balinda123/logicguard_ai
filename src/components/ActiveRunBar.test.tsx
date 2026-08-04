import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActiveRunBar } from './ActiveRunBar'
vi.mock('../contexts/ActiveRunContext', () => ({ useActiveRuns: () => ({ activeRuns: [{ id: 'run-1', status: 'running', currentStep: 1, snapshot: { systemName: '人事系统', environmentName: '测试环境', suiteName: '核心回归' }, executionPlan: { commands: [{}, {}] } }], eventsByRun: {}, pause: vi.fn(), resume: vi.fn(), terminate: vi.fn(), setSelectedRunId: vi.fn() }) }))
vi.mock('../api/runBridge', () => ({ focusRunBrowser: vi.fn() }))
describe('ActiveRunBar', () => { it('shows browser control and state-safe actions', () => { render(<ActiveRunBar onOpenExecution={vi.fn()} />); expect(screen.getByText('自动化执行中')).toBeVisible(); expect(screen.getByText(/浏览器受控/)).toBeVisible(); expect(screen.getByRole('button', { name: '暂停执行' })).toBeEnabled(); expect(screen.getByRole('button', { name: '继续执行' })).toBeDisabled(); expect(screen.getByRole('button', { name: '终止执行' })).toBeEnabled() }) })
