import { useState } from 'react';
import { formatPrice, calcShipping, DEFAULT_CURRENCY } from '../lib/api';

type CheckoutFormProps = {
  total: number;
  itemCount: number;
  loading?: boolean;
  currency?: string;
  defaultName?: string;
  defaultEmail?: string;
  defaultPhone?: string;
  defaultAddress?: string;
  defaultCity?: string;
  defaultPostalCode?: string;
  onSubmit: (shippingInfo: {
    shipping_name: string;
    shipping_email: string;
    shipping_phone: string;
    shipping_address: string;
    shipping_city: string;
    shipping_postal_code: string;
    shipping_country: string;
    payment_method: string;
    card_number?: string;
    card_expiry?: string;
    card_cvv?: string;
  }) => void;
  onCancel: () => void;
};

// Sin ciudad + CP + teléfono válidos no hay checkout (lo exige también la API).
export function CheckoutForm({ total, itemCount, loading, currency = DEFAULT_CURRENCY, defaultName, defaultEmail, defaultPhone, defaultAddress, defaultCity, defaultPostalCode, onSubmit, onCancel }: CheckoutFormProps) {
  const [name, setName] = useState(defaultName || '');
  const [email, setEmail] = useState(defaultEmail || '');
  const [phone, setPhone] = useState(defaultPhone || '');
  const [address, setAddress] = useState(defaultAddress || '');
  const [city, setCity] = useState(defaultCity || '');
  const [postalCode, setPostalCode] = useState(defaultPostalCode || '');
  // En República Dominicana no existe el código postal: la gente se orienta
  // por el SECTOR y la ciudad. El campo se llama igual en la API por
  // compatibilidad, pero guarda texto libre (p. ej. "Los Alcarrizos").
  const [sector, setSector] = useState(postalCode);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ shipping_name: name.trim(), shipping_email: email.trim(), shipping_phone: phone.trim(), shipping_address: address.trim(), shipping_city: city.trim(), shipping_postal_code: sector.trim(), shipping_country: 'República Dominicana', payment_method: paymentMethod, card_number: cardNumber, card_expiry: cardExpiry, card_cvv: cardCvv }); }} className="form">
      <div className="checkout-summary">
        <p><strong>Artículos:</strong> {itemCount}</p>
        <p><strong>Subtotal:</strong> {formatPrice(total, currency)}</p>
        <p><strong>Envío 24-48h:</strong> {calcShipping(total) === 0 ? 'Gratis' : formatPrice(calcShipping(total), currency)}</p>
        <p><strong>Total (IVA incl.):</strong> {formatPrice(total + calcShipping(total), currency)}</p>
      </div>

      <h3>Información de Envío</h3>
      <div className="form-group">
        <label htmlFor="co-name">Nombre Completo:</label>
        <input id="co-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Pérez" required minLength={2} maxLength={100} autoComplete="name" />
      </div>
      <div className="form-group">
        <label htmlFor="co-email">Correo Electrónico:</label>
        <input id="co-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required autoComplete="email" />
      </div>
      <div className="form-group">
        <label htmlFor="co-phone">Teléfono:</label>
        <input
          id="co-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => {
            // Simple phone mask: allow digits, spaces, +, -, (), auto-format Spanish format
            let val = e.target.value.replace(/[^\d+]/g, '');
            if (val.startsWith('34') && !val.startsWith('+')) val = '+' + val;
            if (val.startsWith('+34')) {
              const rest = val.slice(3).replace(/\D/g, '');
              if (rest.length <= 3) val = '+34 ' + rest;
              else if (rest.length <= 6) val = '+34 ' + rest.slice(0, 3) + ' ' + rest.slice(3);
              else if (rest.length <= 9) val = '+34 ' + rest.slice(0, 3) + ' ' + rest.slice(3, 6) + ' ' + rest.slice(6);
              else val = '+34 ' + rest.slice(0, 3) + ' ' + rest.slice(3, 6) + ' ' + rest.slice(6, 9);
            }
            setPhone(val);
          }}
          placeholder="+34 612 345 678"
          required
          pattern="\+?[0-9\s.\-()]{9,20}"
          title="9-15 dígitos, p. ej. +34 612 345 678"
          autoComplete="tel"
        />
      </div>
      <div className="form-group">
        <label htmlFor="co-address">Dirección:</label>
        <input id="co-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle Principal 123, 2ºB" required minLength={3} maxLength={200} autoComplete="street-address" />
      </div>
      <div className="form-row-2col">
      <div className="form-group">
        <label htmlFor="co-city">Ciudad:</label>
        <input id="co-city" type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Santo Domingo" required minLength={2} maxLength={100} autoComplete="address-level2" />
      </div>
      <div className="form-group">
        <label htmlFor="co-postal">Sector:</label>
        <input id="co-postal" type="text" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Santo Domingo Este, Los Alcarrizos" required minLength={2} maxLength={60} title="Tu sector o zona, p. ej. Los Alcarrizos" autoComplete="address-line3" />
      </div>
      </div>

      <h3>Método de Pago</h3>
      <div className="form-group">
        <label><input type="radio" value="card" checked={paymentMethod === 'card'} onChange={(e) => setPaymentMethod(e.target.value)} /> Tarjeta de Crédito</label>
      </div>
      <div className="form-group">
        <label><input type="radio" value="paypal" checked={paymentMethod === 'paypal'} onChange={(e) => setPaymentMethod(e.target.value)} /> PayPal</label>
      </div>
      <div className="form-group">
        <label><input type="radio" value="bank" checked={paymentMethod === 'bank'} onChange={(e) => setPaymentMethod(e.target.value)} /> Transferencia Bancaria</label>
      </div>

      {paymentMethod === 'card' && (
        <>
          <div className="form-group">
            <label htmlFor="co-card">Número de Tarjeta:</label>
            <input id="co-card" type="text" inputMode="numeric" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="1234 5678 9012 3456" required maxLength={19} pattern="[0-9\s]{13,19}" autoComplete="cc-number" />
          </div>
          <div className="form-group">
            <label htmlFor="co-exp">Fecha de Expiración:</label>
            <input id="co-exp" type="text" inputMode="numeric" value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="MM/AA" required maxLength={5} pattern="(0[1-9]|1[0-2])/[0-9]{2}" autoComplete="cc-exp" />
          </div>
          <div className="form-group">
            <label htmlFor="co-cvv">CVV:</label>
            <input id="co-cvv" type="text" inputMode="numeric" value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} placeholder="123" required maxLength={4} pattern="[0-9]{3,4}" autoComplete="cc-csc" />
          </div>
        </>
      )}

      <div className="checkout-sticky-footer">
      <div className="form-group remember-me">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            required
            data-testid="accept-terms"
          />
          <span>Acepto los <a href="/terminos" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Términos</a> y la <a href="/privacidad" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Privacidad</a></span>
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-glow" disabled={loading} data-testid="place-order">
          {loading ? (
            <>
              <span className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderTopColor: 'white' }}></span>
              Procesando...
            </>
          ) : (
            'Confirmar Compra'
          )}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>Cancelar</button>
      </div>
      </div>
    </form>
  );
}
