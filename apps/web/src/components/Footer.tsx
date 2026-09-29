export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-section">
          <h4>Sobre SUPRIME</h4>
          <ul>
            <li><a href="#about">Acerca de nosotros</a></li>
            <li><a href="#blog">Blog</a></li>
            <li><a href="#careers">Trabaja con nosotros</a></li>
          </ul>
        </div>
        <div className="footer-section">
          <h4>Ayuda</h4>
          <ul>
            <li><a href="#faq">Preguntas frecuentes</a></li>
            <li><a href="#contact">Contacto</a></li>
            <li><a href="#support">Soporte</a></li>
          </ul>
        </div>
        <div className="footer-section">
          <h4>Legal</h4>
          <ul>
            <li><a href="#privacy">Política de Privacidad</a></li>
            <li><a href="#terms">Términos y Condiciones</a></li>
            <li><a href="#shipping">Envíos y Devoluciones</a></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} SUPRIME. Todos los derechos reservados.</p>
      </div>
    </footer>
  );
}
