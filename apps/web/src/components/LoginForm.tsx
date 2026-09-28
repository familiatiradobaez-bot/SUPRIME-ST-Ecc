import { useState } from 'react';

type LoginFormProps = {
  onSubmit: (email: string, password: string, extra?: { username?: string; display_name?: string; rememberMe?: boolean }) => void;
  onCancel: () => void;
  mode: 'login' | 'register';
  onToggleMode: () => void;
  loading?: boolean;
  apiUrl: string;
};

export function LoginForm({ onSubmit, onCancel, mode, onToggleMode, loading, apiUrl }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

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
      onSubmit(email, password, { username, display_name: displayName || username });
    } else {
      onSubmit(email, password, rememberMe ? { rememberMe } : undefined);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      {error && <p className="error" style={{ color: '#a3422b', marginBottom: '1rem' }}>{error}</p>}
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
        <label>Correo Electrónico:</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@correo.com"
          required
          autoFocus
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
        {mode === 'register' && <small style={{ color: '#68736b' }}>Mínimo 6 caracteres</small>}
      </div>
      <div className="form-group remember-me">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            disabled={mode === 'register'}
          />
          <span>Permanecer conectado</span>
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-glow btn-truck-drive" disabled={loading}>
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
          <>¿No tienes cuenta? <a href="#signup" onClick={(e) => { e.preventDefault(); onToggleMode(); setError(''); }} style={{ color: '#c65d35', cursor: 'pointer' }}>Regístrate aquí</a></>
        ) : (
          <>¿Ya tienes cuenta? <a href="#login" onClick={(e) => { e.preventDefault(); onToggleMode(); setError(''); }} style={{ color: '#c65d35', cursor: 'pointer' }}>Inicia sesión</a></>
        )}
      </p>
    </form>
  );
}
