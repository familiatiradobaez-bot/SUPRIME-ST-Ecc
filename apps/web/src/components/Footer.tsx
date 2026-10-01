import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-section">
          <h3>Sobre SUPRIME</h3>
          <ul>
            <li><Link to="/contacto">Acerca de nosotros</Link></li>
            <li><Link to="/faq">Preguntas frecuentes</Link></li>
            <li><Link to="/contacto">Contacto</Link></li>
          </ul>
        </div>
        <div className="footer-section">
          <h3>Ayuda</h3>
          <ul>
            <li><Link to="/faq">Preguntas frecuentes</Link></li>
            <li><Link to="/contacto">Contacto</Link></li>
            <li><Link to="/envios">Envíos y Devoluciones</Link></li>
          </ul>
        </div>
        <div className="footer-section">
          <h3>Legal</h3>
          <ul>
            <li><Link to="/privacidad">Política de Privacidad</Link></li>
            <li><Link to="/terminos">Términos y Condiciones</Link></li>
            <li><Link to="/envios">Envíos y Devoluciones</Link></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} SUPRIME. Todos los derechos reservados.</p>
      </div>
    </footer>
  );
}
