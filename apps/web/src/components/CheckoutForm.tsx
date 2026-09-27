import { useState } from 'react';

type CheckoutFormProps = {
  total: number;
  itemCount: number;
  loading?: boolean;
  defaultName?: string;
  defaultPhone?: string;
  defaultAddress?: string;
  onSubmit: (shippingInfo: {
    shipping_name: string;
    shipping_email: string;
    shipping_phone: string;
    shipping_address: string;
    payment_method: string;
    card_number?: string;
    card_expiry?: string;
    card_cvv?: string;
  }) => void;
  onCancel: () => void;
};

export function CheckoutForm({ total, itemCount, loading, defaultName, defaultPhone, defaultAddress, onSubmit, onCancel }: CheckoutFormProps) {
  const [name, setName] = useState(defaultName || '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(defaultPhone || '');
  const [address, setAddress] = useState(defaultAddress || '');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ shipping_name: name, shipping_email: email, shipping_phone: phone, shipping_address: address, payment_method: paymentMethod, card_number: cardNumber, card_expiry: cardExpiry, card_cvv: cardCvv }); }} className="form">
      <div className="checkout-summary">
        <p><strong>Artículos:</strong> {itemCount}</p>
        <p><strong>Total:</strong> {(total / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</p>
      </div>

      <h3>Información de Envío</h3>
      <div className="form-group">
        <label>Nombre Completo:</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan Pérez" required />
      </div>
      <div className="form-group">
        <label>Correo Electrónico:</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" required />
      </div>
      <div className="form-group">
        <label>Teléfono:</label>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34 123 456 789" required pattern="[+]?[0-9\s]{9,15}" title="Introduce un número de teléfono válido (9-15 dígitos)" />
      </div>
      <div className="form-group">
        <label>Dirección de Envío:</label>
        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle Principal 123, Madrid" required />
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
            <label>Número de Tarjeta:</label>
            <input type="text" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="1234 5678 9012 3456" required maxLength={19} pattern="[0-9\s]{13,19}" />
          </div>
          <div className="form-group">
            <label>Fecha de Expiración:</label>
            <input type="text" value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="MM/AA" required maxLength={5} pattern="(0[1-9]|1[0-2])/[0-9]{2}" />
          </div>
          <div className="form-group">
            <label>CVV:</label>
            <input type="text" value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} placeholder="123" required maxLength={4} pattern="[0-9]{3,4}" />
          </div>
        </>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-glow" disabled={loading}>
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
    </form>
  );
}
