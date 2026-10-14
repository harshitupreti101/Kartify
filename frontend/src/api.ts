import type { Product } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const token = () => localStorage.getItem("kartify_token");

export type Account = { id: number; name: string; email: string; is_admin: boolean };
export type OrderSummary = {
  id: number;
  customer_name: string;
  email: string;
  total: number;
  status: string;
  payment_status: string;
  created_at: string;
};
export type CustomerOrder = {
  id: number;
  status: string;
  payment_status: string;
  total: number;
  created_at: string;
  items: { product_id: number; quantity: number; unit_price: number }[];
};
export type AdminSummary = {
  total_revenue: number;
  order_count: number;
  product_count: number;
  low_stock_count: number;
  sales: { date: string; label: string; revenue: number; orders: number }[];
  recent_orders: OrderSummary[];
  products: Product[];
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.detail ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getProducts(): Promise<Product[]> {
  return request<Product[]>("/api/products");
}

export async function authenticate(mode: "login" | "signup", payload: { name?: string; email: string; password: string; admin_setup_token?: string }) {
  return request<{ access_token: string; token_type: string; user: Account }>(`/api/auth/${mode}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function authenticateSocial(
  provider: "google" | "facebook",
  credential: string,
  adminSetupToken?: string,
) {
  return request<{ access_token: string; token_type: string; user: Account }>(`/api/auth/${provider}`, {
    method: "POST",
    body: JSON.stringify({
      credential,
      ...(adminSetupToken?.trim() ? { admin_setup_token: adminSetupToken.trim() } : {}),
    }),
  });
}

export async function linkSocialAccount(provider: "google" | "facebook", credential: string) {
  return request<{ linked: boolean }>(`/api/auth/link/${provider}`, {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

export async function claimAdminAccess(adminSetupToken: string) {
  return request<{ is_admin: boolean }>("/api/auth/admin-claim", {
    method: "POST",
    body: JSON.stringify({ admin_setup_token: adminSetupToken }),
  });
}

export async function getAccount() {
  return request<Account>("/api/auth/me");
}

export async function getOrders() {
  return request<CustomerOrder[]>("/api/orders");
}

export async function askAssistant(message: string, products: Product[]) {
  const response = await fetch(`${API_URL}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, product_ids: products.map((item) => item.id) }),
  });
  if (!response.ok) throw new Error("Assistant is unavailable right now");
  return response.json() as Promise<{ reply: string; products: Product[] }>;
}

export async function createOrder(payload: {
  customer_name: string;
  email: string;
  address: string;
  items: { product_id: number; quantity: number }[];
}) {
  return request<{ id: number; status: string; total: number }>("/api/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type RazorpayPaymentOrder = {
  order_id: number;
  razorpay_order_id: string;
  amount: number;
  currency: "INR";
  key_id: string;
  name: string;
  email: string;
};

export async function createRazorpayPaymentOrder(payload: {
  customer_name: string;
  email: string;
  address: string;
  items: { product_id: number; quantity: number }[];
}) {
  return request<RazorpayPaymentOrder>("/api/payments/razorpay/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function verifyRazorpayPayment(payload: {
  order_id: string;
  payment_id: string;
  signature: string;
}) {
  return request<{ id: number; status: string; payment_status: string; total: number }>(
    "/api/payments/razorpay/verify",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function getAdminSummary() {
  return request<AdminSummary>("/api/admin/summary");
}

export async function saveProduct(product: Omit<Product, "id" | "rating" | "review_count"> & Partial<Pick<Product, "id" | "rating" | "review_count">>) {
  const editing = typeof product.id === "number";
  return request<Product>(editing ? `/api/admin/products/${product.id}` : "/api/admin/products", {
    method: editing ? "PUT" : "POST",
    body: JSON.stringify(product),
  });
}

export async function removeProduct(id: number) {
  return request<void>(`/api/admin/products/${id}`, { method: "DELETE" });
}

export async function updateOrderStatus(id: number, status: string) {
  return request<{ id: number; status: string }>(`/api/admin/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
