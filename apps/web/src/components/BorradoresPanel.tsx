import { useEffect, useState } from 'react';

type Borrador = {
  productId: string;
  title?: string;
  price?: string;
  description?: string;
  status?: string;
  fotos?: Array<{ name?: string; url?: string }>;
};

type SubOption = { id: string; label: string };

type BorradoresPanelProps = {
  apiUrl: string;
  sessionToken: string;
};

export function BorradoresPanel({ apiUrl, sessionToken }: BorradoresPanelProps) {
  const [items, setItems] = useState<Borrador[]>([]);
  const [subs, setSubs] = useState<SubOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<Borrador | null>(null);
  const [f, setF] = useState({ title: '', price: '', description: '', subdepartment_id: '', stock: '0', keep: {} as Record<number, boolean> });

  async function cargar() {
    setLoading(true);
    try {
      const r = await fetch('/borradores/borradores.json', { cache: 'no-store' });
      const data = await r.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setMsg('Error cargando: ' + e.message);
    } finally { setLoading(false); }
  }

  async function cargarCatalog() {
    try {
      const r = await fetch(`${apiUrl}/admin/catalog`, { headers: { Authorization: `Bearer ${sessionToken}` } });
      const j = await r.json();
      const opts: SubOption[] = [];
      (j.data || []).forEach((d: any) => (d.subdepartments || []).forEach((s: any) => opts.push({ id: s.id, label: `${d.name} / ${s.name}` })));
      setSubs(opts);
    } catch { /* ignore */ }
  }

  function abrirEdit(b: Borrador) {
    const keep: Record<number, boolean> = {};
    (b.fotos || []).forEach((_, i) => { keep[i] = true; });
    setEdit(b);
    setF({ title: b.title || '', price: b.price || '', description: b.description || '', subdepartment_id: subs[0]?.id || '', stock: '0', keep });
  }

  async function crearBorrador() {
    if (!edit) return;
    setMsg('Creando borrador en la web...');
    const fotosArr = (edit.fotos || []).filter((_, i) => f.keep[i]);
    const imageUrl = fotosArr[0]?.url || '';
    const priceStr = String(f.price).replace(/[^0-9.,]/g, '').replace(',', '.');
    const priceNum = parseFloat(priceStr);
    const priceCents = Number.isFinite(priceNum) ? Math.round(priceNum * 100) : 0;
    const stock = parseInt(f.stock, 10);
    const body = {
      productId: edit.productId,
      subdepartment_id: f.subdepartment_id,
      name: f.title || edit.title || 'Sin título',
      description: f.description,
      image_url: imageUrl,
      price_cents: priceCents,
      stock_quantity: Number.isFinite(stock) && stock >= 0 ? stock : 0,
      images: fotosArr.map((x) => x.url).filter(Boolean),
    };
    const r = await fetch(`${apiUrl}/admin/borradores/a-producto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    setMsg(j.data ? `Borrador creado (oculto). ID ${j.data.id}` : (j.error || 'error'));
    setEdit(null);
    cargar();
  }

  useEffect(() => { cargar(); cargarCatalog(); }, []);

  const fotosEdit = edit ? (edit.fotos || []) : [];
  const keepList = fotosEdit.filter((_, i) => f.keep[i]);
  const preview = fotosEdit.length ? fotosEdit[0]?.url : '';

  return (
    <div>
      <h2>Borradores del scraping</h2>
      <button onClick={cargar}>Refrescar</button>
      {msg && <p aria-live="polite">{msg}</p>}
      {loading && <p>Cargando...</p>}
      <table className="admin-table">
        <thead><tr><th>ID</th><th>Título</th><th>Precio</th><th>Fotos</th><th>Acción</th></tr></thead>
        <tbody>
          {items.filter((b) => b.status !== 'publicado').map((b) => (
            <tr key={b.productId}>
              <td>{b.productId}</td>
              <td>{(b.title || '').slice(0, 70)}</td>
              <td>{b.price}</td>
              <td>{(b.fotos || []).length}</td>
              <td><button onClick={() => abrirEdit(b)}>Editar y crear borrador</button></td>
            </tr>
          ))}
          {!loading && items.filter((b) => b.status !== 'publicado').length === 0 && (
            <tr><td colSpan={5}>No hay borradores pendientes.</td></tr>
          )}
        </tbody>
      </table>

      {edit && (
        <div style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, marginTop: 16 }}>
          <h3>Editar y crear borrador (oculto)</h3>
          <label>Título<br/><input style={{width:'100%'}} value={f.title} onChange={(e) => setF({...f, title: e.target.value})} /></label>
          <br/>
          <label>Precio<br/><input style={{width:'100%'}} value={f.price} onChange={(e) => setF({...f, price: e.target.value})} /></label>
          <br/>
          <label>Descripción<br/><textarea style={{width:'100%'}} rows={3} value={f.description} onChange={(e) => setF({...f, description: e.target.value})} /></label>
          <br/>
          <label>Subdepartamento<br/>
            <select style={{width:'100%'}} value={f.subdepartment_id} onChange={(e) => setF({...f, subdepartment_id: e.target.value})}>
              {subs.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
            </select>
          </label>
          <br/>
          <label>Stock<br/><input style={{width:'100%'}} value={f.stock} onChange={(e) => setF({...f, stock: e.target.value})} /></label>
          <br/>
          <h4>Fotos (desmarca las que NO quieras)</h4>
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            {fotosEdit.map((ft, i) => (
              <label key={i} style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
                <img src={ft.url} style={{width:70,height:70,objectFit:'cover',borderRadius:6,border:'1px solid #ddd'}} alt={ft.name} />
                <input type="checkbox" checked={!!f.keep[i]} onChange={(e) => setF({...f, keep: {...f.keep, [i]: e.target.checked}})} />
              </label>
            ))}
          </div>
          <h4>Vista previa del borrador (oculto)</h4>
          <div style={{border:'1px solid #ddd',borderRadius:8,padding:10,display:'flex',gap:12,alignItems:'center'}}>
            {preview && <img src={preview} style={{width:80,height:80,objectFit:'cover',borderRadius:8}} alt="preview" />}
            <div>
              <div style={{fontWeight:600}}>{f.title || edit.title || '(sin título)'}</div>
              <div>{f.price || '(sin precio)'}</div>
              <div style={{fontSize:12,color:'#666'}}>{(f.description || '').slice(0,120)}</div>
            </div>
          </div>
          <br/>
          <button onClick={crearBorrador}>Crear borrador en la web (oculto)</button>
          <button onClick={() => setEdit(null)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
