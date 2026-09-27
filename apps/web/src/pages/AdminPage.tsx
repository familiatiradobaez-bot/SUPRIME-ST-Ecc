import { useState, useEffect } from 'react';
import type { User } from '../types';

type AdminStats = {
  products: number;
  orders: number;
  users: number;
  revenue: number;
};

type AdminProduct = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  price_cents: number;
  stock_quantity: number;
  status: string;
};

type AdminPageProps = {
  user: User;
  sessionToken: string;
  apiUrl: string;
  onBack: () => void;
};

export function AdminPage({ user, sessionToken, apiUrl, onBack }: AdminPageProps) {
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'orders' | 'products' | 'settings'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);

  // Product form state
  const [productName, setProductName] = useState('');
  const [productDesc, setProductDesc] = useState('');
  const [productImage, setProductImage] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productStock, setProductStock] = useState('');

  useEffect(() => {
    fetchStats();
    if (activeTab === 'products') fetchProducts();
    if (activeTab === 'users') fetchUsers();
  }, [activeTab]);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/stats`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.data) setStats(data.data);
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/catalog/products`);
      const data = await res.json();
      if (data.data) setProducts(data.data);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/users`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.data) setUsers(data.data);
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const [users, setUsers] = useState<any[]>([]);

  const createProduct = async () => {
    try {
      const res = await fetch(`${apiUrl}/admin/products`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: productName,
          description: productDesc,
          image_url: productImage,
          price_cents: Math.round(parseFloat(productPrice) * 100),
          stock_quantity: parseInt(productStock),
        }),
      });
      const data = await res.json();
      if (data.data) {
        setShowProductForm(false);
        resetProductForm();
        fetchProducts();
        fetchStats();
      } else {
        alert('Error: ' + (data.error || 'unknown'));
      }
    } catch (err) {
      alert('Error creating product');
    }
  };

  const updateProduct = async () => {
    if (!editingProduct) return;
    try {
      const res = await fetch(`${apiUrl}/admin/products/${editingProduct.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: productName || editingProduct.name,
          description: productDesc || editingProduct.description,
          image_url: productImage,
          price_cents: Math.round(parseFloat(productPrice) * 100),
          stock_quantity: parseInt(productStock),
        }),
      });
      const data = await res.json();
      if (data.data) {
        setEditingProduct(null);
        resetProductForm();
        fetchProducts();
        fetchStats();
      } else {
        alert('Error: ' + (data.error || 'unknown'));
      }
    } catch (err) {
      alert('Error updating product');
    }
  };

  const deleteProduct = async (productId: string) => {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return;
    try {
      const res = await fetch(`${apiUrl}/admin/products/${productId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${sessionToken}` },
      });
      if (res.ok) {
        fetchProducts();
        fetchStats();
      }
    } catch (err) {
      alert('Error deleting product');
    }
  };

  const resetProductForm = () => {
    setProductName('');
    setProductDesc('');
    setProductImage('');
    setProductPrice('');
    setProductStock('');
  };

  const startEditProduct = (product: AdminProduct) => {
    setEditingProduct(product);
    setProductName(product.name);
    setProductDesc(product.description);
    setProductImage(product.image_url);
    setProductPrice((product.price_cents / 100).toFixed(2));
    setProductStock(product.stock_quantity.toString());
  };

  const tabs = [
    { id: 'stats', label: '📊 Dashboard' },
    { id: 'products', label: '📦 Productos' },
    { id: 'users', label: '👥 Usuarios' },
    { id: 'orders', label: '📋 Órdenes' },
    { id: 'settings', label: '⚙️ Configuración' },
  ];

  return (
    <div className="admin-page" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: '#f8f9fa', zIndex: 9999, overflowY: 'auto' }}>
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

        {/* DASHBOARD TAB */}
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

        {/* PRODUCTS TAB */}
        {activeTab === 'products' && (
          <div className="admin-products">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>Gestión de Productos</h2>
              <button className="btn btn-primary" onClick={() => { setShowProductForm(true); setEditingProduct(null); resetProductForm(); }}>
                ➕ Nuevo Producto
              </button>
            </div>

            {showProductForm && (
              <div className="admin-product-form">
                <h3>{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</h3>
                <div className="form-group">
                  <label>Nombre:</label>
                  <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Nombre del producto" />
                </div>
                <div className="form-group">
                  <label>Descripción:</label>
                  <textarea value={productDesc} onChange={(e) => setProductDesc(e.target.value)} placeholder="Descripción del producto" />
                </div>
                <div className="form-group">
                  <label>URL de imagen:</label>
                  <input type="url" value={productImage} onChange={(e) => setProductImage(e.target.value)} placeholder="https://ejemplo.com/imagen.jpg" />
                </div>
                <div className="form-group">
                  <label>Precio (€):</label>
                  <input type="number" step="0.01" value={productPrice} onChange={(e) => setProductPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label>Stock:</label>
                  <input type="number" value={productStock} onChange={(e) => setProductStock(e.target.value)} placeholder="0" />
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" onClick={editingProduct ? updateProduct : createProduct}>
                    {editingProduct ? '💾 Guardar' : '➕ Crear'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setShowProductForm(false); setEditingProduct(null); }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Precio</th>
                  <th>Stock</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{(p.price_cents / 100).toFixed(2)}€</td>
                    <td>{p.stock_quantity}</td>
                    <td>{p.status === 'active' ? '✅' : '❌'}</td>
                    <td>
                      <button className="btn btn-sm btn-secondary" onClick={() => startEditProduct(p)}>✏️</button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteProduct(p.id)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div className="admin-users">
            <h2>Gestión de Usuarios</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Estado</th>
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
                        onChange={async (e) => {
                          await fetch(`${apiUrl}/admin/users/${u.id}/role`, {
                            method: 'PUT',
                            headers: {
                              'Authorization': `Bearer ${sessionToken}`,
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ role_id: e.target.value }),
                          });
                          fetchUsers();
                        }}
                        className="role-select"
                      >
                        <option value="role-customer">Customer</option>
                        <option value="role-stock-manager">Stock Manager</option>
                        <option value="role-admin">Admin</option>
                        <option value="role-owner">Owner</option>
                      </select>
                    </td>
                    <td>{u.is_active ? '✅ Activo' : '❌ Inactivo'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ORDERS TAB */}
        {activeTab === 'orders' && (
          <div className="admin-orders">
            <h2>Gestión de Órdenes</h2>
            <p>Las órdenes se mostrarán aquí</p>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="admin-settings">
            <h2>Configuración de la Tienda</h2>
            <p>La configuración de la tienda se mostrará aquí</p>
          </div>
        )}
      </div>
    </div>
  );
}
