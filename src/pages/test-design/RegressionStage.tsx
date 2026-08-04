import { Play } from 'lucide-react'

import type { TestCase } from '../../types'

interface Props {
  cases: TestCase[]
  running: boolean
  onRun: () => void
}

export function RegressionStage({ cases, running, onRun }: Props) {
  return (
    <section aria-labelledby="regression-stage-title" className="space-y-4">
      <div className="border-b border-border pb-3">
        <h3 id="regression-stage-title" className="text-sm font-bold text-text-primary">回归执行</h3>
        <p className="mt-1 text-[11px] text-text-muted">启动后台运行后可切换页面，暂停、继续和终止由执行中心统一控制。</p>
      </div>
      <div className="flex items-center justify-between gap-4 py-4">
        <div>
          <div className="text-xs font-semibold text-text-primary">已确认用例 {cases.length} 条</div>
          <div className="mt-1 text-[11px] text-text-muted">运行使用启动时的系统、环境、需求和用例快照。</div>
        </div>
        <button type="button" disabled={running || cases.length === 0} onClick={onRun} className="flex h-9 items-center gap-2 rounded-lg bg-success px-4 text-xs font-semibold text-white disabled:opacity-40"><Play className="h-3.5 w-3.5" />开始回归</button>
      </div>
    </section>
  )
}
