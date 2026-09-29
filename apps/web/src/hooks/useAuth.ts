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

const SESSION_STORAGE_KEY = 'suprime_session';
const LAST_ACCOUNT_KEY = 'suprime_last_account';

export type LastAccount = { email: string; display_name: string };

function loadLastAccount(): LastAccount | null {
  try {
    const saved = localStorage.getItem(LAST_ACCOUNT_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (typeof parsed?.email === 'string' && parsed.email.includes('@')) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const apiUrl = useApiUrl();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loginMode, setLoginMode] = useState<'login' | 'register'>('login');
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  // Email pendiente de verificación OTP (tras registro)
  const [pendingOtpEmail, setPendingOtpEmail] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpResending, setOtpResending] = useState(false);
  const [otpError, setOtpError] = useState('');
  // Última cuenta usada en este dispositivo (reconexión rápida: pre-rellena el email)
  const [lastAccount, setLastAccount] = useState<LastAccount | null>(loadLastAccount);

  const rememberLastAccount = useCallback((email: string, display_name: string) => {
    const entry = { email, display_name: display_name || email };
    setLastAccount(entry);
    try {
      localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(entry));
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Persistencia: rememberMe -> localStorage (30 días), si no -> sessionStorage (cierra al cerrar pestaña).
  // (La cookie HttpOnly del servidor no es legible cross-subdominio, por eso se guarda el token aquí.)
  const persistSession = useCallback((token: string, expires_at: string | number, remember: boolean) => {
    const value = JSON.stringify({ token, expires_at: String(expires_at) });
    try {
      if (remember) {
        localStorage.setItem(SESSION_STORAGE_KEY, value);
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } else {
        sessionStorage.setItem(SESSION_STORAGE_KEY, value);
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const clearPersistedSession = useCallback(() => {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Restore session on mount (valida contra /auth/me, que comprueba expiración en DB)
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      saved = null;
    }
    if (!saved) return;

    let parsed: { token: string; expires_at: string } | null = null;
    try {
      parsed = JSON.parse(saved);
    } catch {
      parsed = null;
    }
    if (!parsed?.token) return;

    // Expiración local rápida (la DB tiene la última palabra vía /auth/me)
    if (parsed.expires_at && Number(parsed.expires_at) * 1000 < Date.now()) {
      clearPersistedSession();
      return;
    }

    fetch(`${apiUrl}/auth/me`, {
      headers: { 'Authorization': `Bearer ${parsed.token}` },
      credentials: 'include',
    })
      .then(r => r.json())
      .then(payload => {
        if (payload.data) {
          setUser(payload.data);
          setSession({ id: parsed.token, token: parsed.token, expires_at: parsed.expires_at });
        } else {
          clearPersistedSession();
        }
      })
      .catch(() => {});
  }, [apiUrl, clearPersistedSession]);

  const handleLogin = useCallback(async (email: string, password: string, extra?: { username?: string; display_name?: string; rememberMe?: boolean; terms?: boolean }) => {
    setActionLoading(true);
    setActionError('');
    try {
      const url = loginMode === 'register' ? `${apiUrl}/auth/register` : `${apiUrl}/auth/login`;
      const body = loginMode === 'register'
        ? { email, password, username: extra?.username, display_name: extra?.display_name, terms: extra?.terms === true }
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
                  ? 'Debes verificar tu correo con el código OTP. Regístrate de nuevo o pide un código.'
                  : 'Error del servidor';
        throw new Error(errorMsg);
      }

      // Registro: no hay sesión, hay que verificar el OTP primero
      if (loginMode === 'register') {
        if (payload.data?.verificationRequired && payload.data?.email) {
          setPendingOtpEmail(payload.data.email);
          setOtpError('');
          return;
        }
        throw new Error('Respuesta inesperada del servidor');
      }

      const { user: userData, session: sessionData } = payload.data;
      setUser(userData);
      setSession(sessionData);
      // Persistir sesión: rememberMe -> localStorage, si no -> sessionStorage
      persistSession(sessionData.token, sessionData.expires_at, extra?.rememberMe === true);
      rememberLastAccount(userData.email, userData.display_name || userData.username);
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
  }, [apiUrl, loginMode, persistSession, rememberLastAccount]);

  const handleVerifyOtp = useCallback(async (code: string) => {
    if (!pendingOtpEmail) return;
    setOtpLoading(true);
    setOtpError('');
    try {
      const response = await fetch(`${apiUrl}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingOtpEmail, code }),
        credentials: 'include',
      });
      const payload = await response.json();
      if (!response.ok) {
        const msg = payload.error === 'OTP_INVALID'
          ? payload.message || 'Código incorrecto'
          : payload.error === 'OTP_EXPIRED'
            ? 'Código caducado. Pide uno nuevo.'
            : payload.error === 'OTP_LOCKED'
              ? 'Demasiados intentos. Pide un código nuevo.'
              : payload.error === 'OTP_NOT_FOUND'
                ? 'No hay código pendiente para este correo.'
                : payload.message || 'Error al verificar';
        throw new Error(msg);
      }
      // Auto-login tras verificar
      const { user: userData, session: sessionData } = payload.data;
      setUser(userData);
      setSession(sessionData);
      persistSession(sessionData.token, sessionData.expires_at, false);
      rememberLastAccount(userData.email, userData.display_name || userData.username);
      setPendingOtpEmail(null);
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setOtpLoading(false);
    }
  }, [apiUrl, pendingOtpEmail, persistSession, rememberLastAccount]);

  const handleResendOtp = useCallback(async () => {
    if (!pendingOtpEmail) return;
    setOtpResending(true);
    setOtpError('');
    try {
      const response = await fetch(`${apiUrl}/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingOtpEmail }),
        credentials: 'include',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || 'No se pudo reenviar el código');
      }
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setOtpResending(false);
    }
  }, [apiUrl, pendingOtpEmail]);

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
    clearPersistedSession();
    // Clear cookie
    document.cookie = 'session_token=; Path=/; Max-Age=0';
  }, [apiUrl, session, clearPersistedSession]);

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
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error === 'INVALID_INPUT' ? 'Revisa los datos: nombre, teléfono (9-15 dígitos), dirección, ciudad y CP (5 dígitos).' : 'Error al guardar');
    }
    setUser(prev => prev ? { ...prev, shipping: { ...data, country: 'España' } } : prev);
  }, [apiUrl, session]);

  // El nombre visible se puede cambiar; el username es inmutable (identidad en BD).
  const saveProfile = useCallback(async (display_name: string) => {
    if (!session) throw new Error('No session');
    const response = await fetch(`${apiUrl}/auth/me`, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(session),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ display_name }),
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Error al guardar el nombre');
    const payload = await response.json();
    if (payload.data) setUser(prev => prev ? { ...prev, display_name: payload.data.display_name } : prev);
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
    saveProfile,
    persistSession,
    clearPersistedSession,
    pendingOtpEmail,
    otpLoading,
    otpResending,
    otpError,
    setPendingOtpEmail,
    setOtpError,
    handleVerifyOtp,
    handleResendOtp,
    decodeTokenRole,
    hasAdminAccess,
    lastAccount,
    rememberLastAccount,
  };
}
