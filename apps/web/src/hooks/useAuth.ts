import { useState, useCallback, useEffect } from 'react';
import type { User, Session } from '../types';
import { useApiUrl } from './useApiUrl';
import { getAuthHeaders } from '../lib/api';

// Decode token to get user role (token format: base64(userId:role:timestamp))
function decodeTokenRole(token: string): string | null {
  try {
    const decoded = atob(token);
    const parts = decoded.split(':');
    return parts[1] || null;
  } catch {
    return null;
  }
}

// Check if user has admin access
function hasAdminAccess(roleId: string | null): boolean {
  if (!roleId) return false;
  const adminRoles = ['role-admin', 'role-owner', 'role-stock-manager'];
  return adminRoles.includes(roleId);
}

export function useAuth() {
  const apiUrl = useApiUrl();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loginMode, setLoginMode] = useState<'login' | 'register'>('login');
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedSession = localStorage.getItem('su_prime_session');
    const savedUser = localStorage.getItem('su_prime_user');
    if (savedSession && savedUser) {
      try {
        const sessionData = JSON.parse(savedSession);
        const userData = JSON.parse(savedUser);
        if (sessionData.expires_at && new Date(sessionData.expires_at) > new Date()) {
          setSession(sessionData);
          setUser(userData);
          // Cargar datos de envío desde la API
          fetch(`${apiUrl}/auth/me`, {
            headers: { 'Authorization': `Bearer ${sessionData.token}` },
          })
            .then(r => r.json())
            .then(payload => {
              if (payload.data?.shipping) {
                setUser(prev => prev ? { ...prev, shipping: payload.data.shipping } : prev);
              }
            })
            .catch(() => {});
        } else {
          localStorage.removeItem('su_prime_session');
          localStorage.removeItem('su_prime_user');
        }
      } catch {
        localStorage.removeItem('su_prime_session');
        localStorage.removeItem('su_prime_user');
      }
    }
  }, [apiUrl]);

  const handleLogin = useCallback(async (email: string, password: string, extra?: { username: string; display_name: string }) => {
    setActionLoading(true);
    setActionError('');
    try {
      const url = loginMode === 'register' ? `${apiUrl}/auth/register` : `${apiUrl}/auth/login`;
      const body = loginMode === 'register'
        ? { email, password, username: extra?.username, display_name: extra?.display_name }
        : { email, password };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json();

      if (!response.ok) {
        const errorMsg = payload.error === 'INVALID_CREDENTIALS'
          ? 'Credenciales incorrectas'
          : payload.error === 'USER_ALREADY_EXISTS'
            ? 'El usuario ya existe'
            : payload.error === 'INVALID_INPUT'
              ? 'Datos inválidos'
              : 'Error del servidor';
        throw new Error(errorMsg);
      }

      const { user: userData, session: sessionData } = payload.data;
      setUser(userData);
      setSession(sessionData);
      localStorage.setItem('su_prime_session', JSON.stringify(sessionData));
      localStorage.setItem('su_prime_user', JSON.stringify(userData));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setActionLoading(false);
    }
  }, [apiUrl, loginMode]);

  const handleLogout = useCallback(async () => {
    if (session) {
      try {
        await fetch(`${apiUrl}/auth/logout`, {
          method: 'POST',
          headers: getAuthHeaders(session),
        });
      } catch {
        // Ignore logout errors
      }
    }
    setUser(null);
    setSession(null);
    localStorage.removeItem('su_prime_session');
    localStorage.removeItem('su_prime_user');
  }, [apiUrl, session]);

  const saveShipping = useCallback(async (data: { full_name: string; phone: string; address: string; city: string; postal_code: string }) => {
    if (!session) throw new Error('No session');
    const response = await fetch(`${apiUrl}/auth/me/shipping`, {
      method: 'PUT',
      headers: getAuthHeaders(session),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Error al guardar');
    setUser(prev => prev ? { ...prev, shipping: { ...data, country: 'España' } } : prev);
  }, [apiUrl, session]);

  return {
    user,
    session,
    loginMode,
    actionError,
    actionLoading,
    setLoginMode,
    setActionError,
    setActionLoading,
    handleLogin,
    handleLogout,
    saveShipping,
    decodeTokenRole,
    hasAdminAccess,
  };
}
