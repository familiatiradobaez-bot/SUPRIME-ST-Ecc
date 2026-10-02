import { useState, useEffect } from 'react';
import type { LastAccount } from '../hooks/useAuth';

type LoginFormProps = {
  onSubmit: (email: string, password: string, extra?: { username?: string; display_name?: string; rememberMe?: boolean; terms?: boolean }) => void;
  onCancel: () => void;
  mode: 'login' | 'register';
  onToggleMode: () => void;
  loading?: boolean;
  apiUrl: string;
  onForgotPassword?: () => void;
  lastAccount?: LastAccount | null;
  passkeySupported?: boolean;
  onPasskey?: () => void;
  onTrustedDevice?: () => void;
  passkeyLoading?: boolean;
};

export function LoginForm({ onSubmit, onCancel, mode, onToggleMode, loading, apiUrl, onForgotPassword, lastAccount, passkeySupported, onPasskey, onTrustedDevice, passkeyLoading }: LoginFormProps) {
  const [email, setEmail] = useState(lastAccount?.email ?? '');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [trustDevice, setTrustDevice] = useState(true);
  const [trustedAttempted, setTrustedAttempted] = useState(false);

  // Dispositivo de confianza: al abrir el login se intenta una vez. Si la
  // cookie no está o caducó, el formulario sigue igual (nada se rompe).
  useEffect(() => {
    if (mode !== 'login' || !onTrustedDevice || trustedAttempted) return;
    setTrustedAttempted(true);
    onTrustedDevice();
  }, [mode, onTrustedDevice, trustedAttempted]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register') {
      if (password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres');
        return;
      }
      if (username.length < 3) {
        setError('El username debe tener al menos 3 caracteres');
        return;
      }
      if (!termsAccepted) {
        setError('Debes aceptar los Términos y la Privacidad');
        return;
      }
      onSubmit(email, password, { username, display_name: displayName || username, terms: true });
    } else {
      onSubmit(email, password, rememberMe ? { rememberMe } : undefined);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="form auth-card">
      {error && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}
      {mode === 'login' && lastAccount && email !== lastAccount.email && (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%', marginBottom: '1rem' }}
          onClick={() => setEmail(lastAccount.email)}
        >
          ↩️ Última cuenta: {lastAccount.display_name} ({lastAccount.email})
        </button>
      )}
      {mode === 'register' && (
        <>
          <div className="form-group">
            <label>Nombre para mostrar:</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Juan Pérez"
            />
          </div>
          <div className="form-group">
            <label>Nombre de usuario:</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="juanperez"
              required
              minLength={3}
            />
          </div>
        </>
      )}
      <div className="form-group">
        <label htmlFor="login-email">Correo Electrónico:</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@correo.com"
          required
          autoComplete="email"
        />
      </div>
      <div className="form-group">
        <label>Contraseña:</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          minLength={mode === 'register' ? 6 : 1}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
        {mode === 'register' && <small style={{ color: 'var(--text-secondary)' }}>Mínimo 6 caracteres</small>}
      </div>
      {mode === 'login' && (
      <div className="form-group remember-me">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <span>Permanecer conectado</span>
        </label>
      </div>
      )}
      {mode === 'register' && (
        <div className="form-group remember-me">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              required
            />
            <span>Acepto los <a href="/terminos" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)' }}>Términos</a> y la <a href="/privacidad" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)' }}>Privacidad</a></span>
          </label>
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-glow btn-truck-drive" disabled={loading} data-testid="login-submit">
          {loading ? (
            <>
              <span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderTopColor: 'white' }}></span>
              Procesando...
            </>
          ) : (
            mode === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'
          )}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>Cancelar</button>
      </div>

      {/* ── Passkeys: huella / FaceID / seguridad del dispositivo ── */}
      {mode === 'login' && passkeySupported && (
        <>
          <div className="auth-divider"><span>o entra con tu huella</span></div>
          <div className="form-group" style={{ margin: '0 0 0.5rem' }}>
            <button
              type="button"
              className="btn btn-passkey"
              style={{ width: '100%' }}
              disabled={passkeyLoading || loading}
              onClick={() => onPasskey?.()}
              data-testid="login-passkey"
            >
              {passkeyLoading ? '⏳ Esperando tu huella…' : '👆 Entrar con passkey'}
            </button>
            <small style={{ display: 'block', textAlign: 'center', color: 'var(--text-secondary)', marginTop: '6px' }}>
              Usa FaceID, la huella o el PIN de tu dispositivo (iPhone, Android o PC). Sin escribir contraseña.
            </small>
          </div>
          <div className="form-group remember-me">
            <label className="checkbox-label">
              <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
              <span>Recordar este dispositivo (entra solo durante 30 días)</span>
            </label>
          </div>
        </>
      )}

      <div className="form-group" style={{ textAlign: 'center', margin: '1rem 0' }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => {
            window.location.href = `${apiUrl}/auth/google/login`;
          }}
        >
          🔵 Iniciar sesión con Google
        </button>
      </div>

      <p className="form-text">
        {mode === 'login' ? (
          <>¿No tienes cuenta? <a href="#signup" onClick={(e) => { e.preventDefault(); onToggleMode(); setError(''); }} style={{ color: 'var(--accent)', cursor: 'pointer' }}>Regístrate aquí</a></>
        ) : (
          <>¿Ya tienes cuenta? <a href="#login" onClick={(e) => { e.preventDefault(); onToggleMode(); setError(''); }} style={{ color: 'var(--accent)', cursor: 'pointer' }}>Inicia sesión</a></>
        )}
      </p>
      {mode === 'login' && onForgotPassword && (
        <p className="form-text" style={{ textAlign: 'center' }}>
          <a href="#forgot" onClick={(e) => { e.preventDefault(); onForgotPassword(); }} style={{ color: 'var(--accent)', cursor: 'pointer' }}>¿Olvidaste tu contraseña?</a>
        </p>
      )}
    </form>
  );
}
