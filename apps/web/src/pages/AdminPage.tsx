import { useState, useEffect } from 'react';
import type { User } from '../types';

type AdminStats = {
  products: number;
  orders: number;
  users: number;
  revenue: number;
};

type AdminUser = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role_id: string;
  is_active: number;
  created_at: string;
};

type AdminPageProps = {
  user: User;
  sessionToken: string;
  apiUrl: string;
  onBack: () => void;
};

export function AdminPage({ user, sessionToken, apiUrl, onBack }: AdminPageProps) {
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'orders' | 'settings'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchStats();
    if (activeTab === 'users') fetchUsers();
  }, [activeTab]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/admin/stats`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.data) setStats(data.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/admin/users`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.data) setUsers(data.data);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateUserRole = async (userId: string, newRole: string) => {
    try {
      await fetch(`${apiUrl}/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role_id: newRole }),
      });
      fetchUsers();
    } catch (err) {
      console.error('Error updating role:', err);
    }
  };

  const tabs = [
    { id: 'stats', label: '📊 Dashboard' },
    { id: 'users', label: '👥 Usuarios' },
    { id: 'orders', label: '📦 Órdenes' },
    { id: 'settings', label: '⚙️ Configuración' },
  ];

  return (
    <div className="admin-page">
      <div className="admin-header">
        <button className="btn btn-secondary" onClick={onBack}>← Volver a la tienda</button>
        <h1>Panel de Administración</h1>
        <div className="admin-user-info">
          <span>👤 {user.display_name || user.username}</span>
          <span className="admin-role-badge">{user.role_id.replace('role-', '')}</span>
        </div>
      </div>

      <div className="admin-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id as any)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="admin-content">
        {loading && <div className="loading"><div className="spinner"></div></div>}

        {activeTab === 'stats' && stats && (
          <div className="admin-stats">
            <div className="stat-card">
              <div className="stat-value">{stats.products}</div>
              <div className="stat-label">Productos</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.orders}</div>
              <div className="stat-label">Órdenes</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.users}</div>
              <div className="stat-label">Usuarios</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{(stats.revenue / 100).toFixed(2)}€</div>
              <div className="stat-label">Ingresos</div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="admin-users">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        value={u.role_id}
                        onChange={(e) => updateUserRole(u.id, e.target.value)}
                        className="role-select"
                      >
                        <option value="role-customer">Customer</option>
                        <option value="role-stock-manager">Stock Manager</option>
                        <option value="role-admin">Admin</option>
                        <option value="role-owner">Owner</option>
                      </select>
                    </td>
                    <td>{u.is_active ? '✅ Activo' : '❌ Inactivo'}</td>
                    <td>
                      <button className="btn btn-sm">Ver</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="admin-orders">
            <p>Las órdenes se mostrarán aquí</p>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="admin-settings">
            <p>La configuración de la tienda se mostrará aquí</p>
          </div>
        )}
      </div>
    </div>
  );
}
