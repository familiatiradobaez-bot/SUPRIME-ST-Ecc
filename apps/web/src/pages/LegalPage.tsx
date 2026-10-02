import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// Textos base para una tienda online en República Dominicana. NOTA LEGAL: son plantillas,
// revísalos con un asesor antes de la apertura al público.
const PAGES: Record<string, { title: string; updated: string; body: React.ReactNode }> = {
  privacidad: {
    title: 'Política de Privacidad',
    updated: 'Última actualización: septiembre 2026',
    body: (
      <>
        <p>En SUPRIME (suprime.xyz) tratamos tus datos conforme al RGPD (UE 2016/679) y la LOPDGDD 3/2018.</p>
        <h3>Datos que recogemos</h3>
        <p>Cuenta (nombre, email, contraseña cifrada), datos de envío, pedidos y, si lo activas, login con Google (email y nombre) y 2FA.</p>
        <h3>Finalidad</h3>
        <p>Gestionar tu cuenta, tramitar pedidos, enviar comunicaciones transaccionales (confirmación, estados, verificación) y seguridad (detección de abuso).</p>
        <h3>Conservación</h3>
        <p>Datos de cuenta mientras esté activa; pedidos el plazo legal exigible; sesiones caducadas y códigos OTP se purgan automáticamente.</p>
        <h3>Tus derechos</h3>
        <p>Acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a <a href="mailto:privacy@suprime.xyz">privacy@suprime.xyz</a>. Reclamación ante la AEPD (aepd.es).</p>
      </>
    ),
  },
  terminos: {
    title: 'Términos y Condiciones',
    updated: 'Última actualización: septiembre 2026',
    body: (
      <>
        <p>Al comprar en SUPRIME aceptas estas condiciones.</p>
        <h3>Productos y precios</h3>
        <p>Precios en euros con impuestos incluidos. El stock se confirma al tramitar el pedido; si un artículo se agota, te avisamos y no se cobra.</p>
        <h3>Pedidos</h3>
        <p>El pedido queda registrado como pendiente y te confirmamos por email cada cambio de estado (pagado, enviado, entregado).</p>
        <h3>Cuenta</h3>
        <p>Eres responsable de tus credenciales. El panel de administración exige verificación en dos pasos.</p>
      </>
    ),
  },
  envios: {
    title: 'Envíos y Devoluciones',
    updated: 'Última actualización: septiembre 2026',
    body: (
      <>
        <h3>Envíos</h3>
        <p>Entrega en 24-48 horas laborables en República Dominicana. Recibirás el seguimiento por email cuando tu pedido salga del almacén.</p>
        <h3>Devoluciones</h3>
        <p>Tienes 30 días naturales desde la entrega para devolver productos en perfecto estado (desistimiento, art. 102 TRLGDCU). Escríbenos con tu número de pedido y gestionamos la recogida y el reembolso por el mismo medio de pago.</p>
        <h3>Excepciones</h3>
        <p>Por higiene o seguridad, algunos productos precintados no admiten devolución una vez abiertos. Se indica en su ficha.</p>
      </>
    ),
  },
  contacto: {
    title: 'Contacto',
    updated: '',
    body: (
      <>
        <p>Escríbenos y te respondemos en 24-48h laborables.</p>
        <p><strong>Email:</strong> <a href="mailto:hola@suprime.xyz">hola@suprime.xyz</a></p>
        <p><strong>Pedidos:</strong> indica tu número de pedido (lo verás en Mi Cuenta → Mis pedidos).</p>
      </>
    ),
  },
  faq: {
    title: 'Preguntas Frecuentes',
    updated: '',
    body: (
      <>
        <h3>¿Necesito cuenta para comprar?</h3>
        <p>Sí, el carrito y el checkout requieren iniciar sesión para guardar tu pedido y avisarte por email.</p>
        <h3>¿Cómo verifico mi cuenta?</h3>
        <p>Al registrarte enviamos un código de 6 dígitos válido 15 minutos. Sin ese paso no hay acceso.</p>
        <h3>¿Olvidé mi contraseña?</h3>
        <p>Usa "¿Olvidaste tu contraseña?" en el login: recibirás un código para poner una nueva.</p>
        <h3>¿Cuándo llega mi pedido?</h3>
        <p>En 24-48h laborables. Verás el estado en Mi Cuenta → Mis pedidos.</p>
        <h3>¿Puedo devolver un producto?</h3>
        <p>Sí, 30 días naturales. Ver Envíos y Devoluciones.</p>
      </>
    ),
  },
};

export function LegalPage({ slug }: { slug: string }) {
  const page = PAGES[slug];
  // Canonical propio: una pagina legal que se declara duplicado de la home es ruido
  // para el buscador.
  useDocumentTitle(page?.title, page ? `SUPRIME: ${page.title}.` : undefined, page ? `/${slug}` : '/');
  if (!page) {
    return (
      <div className="layout-main">
        <div className="container">
          <div className="empty-state">
            <h3>Página no encontrada</h3>
            <Link to="/" className="btn btn-primary">Volver a la tienda</Link>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="layout-main">
      <div className="container">
        <nav className="breadcrumbs" aria-label="Migas de pan">
          <Link to="/">Inicio</Link>
          <span> / </span>
          <span>{page.title}</span>
        </nav>
        <section className="products-section legal-page">
          <h1>{page.title}</h1>
          {page.updated && <p className="section-subtitle">{page.updated}</p>}
          <div className="legal-body">{page.body}</div>
        </section>
      </div>
    </div>
  );
}
