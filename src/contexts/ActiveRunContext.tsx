import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import {
  deleteRun,
  getRun,
  listActiveRuns,
  listRunEvents,
  listRuns,
  pauseRun,
  resumeRun,
  subscribeRunEvents,
  subscribeRunUpdates,
  terminateRun,
} from '../api/runBridge'
import type { ExecutionRun, ExecutionRunEvent } from '../types/execution'

const ACTIVE_STATUSES = new Set<ExecutionRun['status']>([
  'queued', 'preflight', 'running', 'pause_requested', 'paused', 'waiting_handoff',
])

interface ActiveRunContextValue {
  runs: ExecutionRun[]
  activeRuns: ExecutionRun[]
  selectedRunId?: string
  selectedRun?: ExecutionRun
  eventsByRun: Readonly<Record<string, ExecutionRunEvent[]>>
  loading: boolean
  error?: string
  setSelectedRunId: (runId?: string) => void
  refresh: () => Promise<void>
  loadRun: (runId: string) => Promise<void>
  pause: (runId: string) => Promise<void>
  resume: (runId: string) => Promise<void>
  terminate: (runId: string) => Promise<void>
  remove: (runId: string) => Promise<void>
}

const ActiveRunContext = createContext<ActiveRunContextValue | undefined>(undefined)

function upsertRun(items: ExecutionRun[], run: ExecutionRun): ExecutionRun[] {
  return [run, ...items.filter((item) => item.id !== run.id)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function mergeEvents(current: ExecutionRunEvent[], incoming: ExecutionRunEvent[]): ExecutionRunEvent[] {
  const bySequence = new Map(current.map((event) => [event.sequence, event]))
  incoming.forEach((event) => bySequence.set(event.sequence, event))
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
}

export function ActiveRunProvider({ children }: { children: ReactNode }) {
  const [runs, setRuns] = useState<ExecutionRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [eventsByRun, setEventsByRun] = useState<Record<string, ExecutionRunEvent[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const eventSequences = useRef<Record<string, number>>({})

  const loadEvents = useCallback(async (runId: string) => {
    const events = await listRunEvents(runId, eventSequences.current[runId] ?? 0)
    if (events.length === 0) return
    eventSequences.current[runId] = Math.max(...events.map((event) => event.sequence))
    setEventsByRun((current) => ({
      ...current,
      [runId]: mergeEvents(current[runId] ?? [], events),
    }))
  }, [])

  const loadRun = useCallback(async (runId: string) => {
    const run = await getRun(runId)
    if (run) setRuns((current) => upsertRun(current, run))
    await loadEvents(runId)
  }, [loadEvents])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      // Active runs are loaded independently so controls recover immediately after navigation/reconnect.
      const [all, active] = await Promise.all([listRuns(), listActiveRuns()])
      const merged = active.reduce(upsertRun, all)
      setRuns(merged)
      setSelectedRunId((current) => current ?? active[0]?.id ?? all[0]?.id)
      await Promise.all(active.map((run) => loadEvents(run.id)))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法连接执行管理器')
    } finally {
      setLoading(false)
    }
  }, [loadEvents])

  useEffect(() => {
    void refresh()
    let unlistenUpdates: (() => void) | undefined
    let unlistenEvents: (() => void) | undefined
    let disposed = false
    void subscribeRunUpdates((run) => {
      if (disposed) return
      setRuns((current) => upsertRun(current, run))
      void loadRun(run.id)
    }).then((unlisten) => { if (disposed) unlisten(); else unlistenUpdates = unlisten })
    void subscribeRunEvents((event) => {
      if (disposed) return
      eventSequences.current[event.runId] = Math.max(eventSequences.current[event.runId] ?? 0, event.sequence)
      setEventsByRun((current) => ({
        ...current,
        [event.runId]: mergeEvents(current[event.runId] ?? [], [event]),
      }))
    }).then((unlisten) => { if (disposed) unlisten(); else unlistenEvents = unlisten })
    return () => {
      disposed = true
      unlistenUpdates?.()
      unlistenEvents?.()
    }
  }, [loadRun, refresh])

  const mutate = useCallback(async (runId: string, operation: (id: string) => Promise<ExecutionRun>) => {
    const run = await operation(runId)
    setRuns((current) => upsertRun(current, run))
    setSelectedRunId(run.id)
    await loadEvents(run.id)
  }, [loadEvents])

  const remove = useCallback(async (runId: string) => {
    await deleteRun(runId)
    delete eventSequences.current[runId]
    setEventsByRun((current) => {
      const next = { ...current }
      delete next[runId]
      return next
    })
    setRuns((current) => {
      const next = current.filter((run) => run.id !== runId)
      setSelectedRunId((selected) => selected === runId ? next[0]?.id : selected)
      return next
    })
  }, [])

  const value = useMemo<ActiveRunContextValue>(() => ({
    runs,
    activeRuns: runs.filter((run) => ACTIVE_STATUSES.has(run.status)),
    selectedRunId,
    selectedRun: runs.find((run) => run.id === selectedRunId),
    eventsByRun,
    loading,
    error,
    setSelectedRunId,
    refresh,
    loadRun,
    pause: (runId) => mutate(runId, pauseRun),
    resume: (runId) => mutate(runId, resumeRun),
    terminate: (runId) => mutate(runId, terminateRun),
    remove,
  }), [error, eventsByRun, loadRun, loading, mutate, refresh, remove, runs, selectedRunId])

  return <ActiveRunContext.Provider value={value}>{children}</ActiveRunContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- provider hook belongs to this context
export function useActiveRuns(): ActiveRunContextValue {
  const value = useContext(ActiveRunContext)
  if (!value) throw new Error('useActiveRuns must be used inside ActiveRunProvider')
  return value
}

// eslint-disable-next-line react-refresh/only-export-components -- shared run-state predicate
export function isTerminalRun(status: ExecutionRun['status']): boolean {
  return !ACTIVE_STATUSES.has(status)
}
