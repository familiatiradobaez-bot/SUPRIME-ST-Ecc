import { useEffect, useState } from 'react';

export type CatalogSubdepartment = {
  id: string;
  department_id: string;
  name: string;
  slug: string;
  product_count: number;
};

export type CatalogDepartment = {
  id: string;
  name: string;
  slug: string;
  is_active: number;
  subdepartment_count: number;
  product_count: number;
  subdepartments: CatalogSubdepartment[];
};

type CatalogManagerProps = {
  apiUrl: string;
  sessionToken: string;
  // Callback para que el formulario de productos tenga la jerarquía fresca.
  onCatalogChange?: (departments: CatalogDepartment[]) => void;
};

type Pending = { label: string; action: 'dept' | 'sub'; id: string } | null;

function errMsg(payload: any, fallback: string): string {
  if (payload?.error === 'SAFETY_LOCKED') {
    return '🔒 Modo seguro activo: desactívalo en Configuración para borrar.';
  }
  if (payload?.error === 'DEPARTMENT_NOT_EMPTY' || payload?.error === 'SUBDEPARTMENT_NOT_EMPTY') {
    return payload.message || 'Tiene productos activos. Arvívalos o muévelos antes de borrarlo.';
  }
  if (payload?.error === 'DUPLICATE_NAME') {
    return payload.message || 'Ya existe un elemento con ese nombre.';
  }
  return payload?.message || payload?.error || fallback;
}

export function CatalogManager({ apiUrl, sessionToken, onCatalogChange }: CatalogManagerProps) {
  const [departments, setDepartments] = useState<CatalogDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState<'ok' | 'err'>('ok');
  const [saving, setSaving] = useState(false);

  // Alta de departamento
  const [deptName, setDeptName] = useState('');
  // Alta de subdepartamento (departamento destino)
  const [subDeptId, setSubDeptId] = useState('');
  const [subName, setSubName] = useState('');
  // Renombrar / mover / activar
  const [editing, setEditing] = useState<Pending>(null);
  const [editName, setEditName] = useState('');
  const [editParent, setEditParent] = useState('');

  const auth = {
    'Authorization': `Bearer ${sessionToken}`,
    'Content-Type': 'application/json',
  };

  const load = async (notifyParent = true) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/admin/catalog`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(payload.data)) {
        setDepartments(payload.data);
        if (notifyParent) onCatalogChange?.(payload.data);
      } else {
        setMsgKind('err');
        setMsg(errMsg(payload, 'No se pudo cargar el catálogo'));
      }
    } catch {
      setMsgKind('err');
      setMsg('Error de conexión al cargar el catálogo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, sessionToken]);

  const notify = (text: string, kind: 'ok' | 'err' = 'ok') => {
    setMsg(text);
    setMsgKind(kind);
    if (kind === 'ok') {
      window.setTimeout(() => setMsg(''), 4000);
    }
  };

  // ── Crear departamento ──────────────────────────────────────────
  const createDepartment = async () => {
    if (!deptName.trim()) return notify('Escribe el nombre del departamento', 'err');
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/admin/departments`, {
        method: 'POST',
        headers: auth,
        credentials: 'include',
        body: JSON.stringify({ name: deptName.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        setDeptName('');
        notify(`Departamento "${payload.data.name}" creado`);
        await load();
      } else {
        notify(errMsg(payload, 'No se pudo crear el departamento'), 'err');
      }
    } catch {
      notify('Error de conexión', 'err');
    } finally {
      setSaving(false);
    }
  };

  // ── Crear subdepartamento ───────────────────────────────────────
  const createSubdepartment = async () => {
    if (!subDeptId) return notify('Elige el departamento destino', 'err');
    if (!subName.trim()) return notify('Escribe el nombre del subdepartamento', 'err');
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/admin/subdepartments`, {
        method: 'POST',
        headers: auth,
        credentials: 'include',
        body: JSON.stringify({ department_id: subDeptId, name: subName.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        setSubName('');
        notify(`Subdepartamento "${payload.data.name}" creado`);
        await load();
      } else {
        notify(errMsg(payload, 'No se pudo crear el subdepartamento'), 'err');
      }
    } catch {
      notify('Error de conexión', 'err');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (kind: 'dept' | 'sub', id: string, name: string, parent?: string) => {
    setEditing({ label: name, action: kind, id });
    setEditName(name);
    setEditParent(parent || '');
  };

  // ── Guardar edición (nombre y/o departamento padre) ─────────────
  const saveEdit = async () => {
    if (!editing || !editName.trim()) return;
    setSaving(true);
    const isDept = editing.action === 'dept';
    const body: Record<string, unknown> = { name: editName.trim() };
    if (!isDept && editParent) body.department_id = editParent;

    try {
      const res = await fetch(
        `${apiUrl}/admin/${isDept ? 'departments' : 'subdepartments'}/${editing.id}`,
        { method: 'PUT', headers: auth, credentials: 'include', body: JSON.stringify(body) }
      );
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        setEditing(null);
        notify('Guardado');
        await load();
      } else {
        notify(errMsg(payload, 'No se pudo guardar'), 'err');
      }
    } catch {
      notify('Error de conexión', 'err');
    } finally {
      setSaving(false);
    }
  };

  // ── Activar / desactivar departamento ───────────────────────────
  const toggleActive = async (dept: CatalogDepartment) => {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/admin/departments/${dept.id}`, {
        method: 'PUT',
        headers: auth,
        credentials: 'include',
        body: JSON.stringify({ is_active: dept.is_active ? 0 : 1 }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        notify(dept.is_active ? `"${dept.name}" oculto de la tienda` : `"${dept.name}" visible en la tienda`);
        await load();
      } else {
        notify(errMsg(payload, 'No se pudo cambiar el estado'), 'err');
      }
    } catch {
      notify('Error de conexión', 'err');
    } finally {
      setSaving(false);
    }
  };

  // ── Borrar ──────────────────────────────────────────────────────
  const remove = async (kind: 'dept' | 'sub', id: string, name: string) => {
    if (!window.confirm(`¿Borrar "${name}"? Esta acción no se puede deshacer.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/admin/${kind === 'dept' ? 'departments' : 'subdepartments'}/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        notify(`"${name}" borrado`);
        await load();
      } else {
        // 409 con productos vivos o modo seguro: motivo concreto, no genérico.
        notify(errMsg(payload, 'No se pudo borrar'), 'err');
      }
    } catch {
      notify('Error de conexión', 'err');
    } finally {
      setSaving(false);
    }
  };

  const totalSubs = departments.reduce((n, d) => n + d.subdepartments.length, 0);

  return (
    <div className="admin-catalog">
      <div className="admin-catalog-header">
        <div>
          <h2>Departamentos y subdepartamentos</h2>
          <p className="admin-catalog-sub">
            {departments.length} departamento{departments.length === 1 ? '' : 's'} · {totalSubs} subdepartamento{totalSubs === 1 ? '' : 's'}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => load()} disabled={loading}>
          {loading ? '⏳' : '🔄'} Actualizar
        </button>
      </div>

      {msg && (
        <div className={`admin-catalog-msg ${msgKind === 'err' ? 'err' : 'ok'}`} role="status">
          {msg}
        </div>
      )}

      {/* Alta */}
      <div className="admin-catalog-create">
        <div className="admin-catalog-create-card">
          <h3>➕ Nuevo departamento</h3>
          <p className="admin-hint">Agrupación principal de la tienda (Ej.: Electrónica, Hogar).</p>
          <div className="admin-catalog-row">
            <input
              type="text"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="Nombre del departamento"
              maxLength={80}
              aria-label="Nombre del nuevo departamento"
              onKeyDown={(e) => { if (e.key === 'Enter') createDepartment(); }}
            />
            <button className="btn btn-primary" onClick={createDepartment} disabled={saving || !deptName.trim()}>
              Crear
            </button>
          </div>
        </div>

        <div className="admin-catalog-create-card">
          <h3>➕ Nuevo subdepartamento</h3>
          <p className="admin-hint">Se cuelga de un departamento. El slug se genera solo.</p>
          <div className="admin-catalog-row">
            <select
              value={subDeptId}
              onChange={(e) => setSubDeptId(e.target.value)}
              aria-label="Departamento destino"
            >
              <option value="">Departamento…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <input
              type="text"
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              placeholder="Nombre"
              maxLength={80}
              aria-label="Nombre del nuevo subdepartamento"
              disabled={!subDeptId}
            />
            <button
              className="btn btn-primary"
              onClick={createSubdepartment}
              disabled={saving || !subDeptId || !subName.trim()}
            >
              Crear
            </button>
          </div>
        </div>
      </div>

      {/* Listado */}
      {departments.length === 0 && !loading && (
        <div className="admin-catalog-empty">
          <p>No hay departamentos todavía.</p>
          <p className="admin-hint">Crea el primero arriba para poder añadir subdepartamentos y productos.</p>
        </div>
      )}

      <div className="admin-catalog-list">
        {departments.map((dept) => (
          <div className={`admin-catalog-card ${dept.is_active ? '' : 'inactive'}`} key={dept.id}>
            <div className="admin-catalog-card-head">
              <div className="admin-catalog-card-title">
                <strong>{dept.name}</strong>
                <code className="admin-slug">/{dept.slug}</code>
                {!dept.is_active && <span className="admin-badge-off">Oculto</span>}
                <span className="admin-hint">
                  {dept.subdepartments.length} sub · {dept.product_count} producto{dept.product_count === 1 ? '' : 's'}
                </span>
              </div>
              <div className="admin-catalog-actions">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => startEdit('dept', dept.id, dept.name)}
                  title="Renombrar departamento"
                >
                  ✏️
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => toggleActive(dept)}
                  title={dept.is_active ? 'Ocultar en la tienda' : 'Mostrar en la tienda'}
                >
                  {dept.is_active ? '🙈' : '👁️'}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => remove('dept', dept.id, dept.name)}
                  title="Borrar departamento"
                >
                  🗑️
                </button>
              </div>
            </div>

            {editing?.action === 'dept' && editing.id === dept.id && (
              <div className="admin-catalog-edit">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={80}
                  aria-label="Nuevo nombre del departamento"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
                />
                <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving || !editName.trim()}>
                  💾 Guardar
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancelar</button>
              </div>
            )}

            {dept.subdepartments.length === 0 ? (
              <p className="admin-hint admin-catalog-nosubs">Sin subdepartamentos.</p>
            ) : (
              <ul className="admin-catalog-subs">
                {dept.subdepartments.map((sub) => (
                  <li key={sub.id}>
                    <div className="admin-catalog-sub-main">
                      <span>{sub.name}</span>
                      <code className="admin-slug">/{sub.slug}</code>
                      <span className="admin-hint">
                        {sub.product_count} producto{sub.product_count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="admin-catalog-actions">
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => startEdit('sub', sub.id, sub.name, sub.department_id)}
                        title="Renombrar o mover"
                      >
                        ✏️
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => remove('sub', sub.id, sub.name)}
                        title="Borrar subdepartamento"
                      >
                        🗑️
                      </button>
                    </div>

                    {editing?.action === 'sub' && editing.id === sub.id && (
                      <div className="admin-catalog-edit">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          maxLength={80}
                          aria-label="Nuevo nombre del subdepartamento"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
                        />
                        <select
                          value={editParent}
                          onChange={(e) => setEditParent(e.target.value)}
                          aria-label="Mover a departamento"
                        >
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                        <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving || !editName.trim()}>
                          💾 Guardar
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancelar</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
