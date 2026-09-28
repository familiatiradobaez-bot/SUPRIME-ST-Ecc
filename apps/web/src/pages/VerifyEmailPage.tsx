import { useState, useEffect } from 'react';
import { useApiUrl } from '../hooks/useApiUrl';

export function VerifyEmailPage() {
  const apiUrl = useApiUrl();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState('');
  const [resending, setResending] = useState(false);
  const [emailInput, setEmailInput] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const emailParam = params.get('email');
    if (emailParam) setEmailInput(emailParam);

    if (!token) {
      setStatus('error');
      setError('Token de verificación no proporcionado');
      return;
    }

    const verifyEmail = async () => {
      try {
        const response = await fetch(`${apiUrl}/auth/verify-email?token=${token}`, {
          credentials: 'include',
        });

        if (response.ok) {
          setStatus('success');
        } else {
          const data = await response.json().catch(() => ({}));
          setStatus('error');
          setError(data.message || 'Token inválido o expirado');
        }
      } catch (err) {
        setStatus('error');
        setError('Error de conexión con el servidor');
      }
    };

    verifyEmail();
  }, [apiUrl]);

  const handleResend = async () => {
    const emailToSend = emailInput || prompt('Introduce tu correo electrónico para reenviar el enlace:');
    if (!emailToSend) return;

    setResending(true);
    try {
      const response = await fetch(`${apiUrl}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToSend }),
        credentials: 'include',
      });

      if (response.ok) {
        alert('Correo de verificación enviado. Revisa tu bandeja de entrada.');
      } else {
        const data = await response.json().catch(() => ({}));
        alert(data.message || 'No se pudo reenviar el correo. Verifica el email e intenta más tarde.');
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
