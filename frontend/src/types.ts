export type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  original_price: number;
  rating: number;
  review_count: number;
  image: string;
  description: string;
  badge: string;
  stock: number;
  tags: string[];
};

export type ChatMessage = { role: "assistant" | "user"; content: string };
