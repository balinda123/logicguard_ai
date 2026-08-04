import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
const listenMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

import { getRun, listActiveRuns, listRunEvents, listRuns, pauseRun, resumeRun, startRun, subscribeRunEvents, subscribeRunUpdates, terminateRun } from './runBridge'

const rustRun = {
  id: 'run-1', ownerId: 'owner-1', status: 'running', currentStep: 1,
  checkpoint: null, snapshot: {}, executionPlan: { commands: [] }, errorCategory: null,
  errorMessage: null, workerPid: null, leaseOwner: null, leaseExpiresAt: null,
  startedAt: null, finishedAt: null, createdAt: 'now', updatedAt: 'now',
}

describe('runBridge', () => {
  beforeEach(() => { invokeMock.mockReset(); listenMock.mockReset() })

  it('maps commands and normalizes nullable fields', async () => {
    invokeMock
      .mockResolvedValueOnce('run-1').mockResolvedValueOnce(rustRun).mockResolvedValueOnce(rustRun)
      .mockResolvedValueOnce(rustRun).mockResolvedValueOnce([rustRun]).mockResolvedValueOnce([rustRun])
      .mockResolvedValueOnce([{ runId: 'run-1', sequence: 1, kind: 'progress', data: {}, createdAt: 'now' }])
    expect(await startRun({ executionPlan: { commands: [] }, snapshot: {} })).toBe('run-1')
    await pauseRun('run-1'); await resumeRun('run-1'); await terminateRun('run-1')
    expect(await getRun('run-1')).toMatchObject({ checkpoint: undefined, workerPid: undefined })
    await listRuns(); await listActiveRuns(); await listRunEvents('run-1', 4)
    expect(invokeMock.mock.calls).toEqual([
      ['start_run', { input: { executionPlan: { commands: [] }, snapshot: {} } }],
      ['pause_run', { runId: 'run-1' }], ['resume_run', { runId: 'run-1' }],
      ['terminate_run', { runId: 'run-1' }], ['get_run', { runId: 'run-1' }],
      ['list_runs', {}], ['list_active_runs', {}], ['list_run_events', { runId: 'run-1', afterSequence: 4 }],
    ])
  })

  it('maps update and event subscriptions', async () => {
    const onRun = vi.fn(); const onEvent = vi.fn()
    listenMock.mockImplementation(async (name, handler) => { handler({ payload: name === 'run://updated' ? { run: rustRun } : { event: { runId: 'run-1', sequence: 1, kind: 'progress', data: {}, createdAt: 'now' } } }); return vi.fn() })
    await subscribeRunUpdates(onRun); await subscribeRunEvents(onEvent)
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1', checkpoint: undefined }))
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', sequence: 1 }))
  })
})
