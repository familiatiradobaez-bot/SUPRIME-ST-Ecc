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

  // Restore session from cookie on mount
  useEffect(() => {
    const getCookie = (name: string): string | null => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
      return null;
    };

    const token = getCookie('session_token');
    if (token) {
      fetch(`${apiUrl}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      })
        .then(r => r.json())
        .then(payload => {
          if (payload.data) {
            setUser(payload.data);
            setSession({ id: token, token, expires_at: String(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60) });
          }
        })
        .catch(() => {});
    }
  }, [apiUrl]);

  const handleLogin = useCallback(async (email: string, password: string, extra?: { username?: string; display_name?: string; rememberMe?: boolean }) => {
    setActionLoading(true);
    setActionError('');
    try {
      const url = loginMode === 'register' ? `${apiUrl}/auth/register` : `${apiUrl}/auth/login`;
      const body = loginMode === 'register'
        ? { email, password, username: extra?.username, display_name: extra?.display_name }
        : { email, password, rememberMe: extra?.rememberMe };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });

      const payload = await response.json();

      if (!response.ok) {
        const errorMsg = payload.error === 'INVALID_CREDENTIALS'
          ? 'Credenciales incorrectas'
          : payload.error === 'USER_ALREADY_EXISTS'
            ? 'El usuario ya existe'
            : payload.error === 'INVALID_INPUT'
              ? 'Datos inválidos'
              : payload.error === 'RATE_LIMIT_EXCEEDED'
                ? 'Demasiados intentos. Intenta más tarde.'
                : payload.error === 'EMAIL_NOT_VERIFIED'
                  ? 'Debes verificar tu correo electrónico'
                  : 'Error del servidor';
        throw new Error(errorMsg);
      }

      const { user: userData, session: sessionData } = payload.data;
      setUser(userData);
      setSession(sessionData);
      // Cargar datos de envío al iniciar sesión
      fetch(`${apiUrl}/auth/me`, {
        headers: { 'Authorization': `Bearer ${sessionData.token}` },
        credentials: 'include',
      })
        .then(r => r.json())
        .then(meData => {
          if (meData.data?.shipping) {
            setUser(prev => prev ? { ...prev, shipping: meData.data.shipping } : prev);
          }
        })
        .catch(() => {});
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
          credentials: 'include',
        });
      } catch {
        // Ignore logout errors
      }
    }
    setUser(null);
    setSession(null);
    // Clear cookie
    document.cookie = 'session_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
  }, [apiUrl, session]);

  const saveShipping = useCallback(async (data: { full_name: string; phone: string; address: string; city: string; postal_code: string }) => {
    if (!session) throw new Error('No session');
    const response = await fetch(`${apiUrl}/auth/me/shipping`, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(session),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      credentials: 'include',
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
    setUser,
    setSession,
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
