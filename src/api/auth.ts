import { invoke } from '@tauri-apps/api/core';

export interface SessionUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

export interface AuthStatus {
  initialized: boolean;
  user: SessionUser | null;
}

export const getAuthStatus = () => invoke<AuthStatus>('auth_status');
export const initializeAdmin = (username: string, password: string) =>
  invoke<SessionUser>('initialize_admin', { username, password });
export const login = (username: string, password: string) =>
  invoke<SessionUser>('login', { username, password });
export const logout = () => invoke<void>('logout');
export const listUsers = () => invoke<SessionUser[]>('list_users');
export const createUser = (username: string, password: string) =>
  invoke<SessionUser>('create_user', { username, password });
export const disableUser = (userId: string) => invoke<void>('disable_user', { userId });
export const resetUserPassword = (userId: string, password: string) =>
  invoke<void>('reset_user_password', { userId, password });
export const saveApiKey = (apiKey: string) => invoke<void>('save_api_key', { apiKey });
export const getCredentialStatus = () => invoke<boolean>('credential_status');

export function setActiveUser(user: SessionUser | null): void {
  if (user) sessionStorage.setItem('logicguard_user_id', user.id);
  else sessionStorage.removeItem('logicguard_user_id');
}

export function scopedStorageKey(name: string): string {
  return `${name}_${sessionStorage.getItem('logicguard_user_id') ?? 'anonymous'}`;
}
