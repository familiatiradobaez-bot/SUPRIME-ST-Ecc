import { useState, useEffect } from 'react';

export function VerifyEmailPage() {
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setStatus('error');
      setError('Token de verificación no proporcionado');
      return;
    }

    const verifyEmail = async () => {
      try {
        const config = (window as any).__APP_CONFIG__;
        const apiUrl = config?.API_URL || `${window.location.protocol}//${window.location.hostname}:8789/api/v1`;

        const response = await fetch(`${apiUrl}/auth/verify-email?token=${token}`, {
          credentials: 'include',
        });

        if (response.ok) {
          setStatus('success');
        } else {
          const data = await response.json();
          setStatus('error');
          setError(data.message || 'Token inválido o expirado');
        }
      } catch (err) {
        setStatus('error');
        setError('Error de conexión');
      }
    };

    verifyEmail();
  }, []);

  const handleResend = async () => {
    setResending(true);
    try {
      const config = (window as any).__APP_CONFIG__;
      const apiUrl = config?.API_URL || `${window.location.protocol}//${window.location.hostname}:8789/api/v1`;

      const response = await fetch(`${apiUrl}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '' }),
        credentials: 'include',
      });

      if (response.ok) {
        alert('Correo de verificación enviado. Revisa tu bandeja de entrada.');
      } else {
        alert('No se pudo reenviar el correo. Intenta más tarde.');
      }
    } catch (err) {
      alert('Error de conexión');
    } finally {
      setResending(false);
    }
  };

  const goToStore = () => {
    window.location.href = '/';
  };

  return (
    <div className="verify-email-page">
      <div className="verify-email-card">
        {status === 'verifying' && (
          <>
            <div className="spinner"></div>
            <h1>Verificando tu correo...</h1>
            <p>Por favor espera mientras verificamos tu dirección de correo electrónico.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="success-icon">✓</div>
            <h1>¡Correo verificado!</h1>
            <p>Tu correo electrónico ha sido verificado correctamente.</p>
            <button className="btn btn-primary" onClick={goToStore}>
              Ir a la tienda
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="error-icon">✕</div>
            <h1>Error de verificación</h1>
            <p>{error}</p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={handleResend} disabled={resending}>
                {resending ? 'Enviando...' : 'Reenviar correo'}
              </button>
              <button className="btn btn-primary" onClick={goToStore}>
                Volver a la tienda
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
