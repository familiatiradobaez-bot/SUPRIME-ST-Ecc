import { useState, useEffect } from 'react';

type PasswordResetFormProps = {
  apiUrl: string;
  onDone: () => void;
  onBack: () => void;
};

// Paso 1: email -> envía OTP. Paso 2: código + nueva contraseña.
export function PasswordResetForm({ apiUrl, onDone, onBack }: PasswordResetFormProps) {
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo enviar el código');
      setStep('reset');
      setCooldown(60);
      setInfo('Si la cuenta existe, recibirás un código válido por 15 minutos.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!/^\d{6}$/.test(code)) {
      setError('Introduce el código de 6 dígitos');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword: password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'No se pudo restablecer');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'reset') {
    return (
      <form onSubmit={handleReset} className="form">
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Introduce el código enviado a <strong>{email}</strong> y tu nueva contraseña.
        </p>
        {error && <p className="error" style={{ color: '#a3422b', marginBottom: '1rem' }}>{error}</p>}
        {info && <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{info}</p>}
        <div className="form-group">
          <label>Código (6 dígitos)</label>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            autoFocus
            style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5rem' }}
          />
        </div>
        <div className="form-group">
          <label>Nueva contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 + mayúscula, número y símbolo"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-glow" disabled={loading || code.length !== 6}>
            {loading ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onBack} disabled={loading}>Atrás</button>
        </div>
        <p className="form-text" style={{ textAlign: 'center' }}>
          {cooldown > 0 ? `Reenviar en ${cooldown}s` : <a href="#r" onClick={(e) => { e.preventDefault(); setStep('email'); }} style={{ color: '#c65d35', cursor: 'pointer' }}>Reenviar código</a>}
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={handleSend} className="form">
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
        Te enviaremos un código de 6 dígitos (15 min) para restablecer tu contraseña.
      </p>
      {error && <p className="error" style={{ color: '#a3422b', marginBottom: '1rem' }}>{error}</p>}
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
      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-glow" disabled={loading}>
          {loading ? 'Enviando...' : 'Enviar código'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={loading}>Atrás</button>
      </div>
    </form>
  );
}
