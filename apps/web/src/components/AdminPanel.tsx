import { useState, useEffect } from 'react';

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

type AdminPanelProps = {
  onClose: () => void;
  authToken: string;
  apiUrl: string;
};

export function AdminPanel({ onClose, authToken, apiUrl }: AdminPanelProps) {
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
        headers: { 'Authorization': `Bearer ${authToken}` },
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
        headers: { 'Authorization': `Bearer ${authToken}` },
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
          'Authorization': `Bearer ${authToken}`,
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
    { id: 'stats', label: '📊 Dashboard', icon: '📊' },
    { id: 'users', label: '👥 Usuarios', icon: '👥' },
    { id: 'orders', label: '📦 Órdenes', icon: '📦' },
    { id: 'settings', label: '⚙️ Configuración', icon: '⚙️' },
  ];

  return (
    <div className="modal-overlay anim-modal-overlay" onClick={onClose}>
      <div className="modal admin-panel anim-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Panel de Administración</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
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
                  {users.map(user => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.email}</td>
                      <td>
                        <select
                          value={user.role_id}
                          onChange={(e) => updateUserRole(user.id, e.target.value)}
                          className="role-select"
                        >
                          <option value="role-customer">Customer</option>
                          <option value="role-stock-manager">Stock Manager</option>
                          <option value="role-admin">Admin</option>
                          <option value="role-owner">Owner</option>
                        </select>
                      </td>
                      <td>{user.is_active ? '✅ Activo' : '❌ Inactivo'}</td>
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
    </div>
  );
}
