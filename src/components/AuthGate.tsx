import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { getAuthStatus, initializeAdmin, login, logout, setActiveUser, type SessionUser } from '../api/auth';

interface AuthGateProps {
  children: (user: SessionUser) => ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAuthStatus().then((status) => {
      setInitialized(status.initialized);
      setUser(status.user);
      setActiveUser(status.user);
    }).catch((reason) => setError(String(reason)));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const next = initialized
        ? await login(username, password)
        : await initializeAdmin(username, password);
      setUser(next);
      setInitialized(true);
      setActiveUser(next);
      setPassword('');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return <>
      {children(user)}
      <button
        className="fixed left-10 bottom-8 z-50 w-40 rounded-xl border border-border bg-surface-2/90 px-3 py-2.5 text-[11px] text-text-secondary shadow-md backdrop-blur hover:border-error/30 hover:bg-error/10 hover:text-error transition-all flex items-center justify-center gap-1.5"
        onClick={async () => { await logout(); setActiveUser(null); setUser(null); }}
      >退出 {user.username}</button>
    </>;
  }

  return <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-7 shadow-xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-brand-500 flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-text-primary">测试小助手</h1>
          <p className="text-[11px] text-text-muted">{initialized === false ? '首次启动：创建管理员' : '登录本地工作区'}</p>
        </div>
      </div>
      <div className="space-y-3">
        <input className="w-full h-10 px-3 rounded-lg bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-brand-500" placeholder="用户名（至少 3 个字符）" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <input className="w-full h-10 px-3 rounded-lg bg-surface-2 border border-border text-sm text-text-primary outline-none focus:border-brand-500" type="password" placeholder="密码（至少 8 个字符）" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <div className="rounded-lg border border-error/20 bg-error/10 p-3 text-[11px] text-error">{error}</div>}
      <button disabled={busy || initialized === null} className="w-full h-10 rounded-lg bg-brand-500 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        <LogIn className="h-4 w-4" /> {busy ? '处理中…' : initialized === false ? '创建管理员并进入' : '登录'}
      </button>
    </form>
  </div>;
}
