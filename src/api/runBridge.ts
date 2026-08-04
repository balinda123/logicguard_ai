import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ExecutionRun, ExecutionRunEvent, StartRunInput } from '../types/execution'

type RustRun = Omit<ExecutionRun, 'checkpoint' | 'errorCategory' | 'errorMessage' | 'workerPid' | 'leaseOwner' | 'leaseExpiresAt' | 'startedAt' | 'finishedAt'> & {
  checkpoint: ExecutionRun['checkpoint'] | null
  errorCategory: ExecutionRun['errorCategory'] | null
  errorMessage: string | null
  workerPid: number | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  startedAt: string | null
  finishedAt: string | null
}

function mapRun(run: RustRun): ExecutionRun {
  return {
    ...run,
    checkpoint: run.checkpoint ?? undefined,
    errorCategory: run.errorCategory ?? undefined,
    errorMessage: run.errorMessage ?? undefined,
    workerPid: run.workerPid ?? undefined,
    leaseOwner: run.leaseOwner ?? undefined,
    leaseExpiresAt: run.leaseExpiresAt ?? undefined,
    startedAt: run.startedAt ?? undefined,
    finishedAt: run.finishedAt ?? undefined,
  }
}

export const startRun = (input: StartRunInput) => invoke<string>('start_run', { input })
export const pauseRun = async (runId: string) => mapRun(await invoke<RustRun>('pause_run', { runId }))
export const resumeRun = async (runId: string) => mapRun(await invoke<RustRun>('resume_run', { runId }))
export const terminateRun = async (runId: string) => mapRun(await invoke<RustRun>('terminate_run', { runId }))
export async function getRun(runId: string): Promise<ExecutionRun | undefined> {
  const run = await invoke<RustRun | null>('get_run', { runId })
  return run ? mapRun(run) : undefined
}
export async function listRuns(): Promise<ExecutionRun[]> {
  return (await invoke<RustRun[]>('list_runs', {})).map(mapRun)
}
export async function listActiveRuns(): Promise<ExecutionRun[]> {
  return (await invoke<RustRun[]>('list_active_runs', {})).map(mapRun)
}
export const listRunEvents = (runId: string, afterSequence = 0) =>
  invoke<ExecutionRunEvent[]>('list_run_events', { runId, afterSequence })

export const subscribeRunUpdates = (handler: (run: ExecutionRun) => void): Promise<UnlistenFn> =>
  listen<{ run: RustRun }>('run://updated', ({ payload }) => handler(mapRun(payload.run)))

export const subscribeRunEvents = (handler: (event: ExecutionRunEvent) => void): Promise<UnlistenFn> =>
  listen<{ event: ExecutionRunEvent }>('run://event', ({ payload }) => handler(payload.event))
