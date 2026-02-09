export type Screen =
  | "home"
  | "search"
  | "cart"
  | "analytics"
  | "ai"
  | "profile"
  | "publications"
  | "profile-edit"
  | "orders"
  | "deliveries"
  | "notifications"
  | "about"
  | "help"
  | "faq";

export type Category = "meat" | "milk" | "fish" | "bread" | "fruit" | "grain";

export type Product = {
  id: string;
  name: string;
  seller: string;
  price: number;
  rating: string; // как в старом дизайне ("4.9")
  reviews: number;
  image: string; // "media/xxx.jpg"
  category: Category;

  // поля из API (нужны для заказов/фильтрации)
  supplier_company_id?: number;
  category_id?: number | null;
};

export type CartItem = {
  product: Product;
  qty: number;
};

export type DeliveryMethod = "YANDEX" | "SUPPLIER_COURIER";

export type CreateOrderPayload = {
  items: Array<{ product_id: string; qty: number }>;
  delivery_method: DeliveryMethod;
  comment?: string;
};
