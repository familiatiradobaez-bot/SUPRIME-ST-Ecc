export type Product = {
  id: string;
  name: string;
  slug?: string;
  description: string;
  image_url: string;
  images?: string[];
  price_cents: number;
  stock_quantity: number;
  subdepartment_slug?: string;
  department_slug?: string;
  department_name?: string;
  avg_rating?: number;
  review_count?: number;
};

export type CartItem = {
  id: string;
  quantity: number;
};

export type User = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  role_id: string;
  shipping?: {
    full_name: string;
    phone: string;
    address: string;
    city: string;
    postal_code: string;
    country: string;
  } | null;
};

export type Session = {
  id: string;
  token: string;
  expires_at: string;
};

export type ShippingInfo = {
  shipping_name: string;
  shipping_email: string;
  shipping_phone: string;
  shipping_address: string;
  payment_method: string;
  card_number?: string;
  card_expiry?: string;
  card_cvv?: string;
};
