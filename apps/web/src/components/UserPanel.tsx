import { useState } from 'react';
import type { User } from '../types';

type UserPanelProps = {
  user: User;
  onClose: () => void;
  onLogout: () => void;
  onSaveShipping: (data: { full_name: string; phone: string; address: string; city: string; postal_code: string }) => Promise<void>;
};

export function UserPanel({ user, onClose, onLogout, onSaveShipping }: UserPanelProps) {
  const [name, setName] = useState(user.shipping?.full_name || '');
  const [phone, setPhone] = useState(user.shipping?.phone || '');
  const [address, setAddress] = useState(user.shipping?.address || '');
  const [city, setCity] = useState(user.shipping?.city || '');
  const [postal, setPostal] = useState(user.shipping?.postal_code || '');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mi Cuenta</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Información de la cuenta</h3>
            <p><strong>Usuario:</strong> {user.username}</p>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Nombre:</strong> {user.display_name}</p>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Vincular cuenta de Google</h3>
            <p style={{ color: '#68736b', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
              Vincula tu cuenta de Google para iniciar sesión más fácilmente
            </p>
            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => alert('Google OAuth - Próximamente')}>
              🔗 Vincular con Google
            </button>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>Datos de envío</h3>
            <p style={{ color: '#68736b', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
              Estos datos se usarán automáticamente en el checkout
            </p>
            <div className="form-group">
              <label>Nombre completo:</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Pérez" />
            </div>
            <div className="form-group">
              <label>Teléfono:</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34 123 456 789" />
            </div>
            <div className="form-group">
              <label>Dirección:</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle Principal 123, Madrid" />
            </div>
            <div className="form-group">
              <label>Ciudad:</label>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Madrid" />
            </div>
            <div className="form-group">
              <label>Código postal:</label>
              <input type="text" value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="28001" />
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={async () => {
              await onSaveShipping({ full_name: name, phone, address, city, postal_code: postal });
              alert('Datos de envío guardados en la nube');
            }}>
              💾 Guardar datos de envío
            </button>
          </div>

          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem' }}>
            <button className="btn btn-secondary" style={{ width: '100%', borderColor: '#a3422b', color: '#a3422b' }} onClick={onLogout}>
              Cerrar Sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
