import { useState, useEffect } from 'react';

type OtpFormProps = {
  email: string;
  onVerify: (code: string) => void;
  onResend?: () => void;
  onBack: () => void;
  loading?: boolean;
  resending?: boolean;
  error?: string;
  title?: string;
  subtitle?: React.ReactNode;
};

export function OtpForm({ email, onVerify, onResend, onBack, loading, resending, error, title, subtitle }: OtpFormProps) {
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    if (!/^\d{6}$/.test(code)) {
      setLocalError('Introduce el código de 6 dígitos');
      return;
    }
    onVerify(code);
  };

  const handleResend = () => {
    if (!onResend) return;
    setCooldown(60);
    onResend();
  };

  return (
    <form onSubmit={handleSubmit} className="form">
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
        {subtitle || (
          <>Enviamos un código de 6 dígitos a <strong>{email}</strong>. Caduca en 15 minutos.
          Sin este paso no podrás acceder a tu cuenta.</>
        )}
      </p>
      {(localError || error) && (
        <p className="error" style={{ marginBottom: '1rem' }}>{localError || error}</p>
      )}
      <div className="form-group">
        <label>Código de verificación</label>
        <input
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          maxLength={6}
          autoComplete="one-time-code"
          className="otp-input"
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-glow" disabled={loading || code.length !== 6}>
          {loading ? 'Verificando...' : 'Verificar'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={loading}>Atrás</button>
      </div>
      <p className="form-text" style={{ textAlign: 'center' }}>
        {onResend ? (
          <>¿No llegó?{' '}
          <a
            href="#resend"
            onClick={(e) => { e.preventDefault(); if (cooldown <= 0 && !resending) handleResend(); }}
            style={{ color: 'var(--accent)', cursor: cooldown > 0 ? 'not-allowed' : 'pointer', opacity: cooldown > 0 ? 0.6 : 1 }}
          >
            {resending ? 'Enviando...' : cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Reenviar código'}
          </a></>
        ) : (
          <>Abre tu app de autenticación (Google Authenticator, Authy) y usa el código actual de SUPRIME.</>
        )}
      </p>
    </form>
  );
}
