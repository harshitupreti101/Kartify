import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft,
  ChevronRight, Heart, Menu, Mic, MicOff, Minus, Moon, Plus, Search, ShoppingBag,
  SlidersHorizontal, Sparkles, Sun, X, UserRound, LayoutDashboard,
  Package, TrendingUp, Boxes, LogOut, Pencil, Trash2,
} from "lucide-react";
import {
  askAssistant, authenticate, authenticateSocial, claimAdminAccess, createOrder, createRazorpayPaymentOrder,
  getAccount, getAdminSummary, linkSocialAccount,
  getOrders, getProducts, removeProduct, saveProduct, updateOrderStatus,
  verifyRazorpayPayment, type Account, type AdminSummary, type CustomerOrder,
  type RazorpayPaymentOrder,
} from "./api";
import type { ChatMessage, Product } from "./types";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
const FACEBOOK_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID?.trim() ?? "";
const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID?.trim() ?? "";
const IS_DEVELOPMENT = import.meta.env.DEV;
const CHECKOUT_AVAILABLE = Boolean(RAZORPAY_KEY_ID) || IS_DEVELOPMENT;
const money = (value: number) => `₹${value.toLocaleString("en-IN")}`;
type RazorpayCallback = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type RazorpayFailure = { error?: { description?: string } };
type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string };
  theme: { color: string };
  handler: (response: RazorpayCallback) => void;
  modal: { ondismiss: () => void };
};
const fallbackProducts: Product[] = [
  { id: 1, name: "Everyday Carry Tote", category: "Accessories", price: 1299, original_price: 1699, rating: 4.8, review_count: 124, image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85", description: "A roomy, responsibly made tote for all the little things your day brings.", badge: "BESTSELLER", stock: 12, tags: ["bag", "cotton", "everyday", "gift"] },
  { id: 2, name: "Cloud Knit Sweater", category: "Clothing", price: 2499, original_price: 3299, rating: 4.9, review_count: 86, image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=85", description: "Soft, relaxed and made for the slow mornings you wish lasted longer.", badge: "JUST IN", stock: 8, tags: ["clothing", "soft", "winter", "gift"] },
  { id: 3, name: "Ribbed Ceramic Mug", category: "Home", price: 749, original_price: 999, rating: 4.7, review_count: 203, image: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=85", description: "Hand-finished stoneware that makes your first coffee feel like a ritual.", badge: "LOVED", stock: 18, tags: ["coffee", "ceramic", "home", "gift"] },
  { id: 4, name: "Weekend Runner", category: "Footwear", price: 3199, original_price: 3999, rating: 4.6, review_count: 93, image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85", description: "Lightweight everyday sneakers with a cushioned sole for long city walks.", badge: "TRENDING", stock: 5, tags: ["shoes", "walking", "comfort", "rain"] },
  { id: 5, name: "Soft Glow Desk Lamp", category: "Home", price: 1899, original_price: 2399, rating: 4.8, review_count: 67, image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85", description: "A warm pool of light for the late-night reader and early-morning planner.", badge: "", stock: 9, tags: ["lamp", "home", "desk", "gift"] },
  { id: 6, name: "Sculpted Everyday Hoops", category: "Accessories", price: 999, original_price: 1299, rating: 4.9, review_count: 158, image: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=85", description: "A little golden detail that goes with absolutely everything.", badge: "BESTSELLER", stock: 22, tags: ["jewelry", "gold", "gift", "accessories"] },
  { id: 7, name: "Sunday Linen Shirt", category: "Clothing", price: 1999, original_price: 2599, rating: 4.5, review_count: 72, image: "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=85", description: "Breathable linen with an easy, boxy fit for warmer days.", badge: "", stock: 14, tags: ["shirt", "linen", "clothing", "summer"] },
  { id: 8, name: "The Little Plant Set", category: "Home", price: 1199, original_price: 1499, rating: 4.7, review_count: 51, image: "https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=900&q=85", description: "Three easy-going greens to bring a little more life to your space.", badge: "GIFT PICK", stock: 7, tags: ["plant", "home", "decor", "gift"] },
];
const categories = ["Everything", "Clothing", "Home", "Accessories", "Footwear"];
let razorpaySdkLoad: Promise<void> | null = null;

function loadRazorpaySdk(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpaySdkLoad) {
    razorpaySdkLoad = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => window.Razorpay
        ? resolve()
        : reject(new Error("Razorpay checkout did not initialize."));
      script.onerror = () => reject(new Error("Could not load Razorpay checkout. Check your connection and try again."));
      document.head.append(script);
    }).catch((error: unknown) => {
      razorpaySdkLoad = null;
      throw error;
    });
  }
  if (!razorpaySdkLoad) throw new Error("Razorpay checkout could not be initialized.");
  return razorpaySdkLoad;
}

async function launchRazorpayCheckout(payload: {
  customer_name: string;
  email: string;
  address: string;
  items: { product_id: number; quantity: number }[];
}): Promise<{ id: number; status: string; total: number }> {
  const paymentOrder: RazorpayPaymentOrder = await createRazorpayPaymentOrder(payload);
  if (!RAZORPAY_KEY_ID || paymentOrder.key_id !== RAZORPAY_KEY_ID) {
    throw new Error("Razorpay key configuration does not match between the frontend and backend.");
  }
  await loadRazorpaySdk();
  const RazorpayCheckout = window.Razorpay;
  if (!RazorpayCheckout) throw new Error("Razorpay checkout is unavailable.");

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const checkout = new RazorpayCheckout({
      key: paymentOrder.key_id,
      amount: paymentOrder.amount,
      currency: paymentOrder.currency,
      name: "Kartify",
      description: `Order #${paymentOrder.order_id}`,
      order_id: paymentOrder.razorpay_order_id,
      prefill: { name: paymentOrder.name, email: paymentOrder.email },
      theme: { color: "#315a43" },
      handler: (response) => {
        void verifyRazorpayPayment({
          order_id: response.razorpay_order_id,
          payment_id: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }).then((verified) => {
          if (settled) return;
          settled = true;
          resolve(verified);
        }).catch((error: unknown) => {
          fail(error instanceof Error ? error : new Error("Payment verification failed."));
        });
      },
      modal: {
        ondismiss: () => fail(new Error("Payment window closed. Your order is still awaiting payment.")),
      },
    });
    checkout.on("payment.failed", (response) => {
      fail(new Error(response.error?.description || "Payment failed. You can retry from checkout."));
    });
    checkout.open();
  });
}

type VoiceRecognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => VoiceRecognition;
  webkitSpeechRecognition?: new () => VoiceRecognition;
};

type GoogleCredentialResponse = { credential?: string };
type FacebookLoginResponse = {
  authResponse?: { accessToken: string };
  status?: string;
}

async function placeCheckoutOrder(payload: {
  customer_name: string;
  email: string;
  address: string;
  items: { product_id: number; quantity: number }[];
}): Promise<{ id: number; status: string; total: number }> {
  if (RAZORPAY_KEY_ID) return launchRazorpayCheckout(payload);
  if (IS_DEVELOPMENT) return createOrder(payload);
  throw new Error("Online checkout is not configured yet. Please try again later.");
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: {
            theme: "outline";
            size: "large";
            text: "continue_with";
            shape: "rectangular";
            width: number;
          }) => void;
        };
      };
    };
    FB?: {
      init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: FacebookLoginResponse) => void,
        options: { scope: string },
      ) => void;
    };
    fbAsyncInit?: () => void;
    Razorpay?: new (options: RazorpayOptions) => {
      open: () => void;
      on: (event: "payment.failed", callback: (response: RazorpayFailure) => void) => void;
    };
  }
}

type AdminProductDraft = {
  name: string;
  category: string;
  price: number;
  original_price: number;
  image: string;
  description: string;
  badge: string;
  stock: number;
  tags: string[];
};

function App() {
  const [products, setProducts] = useState<Product[]>(fallbackProducts);
  const [category, setCategory] = useState("Everything");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("featured");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [wishlist, setWishlist] = useState<number[]>([]);
  const [compare, setCompare] = useState<number[]>([]);
  const [recent, setRecent] = useState<number[]>([]);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [drawer, setDrawer] = useState<"cart" | "wishlist" | "orders" | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: "I can find products, manage your bag and wishlist, guide checkout, and fill the newsletter signup. Try “add the mug” or “put me@example.com in the newsletter email field.” ✨" }]);
  const [chatInput, setChatInput] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [agentCheckoutStep, setAgentCheckoutStep] = useState<"idle" | "name" | "email" | "address" | "confirm">("idle");
  const [agentCheckoutDetails, setAgentCheckoutDetails] = useState({ name: "", email: "", address: "" });
  const voiceRecognition = useRef<VoiceRecognition | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const newsletterInput = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState<number | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authAdminSetupToken, setAuthAdminSetupToken] = useState("");
  const [authError, setAuthError] = useState("");
  const [googleSdkReady, setGoogleSdkReady] = useState(false);
  const [facebookSdkReady, setFacebookSdkReady] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const socialSignInHandler = useRef<(provider: "google" | "facebook", credential: string) => void>(() => {});
  const socialIntent = useRef<"signin" | "link">("signin");
  const [adminData, setAdminData] = useState<AdminSummary | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminTab, setAdminTab] = useState<"overview" | "products" | "orders">("overview");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
    name: "", category: "Home", price: "", original_price: "", image: "",
    description: "", badge: "NEW", stock: "10", tags: "",
  });
  const [adminError, setAdminError] = useState("");
  const [adminProductWizard, setAdminProductWizard] = useState<{
    step: "name" | "category" | "price" | "image" | "description" | "stock" | "confirm";
    draft: Partial<AdminProductDraft>;
  } | null>(null);
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<Product | null>(null);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  useEffect(() => {
    getProducts().then(setProducts).catch(() => {
      setToast("Using the demo catalog — connect the API to sync store data.");
    });
    const savedToken = localStorage.getItem("kartify_token");
    if (savedToken) {
      getAccount().then(setAccount).catch(() => {
        localStorage.removeItem("kartify_token");
      });
    }
  }, []);
  useEffect(() => {
    if (checkout && account) {
      setCustomerName(account.name);
      setEmail(account.email);
    }
  }, [account, checkout]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = products.filter((product) =>
      (category === "Everything" || product.category === category) &&
      (!query || `${product.name} ${product.category} ${product.description} ${product.tags.join(" ")}`.toLowerCase().includes(query)),
    );
    if (sort === "price-low") list.sort((a, b) => a.price - b.price);
    if (sort === "price-high") list.sort((a, b) => b.price - a.price);
    if (sort === "rating") list.sort((a, b) => b.rating - a.rating);
    return list;
  }, [category, products, search, sort]);
  const cartItems = products.filter((item) => cart[item.id]);
  const cartCount = Object.values(cart).reduce((sum, count) => sum + count, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.price * cart[item.id], 0);

  const addToCart = (product: Product) => {
    if ((cart[product.id] ?? 0) >= product.stock) {
      setToast(`Only ${product.stock} ${product.name} available.`);
      return;
    }
    setCart((current) => {
      return { ...current, [product.id]: (current[product.id] ?? 0) + 1 };
    });
    setToast(`${product.name} added to your bag`);
  };
  const toggleWishlist = (id: number) => {
    setWishlist((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setToast(wishlist.includes(id) ? "Removed from saved items" : "Saved for later");
  };
  const openProduct = (product: Product) => {
    setActiveProduct(product);
    setRecent((current) => [product.id, ...current.filter((id) => id !== product.id)].slice(0, 4));
  };
  const subscribeNewsletter = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newsletterEmail.trim())) {
      newsletterInput.current?.focus();
      setToast("Enter a valid email address to join the newsletter.");
      return;
    }
    setToast("Thanks! Newsletter email delivery isn’t configured on this local install yet.");
  };
  const appendAssistantMessage = (content: string) => {
    setMessages((current) => [...current, { role: "assistant", content }]);
  };
  const findMentionedProducts = (prompt: string) => {
    const normalized = prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return products
      .map((product) => {
        const nameParts = product.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ");
        const nameMatch = nameParts.filter((part) => part.length > 2).every((part) => normalized.includes(part));
        const distinctiveNameMatch = nameParts.some((part) =>
          part.length > 2 && !["the", "and", "for", "with"].includes(part) && normalized.split(" ").includes(part),
        );
        const tagMatch = product.tags.some((tag) => {
          const normalizedTag = tag.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          return normalizedTag.length > 2 &&
            normalized.split(" ").includes(normalizedTag) &&
            products.filter((candidate) => candidate.tags.some((candidateTag) => candidateTag.toLowerCase() === tag.toLowerCase())).length === 1;
        });
        const exactNameMatch = normalized.includes(product.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
        return { product, score: exactNameMatch ? 4 : nameMatch ? 3 : distinctiveNameMatch ? 2 : tagMatch ? 1 : 0 };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
  };
  const findMentionedProduct = (prompt: string) => findMentionedProducts(prompt)[0]?.product;
  const beginAgentCheckout = () => {
    if (!cartCount) {
      appendAssistantMessage("Your bag is empty. Tell me which product to add, then say “checkout” when you’re ready.");
      return;
    }
    if (!account) {
      setAuthMode("login");
      setAuthOpen(true);
      appendAssistantMessage("Please sign in or create an account before checkout. I’ll keep your bag while you do that.");
      return;
    }
    setAgentCheckoutDetails({
      name: account.name,
      email: account.email,
      address,
    });
    const nextStep = !address ? "address" : "confirm";
    setAgentCheckoutStep(nextStep);
    if (nextStep === "address") appendAssistantMessage("Voice checkout is ready. What’s the full delivery address?");
    else appendAssistantMessage(`Voice checkout is ready. Your bag is ${money(subtotal)}. Say “confirm order” to ${RAZORPAY_KEY_ID ? "open secure Razorpay checkout" : "place the demo order"}, or “cancel” to stop.`);
  };
  const finishAgentCheckout = async () => {
    if (!cartItems.length) {
      setAgentCheckoutStep("idle");
      appendAssistantMessage("Your bag is empty now, so I can’t place that order. Add an item and start checkout again.");
      return;
    }
    if (!account) {
      setAgentCheckoutStep("idle");
      setAuthMode("login");
      setAuthOpen(true);
      appendAssistantMessage("Please sign in before I can place an order. Your bag is still saved.");
      return;
    }
    setLoadingChat(true);
    try {
      const payload = {
        customer_name: account.name,
        email: account.email,
        address: agentCheckoutDetails.address,
        items: cartItems.map((item) => ({ product_id: item.id, quantity: cart[item.id] })),
      };
      const order = await placeCheckoutOrder(payload);
      setOrderNumber(order.id);
      setCart({});
      setCheckout(false);
      setAgentCheckoutStep("idle");
      setAgentCheckoutDetails({ name: "", email: "", address: "" });
      setDrawer("orders");
      appendAssistantMessage(RAZORPAY_KEY_ID
        ? `Payment verified. Order #${order.id} is confirmed for ${money(order.total)}.`
        : `Demo order #${order.id} is placed for ${money(order.total)}. Payment is simulated; no payment method was charged.`);
      if (account) {
        setOrdersLoading(true);
        getOrders().then(setCustomerOrders).catch((error: unknown) => {
          setToast(error instanceof Error ? error.message : "Order placed, but order history could not be refreshed.");
        }).finally(() => setOrdersLoading(false));
      }
    } catch (error) {
      appendAssistantMessage(error instanceof Error ? error.message : "I couldn’t place that order. Please check your bag and try again.");
    } finally {
      setLoadingChat(false);
    }
  };
  const processAssistantPrompt = async (input: string) => {
    const prompt = input.trim();
    if (!prompt || loadingChat) return;
    setMessages((current) => [...current, { role: "user", content: prompt }]);
    setChatInput("");
    setLoadingChat(true);
    try {
      const lowerPrompt = prompt.toLowerCase();
      if (agentCheckoutStep !== "idle" && /\b(cancel|never mind|nevermind|stop checkout)\b/.test(lowerPrompt)) {
        setAgentCheckoutStep("idle");
        setAgentCheckoutDetails({ name: "", email: "", address: "" });
        appendAssistantMessage("Checkout cancelled. Your bag is still saved.");
        return;
      }
      if (agentCheckoutStep !== "idle") {
        if (agentCheckoutStep === "confirm") {
          if (/\b(confirm|yes|place it|place order|buy now)\b/.test(lowerPrompt)) {
            await finishAgentCheckout();
          } else {
            appendAssistantMessage("I haven’t placed the order. Say “confirm order” to place it, or “cancel” to stop.");
          }
          return;
        }
        if (agentCheckoutStep === "name") {
          if (prompt.trim().length < 2) {
            appendAssistantMessage("Please say a full name with at least two characters.");
            return;
          }
          setCustomerName(prompt.trim());
          setAgentCheckoutDetails((current) => ({ ...current, name: prompt.trim() }));
          setAgentCheckoutStep("email");
          appendAssistantMessage("Thanks. What email should receive the order updates?");
          return;
        }
        if (agentCheckoutStep === "email") {
          const spokenEmail = prompt.toLowerCase().replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s+/g, "");
          const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(spokenEmail);
          if (!validEmail) {
            appendAssistantMessage("That doesn’t look like a valid email address. Please say it again.");
            return;
          }
          setEmail(spokenEmail);
          setAgentCheckoutDetails((current) => ({ ...current, email: spokenEmail }));
          setAgentCheckoutStep("address");
          appendAssistantMessage("What’s the full delivery address?");
          return;
        }
        if (agentCheckoutStep === "address") {
          if (prompt.trim().length < 8) {
            appendAssistantMessage("Please provide a fuller delivery address, including the locality or PIN code.");
            return;
          }
          const details = { ...agentCheckoutDetails, address: prompt.trim() };
          setAddress(prompt.trim());
          setAgentCheckoutDetails(details);
          setAgentCheckoutStep("confirm");
          appendAssistantMessage(`Please review: ${cartItems.map((item) => `${item.name} × ${cart[item.id]}`).join(", ")}. Total ${money(subtotal)}. Delivery to ${details.name} at ${details.address}. Say “confirm order” to place it, or “cancel”.`);
          return;
        }
      }

      if (adminProductWizard) {
        if (/\b(cancel|never mind|nevermind)\b/i.test(prompt)) {
          setAdminProductWizard(null);
          appendAssistantMessage("Product creation cancelled. Nothing was published.");
          return;
        }
        if (!account?.is_admin) {
          setAdminProductWizard(null);
          appendAssistantMessage("Only the configured admin can create products. Sign in with that account first.");
          return;
        }
        const { step, draft } = adminProductWizard;
        if (step === "confirm") {
          if (!/\b(yes|confirm|publish|save|publish it|save it)\b/i.test(prompt)) {
            appendAssistantMessage("I haven’t published the product. Say “publish it” to confirm, or “cancel” to discard it.");
            return;
          }
          setLoadingChat(true);
          try {
            const product = await saveProduct({
              name: draft.name!,
              category: draft.category!,
              price: draft.price!,
              original_price: draft.original_price!,
              image: draft.image!,
              description: draft.description!,
              badge: draft.badge ?? "NEW",
              stock: draft.stock ?? 10,
              tags: draft.tags ?? [],
            });
            setProducts((current) => [product, ...current.filter((item) => item.id !== product.id)]);
            setAdminProductWizard(null);
            await loadAdmin();
            appendAssistantMessage(`${product.name} is published in the catalog at ${money(product.price)} with ${product.stock} in stock.`);
          } catch (error) {
            appendAssistantMessage(error instanceof Error ? `I couldn’t publish the product: ${error.message}` : "I couldn’t publish the product.");
          } finally {
            setLoadingChat(false);
          }
          return;
        }
        if (step === "name") {
          if (prompt.trim().length < 2) {
            appendAssistantMessage("Please give the product a name with at least two characters.");
            return;
          }
          setAdminProductWizard({ step: "category", draft: { ...draft, name: prompt.trim() } });
          appendAssistantMessage(`What category should ${prompt.trim()} go in? Choose Clothing, Home, Accessories, or Footwear.`);
          return;
        }
        if (step === "category") {
          const selectedCategory = categories.find((item) => item.toLowerCase() === prompt.trim().toLowerCase() && item !== "Everything");
          if (!selectedCategory) {
            appendAssistantMessage("Choose one of these categories: Clothing, Home, Accessories, or Footwear.");
            return;
          }
          setAdminProductWizard({ step: "price", draft: { ...draft, category: selectedCategory } });
          appendAssistantMessage("What is the selling price in rupees?");
          return;
        }
        if (step === "price") {
          const price = Number(prompt.replace(/[₹,\s]/g, ""));
          if (!Number.isFinite(price) || price <= 0) {
            appendAssistantMessage("Please provide a valid price greater than zero, such as 1299.");
            return;
          }
          setAdminProductWizard({ step: "image", draft: { ...draft, price, original_price: price } });
          appendAssistantMessage("What image URL should the product use?");
          return;
        }
        if (step === "image") {
          try {
            const imageUrl = new URL(prompt.trim());
            if (!["http:", "https:"].includes(imageUrl.protocol)) throw new Error("Invalid image URL");
            setAdminProductWizard({ step: "description", draft: { ...draft, image: imageUrl.toString() } });
            appendAssistantMessage("Give me a short product description.");
          } catch {
            appendAssistantMessage("Please send a valid http or https image URL.");
          }
          return;
        }
        if (step === "description") {
          if (prompt.trim().length < 5) {
            appendAssistantMessage("Please provide a description with at least five characters.");
            return;
          }
          setAdminProductWizard({ step: "stock", draft: { ...draft, description: prompt.trim() } });
          appendAssistantMessage("How many are in stock? You can say “skip” to use the default of 10.");
          return;
        }
        const stock = /^skip$/i.test(prompt.trim()) ? 10 : Number(prompt.trim());
        if (!Number.isInteger(stock) || stock < 0) {
          appendAssistantMessage("Stock must be a whole number zero or greater. You can also say “skip” for 10.");
          return;
        }
        const completedDraft: AdminProductDraft = {
          name: draft.name!,
          category: draft.category!,
          price: draft.price!,
          original_price: draft.original_price!,
          image: draft.image!,
          description: draft.description!,
          badge: "NEW",
          stock,
          tags: [],
        };
        setAdminProductWizard({ step: "confirm", draft: completedDraft });
        appendAssistantMessage(`Ready to publish ${completedDraft.name} (${completedDraft.category}) for ${money(completedDraft.price)}, with ${completedDraft.stock} in stock. Say “publish it” to confirm or “cancel”.`);
        return;
      }
      if (pendingDeleteProduct) {
        if (!/\b(confirm|yes|delete it)\b/i.test(prompt)) {
          setPendingDeleteProduct(null);
          appendAssistantMessage(`Deletion cancelled. ${pendingDeleteProduct.name} is still in the catalog.`);
          return;
        }
        if (!account?.is_admin) {
          setPendingDeleteProduct(null);
          appendAssistantMessage("Only the configured admin can delete products.");
          return;
        }
        try {
          await removeProduct(pendingDeleteProduct.id);
          setProducts((current) => current.filter((item) => item.id !== pendingDeleteProduct.id));
          const deletedName = pendingDeleteProduct.name;
          setPendingDeleteProduct(null);
          await loadAdmin();
          appendAssistantMessage(`${deletedName} was removed from the catalog.`);
        } catch (error) {
          setPendingDeleteProduct(null);
          appendAssistantMessage(error instanceof Error ? `I couldn’t delete the product: ${error.message}` : "I couldn’t delete the product.");
        }
        return;
      }

      const emailMatch = prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (emailMatch && /\b(write|put|fill|type|enter|use|add)\b/i.test(prompt) &&
        /\b(email|newsletter|inbox|subscribe|subscription|input|field|address)\b/i.test(prompt)) {
        const value = emailMatch[0];
        const target = /\b(checkout|delivery|order)\b/i.test(prompt) ? "checkout" :
          /\b(sign ?in|log ?in|account|register|sign ?up)\b/i.test(prompt) ? "account" : "newsletter";
        if (target === "checkout") {
          if (account) {
            appendAssistantMessage(`Checkout uses the signed-in account email, ${account.email}. Sign out and use the intended account if you need a different one.`);
            return;
          }
          setEmail(value);
          setAgentCheckoutDetails((current) => ({ ...current, email: value }));
          appendAssistantMessage(`Filled the checkout email with ${value}.`);
          return;
        }
        if (target === "account") {
          setAuthEmail(value);
          setAuthOpen(true);
          appendAssistantMessage(`Filled the account email with ${value}. Enter your password in the sign-in form; I won’t collect passwords in chat.`);
          return;
        }
        setNewsletterEmail(value);
        document.querySelector(".newsletter")?.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => newsletterInput.current?.focus(), 250);
        appendAssistantMessage(`Filled the newsletter email field with ${value}. Say “subscribe me” to submit it.`);
        return;
      }
      if (/\b(subscribe me|sign me up|join the newsletter|count me in|subscribe to (the )?newsletter)\b/i.test(prompt)) {
        if (!newsletterEmail.trim()) {
          document.querySelector(".newsletter")?.scrollIntoView({ behavior: "smooth", block: "center" });
          window.setTimeout(() => newsletterInput.current?.focus(), 250);
          appendAssistantMessage("What email address should I use for the newsletter?");
          return;
        }
        subscribeNewsletter();
        appendAssistantMessage(`I checked the address ${newsletterEmail}, but newsletter delivery and subscriber storage aren’t configured on this local install yet.`);
        return;
      }

      const mentionedProduct = findMentionedProduct(prompt);
      const orderStatusMatch = prompt.match(/\b(?:order\s*#?\s*(\d+).*?\b(processing|shipped|delivered|cancelled)\b|(?:set|mark|change|update)\s+order\s*#?\s*(\d+)\s+(?:to|as)\s+(processing|shipped|delivered|cancelled))\b/i);
      if (orderStatusMatch) {
        if (!account?.is_admin) {
          appendAssistantMessage("Updating order status is restricted to the configured store admin.");
          return;
        }
        const orderId = Number(orderStatusMatch[1] ?? orderStatusMatch[3]);
        const status = (orderStatusMatch[2] ?? orderStatusMatch[4]).replace(/^\w/, (letter) => letter.toUpperCase());
        const updated = await setAdminOrderStatus(orderId, status);
        appendAssistantMessage(updated ? `I updated order #${orderId} to ${status}.` : `I couldn’t update order #${orderId}. The API rejected the update or could not be reached.`);
        return;
      }
      if (/\b(sign in|log in|login|create an account|sign up|register)\b/i.test(prompt)) {
        setAuthMode(/\b(sign up|register|create an account)\b/i.test(prompt) ? "signup" : "login");
        setAuthOpen(true);
        appendAssistantMessage("I opened the account form. Enter your password there; for your security, don’t send passwords in chat.");
        return;
      }
      if (/\b(dark mode|light mode|theme)\b/i.test(prompt)) {
        const wantsDark = /\b(dark|night)\b/i.test(prompt) ? true : /\b(light|day)\b/i.test(prompt) ? false : !dark;
        setDark(wantsDark);
        appendAssistantMessage(`Switched to ${wantsDark ? "dark" : "light"} mode.`);
        return;
      }
      const categoryMatch = categories.find((item) => item !== "Everything" && prompt.toLowerCase().includes(item.toLowerCase()));
      if (/\b(category|browse|show|filter)\b/i.test(prompt) && categoryMatch) {
        setCategory(categoryMatch);
        setSearch("");
        document.querySelector("#shop")?.scrollIntoView({ behavior: "smooth" });
        appendAssistantMessage(`Showing ${categoryMatch} products.`);
        return;
      }
      const sortIntent = /\b(sort|order)\b/i.test(prompt);
      if (sortIntent && /\b(price|cheapest|lowest|low to high)\b/i.test(prompt)) {
        setSort("price-low");
        appendAssistantMessage("Sorted products by price, low to high.");
        return;
      }
      if (sortIntent && /\b(expensive|highest|high to low)\b/i.test(prompt)) {
        setSort("price-high");
        appendAssistantMessage("Sorted products by price, high to low.");
        return;
      }
      if (sortIntent && /\b(rating|rated|top rated)\b/i.test(prompt)) {
        setSort("rating");
        appendAssistantMessage("Sorted products by customer rating.");
        return;
      }
      const searchMatch = prompt.match(/^(?:please\s+)?search\s+(?:the\s+)?(?:products?\s+)?(?:for\s+)?(.+)$/i);
      if (searchMatch) {
        setSearch(searchMatch[1].trim());
        setCategory("Everything");
        document.querySelector("#shop")?.scrollIntoView({ behavior: "smooth" });
        appendAssistantMessage(`Searching the catalog for “${searchMatch[1].trim()}”.`);
        return;
      }
      if (/\b(clear|reset)\s+(search|filters?)\b/i.test(prompt) || /\bshow (me )?(everything|all products)\b/i.test(prompt)) {
        setCategory("Everything");
        setSearch("");
        setSort("featured");
        appendAssistantMessage("Cleared the search and filters. Showing all products.");
        return;
      }
      if (/\b(open|go to|show)\s+(seller studio|admin|dashboard)\b/i.test(prompt)) {
        openSellerStudio();
        appendAssistantMessage(account?.is_admin ? "Opened the seller studio." : "Seller studio is restricted to your configured admin account.");
        return;
      }
      const adminTabMatch = prompt.match(/\b(?:open|show|go to)\s+(?:my\s+)?(products|orders|overview)\b/i);
      if (adminTabMatch) {
        if (!account?.is_admin && !adminOpen) {
          if (adminTabMatch[1].toLowerCase() === "products") {
            document.querySelector("#shop")?.scrollIntoView({ behavior: "smooth" });
            appendAssistantMessage("The product catalog is open above. You can search or filter it by category.");
            return;
          }
          if (adminTabMatch[1].toLowerCase() === "orders") {
            openOrderHistory();
            appendAssistantMessage(account ? "I opened your order history." : "Please sign in to see your private order history.");
            return;
          }
        }
        if (!account?.is_admin) {
          appendAssistantMessage("The seller studio is restricted to the configured admin account.");
          return;
        }
        const tab = adminTabMatch[1].toLowerCase() as "products" | "orders" | "overview";
        setAdminOpen(true);
        setAdminTab(tab);
        void loadAdmin();
        appendAssistantMessage(`Opened seller studio ${tab}.`);
        return;
      }
      if (/\b(add|create|new)\s+(a\s+)?product\b/i.test(prompt)) {
        if (!account?.is_admin) {
          appendAssistantMessage("Only the configured admin can publish products. Sign in with that account first.");
          return;
        }
        setAdminProductWizard({ step: "name", draft: {} });
        appendAssistantMessage("Let’s add a product. What should its name be? Say “cancel” any time to stop.");
        return;
      }
      if (/\b(sign out|log out)\b/i.test(prompt)) {
        if (account) {
          signOut();
          appendAssistantMessage("You’re signed out.");
        } else appendAssistantMessage("You’re already signed out.");
        return;
      }
      if (/\b(clear|empty)\s+(my\s+)?(cart|bag)\b/.test(lowerPrompt)) {
        setCart({});
        appendAssistantMessage("Your bag is empty now.");
        return;
      }
      if (/\b(show|open|view|check)\s+(my\s+)?(cart|bag)\b/.test(lowerPrompt)) {
        setDrawer("cart");
        setCheckout(false);
        appendAssistantMessage(cartCount ? `Your bag has ${cartCount} item${cartCount === 1 ? "" : "s"}, subtotal ${money(subtotal)}.` : "Your bag is empty. Tell me a product name and I can add it.");
        return;
      }
      if (/\b(show|open|view)\s+(my\s+)?(wishlist|saved items|favorites|favourites)\b/.test(lowerPrompt)) {
        setDrawer("wishlist");
        appendAssistantMessage(`I’ve opened your saved items. There ${wishlist.length === 1 ? "is" : "are"} ${wishlist.length} saved product${wishlist.length === 1 ? "" : "s"}.`);
        return;
      }
      if (/\b(checkout|check out|place order|buy now|complete (my )?order)\b/.test(lowerPrompt)) {
        beginAgentCheckout();
        return;
      }
      if (/\b(order history|my orders|track (my )?order|order status)\b/.test(lowerPrompt)) {
        openOrderHistory();
        appendAssistantMessage(account ? "I’ve opened your order history." : "Please sign in to see your private order history.");
        return;
      }
      if (mentionedProduct && /\b(remove|delete)\b/.test(lowerPrompt)) {
        if (/\b(product|catalog|store)\b/.test(lowerPrompt)) {
          if (!account?.is_admin) {
            appendAssistantMessage("Only the configured admin can delete catalog products.");
            return;
          }
          setPendingDeleteProduct(mentionedProduct);
          appendAssistantMessage(`Are you sure you want to delete ${mentionedProduct.name}? This action may be blocked if it has reviews or order history. Say “confirm delete” to proceed, or “cancel”.`);
          return;
        }
        if (/\b(wishlist|saved|favorite|favourite)\b/.test(lowerPrompt)) {
          setWishlist((current) => current.filter((id) => id !== mentionedProduct.id));
          appendAssistantMessage(`Removed ${mentionedProduct.name} from your saved items.`);
          return;
        }
        setCart((current) => {
          const next = { ...current };
          const currentQuantity = next[mentionedProduct.id] ?? 0;
          const quantityMatch = lowerPrompt.match(/\b(?:remove|delete)\s+(one|two|three|four|five|\d+)\b/);
          const amountWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
          const removeQuantity = quantityMatch ? Number(quantityMatch[1]) || amountWords[quantityMatch[1]] || 1 : currentQuantity;
          if (currentQuantity > removeQuantity) next[mentionedProduct.id] = currentQuantity - removeQuantity;
          else delete next[mentionedProduct.id];
          return next;
        });
        appendAssistantMessage(`Removed ${mentionedProduct.name} from your bag.`);
        return;
      }
      if (mentionedProduct && /\b(set|change)\b/.test(lowerPrompt) && /\b(quantity|amount)\b/.test(lowerPrompt)) {
        const quantityWords: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5 };
        const quantityMatch = lowerPrompt.match(/\b(?:to|at)\s+(zero|one|two|three|four|five|\d+)\b/);
        if (!quantityMatch) {
          appendAssistantMessage("Tell me the quantity to set, for example “set the mug quantity to 2”.");
          return;
        }
        const quantity = Number(quantityMatch[1]) || quantityWords[quantityMatch[1]] || 0;
        if (quantity > mentionedProduct.stock) {
          appendAssistantMessage(`Only ${mentionedProduct.stock} ${mentionedProduct.name} are in stock.`);
          return;
        }
        setCart((current) => {
          const next = { ...current };
          if (quantity) next[mentionedProduct.id] = quantity;
          else delete next[mentionedProduct.id];
          return next;
        });
        appendAssistantMessage(quantity ? `Set ${mentionedProduct.name} quantity to ${quantity}.` : `Removed ${mentionedProduct.name} from your bag.`);
        return;
      }
      if (mentionedProduct && /\b(set|change|update|edit|rename)\b/.test(lowerPrompt)) {
        if (!account?.is_admin) {
          appendAssistantMessage("Only the configured admin can edit catalog products.");
          return;
        }
        const fieldMatch = lowerPrompt.match(/\b(name|title|category|price|image|description|badge|tags?|stock|inventory|units)\b/);
        const valueMatch = prompt.match(/\bto\s+(.+)$/i);
        if (!fieldMatch || !valueMatch) {
          appendAssistantMessage("Tell me which product field to change and its new value, for example “change the mug price to 800”.");
          return;
        }
        const field = fieldMatch[1];
        const value = valueMatch[1].trim();
        let changes: Partial<AdminProductDraft> = {};
        if (["stock", "inventory", "units"].includes(field)) {
          const stock = Number(value);
          if (!Number.isInteger(stock) || stock < 0) {
            appendAssistantMessage("Stock must be a whole number zero or greater.");
            return;
          }
          changes = { stock };
        } else if (field === "price") {
          const price = Number(value.replace(/[₹,\s]/g, ""));
          if (!Number.isFinite(price) || price <= 0) {
            appendAssistantMessage("Price must be a number greater than zero.");
            return;
          }
          changes = { price };
        } else if (field === "category") {
          const selectedCategory = categories.find((item) => item.toLowerCase() === value.toLowerCase() && item !== "Everything");
          if (!selectedCategory) {
            appendAssistantMessage("Choose Clothing, Home, Accessories, or Footwear for the category.");
            return;
          }
          changes = { category: selectedCategory };
        } else if (field === "name" || field === "title") {
          if (value.length < 2) {
            appendAssistantMessage("A product name must have at least two characters.");
            return;
          }
          changes = { name: value };
        } else if (field === "image") {
          try {
            const imageUrl = new URL(value);
            if (!["http:", "https:"].includes(imageUrl.protocol)) throw new Error("Invalid URL");
            changes = { image: imageUrl.toString() };
          } catch {
            appendAssistantMessage("Please use a valid http or https image URL.");
            return;
          }
        } else if (field === "description") {
          if (value.length < 5) {
            appendAssistantMessage("A product description must have at least five characters.");
            return;
          }
          changes = { description: value };
        } else if (field === "badge") {
          changes = { badge: value };
        } else {
          changes = { tags: value.split(",").map((tag) => tag.trim()).filter(Boolean) };
        }
        try {
          const updated = await saveProduct({
            id: mentionedProduct.id,
            name: changes.name ?? mentionedProduct.name,
            category: changes.category ?? mentionedProduct.category,
            price: changes.price ?? mentionedProduct.price,
            original_price: mentionedProduct.original_price,
            image: changes.image ?? mentionedProduct.image,
            description: changes.description ?? mentionedProduct.description,
            badge: changes.badge ?? mentionedProduct.badge,
            stock: changes.stock ?? mentionedProduct.stock,
            tags: changes.tags ?? mentionedProduct.tags,
            rating: mentionedProduct.rating,
            review_count: mentionedProduct.review_count,
          });
          setProducts((current) => current.map((item) => item.id === updated.id ? updated : item));
          await loadAdmin();
          appendAssistantMessage(`Updated ${mentionedProduct.name}: ${field} is now ${value}.`);
        } catch (error) {
          appendAssistantMessage(error instanceof Error ? `I couldn’t update the product: ${error.message}` : "I couldn’t update the product.");
        }
        return;
      }
      if (mentionedProduct && /\b(save|wishlist|favorite|favourite)\b/.test(lowerPrompt)) {
        setWishlist((current) => current.includes(mentionedProduct.id) ? current : [...current, mentionedProduct.id]);
        appendAssistantMessage(`${mentionedProduct.name} is saved to your wishlist.`);
        return;
      }
      if (mentionedProduct && /\b(add|put|want|buy|get|book|order)\b/.test(lowerPrompt)) {
        const amountWords: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5 };
        const quantityMatch = lowerPrompt.match(/\b(?:add|put)\s+(one|two|three|four|five|\d+)\b/);
        const requestedQuantity = quantityMatch ? Number(quantityMatch[1]) || amountWords[quantityMatch[1]] || 1 : 1;
        const available = mentionedProduct.stock - (cart[mentionedProduct.id] ?? 0);
        if (available < requestedQuantity) {
          appendAssistantMessage(available > 0 ? `There are only ${available} ${mentionedProduct.name} left to add.` : `${mentionedProduct.name} is out of stock in the quantity you asked for.`);
          return;
        }
        setCart((current) => ({ ...current, [mentionedProduct.id]: (current[mentionedProduct.id] ?? 0) + requestedQuantity }));
        appendAssistantMessage(`Added ${requestedQuantity} × ${mentionedProduct.name} to your bag. Say “checkout” whenever you’re ready.`);
        return;
      }
      if (mentionedProduct && /\b(open|show|details|tell me about)\b/.test(lowerPrompt)) {
        openProduct(mentionedProduct);
        appendAssistantMessage(`Here are the details for ${mentionedProduct.name}.`);
        return;
      }
      if (/\b(compare|comparison)\b/.test(lowerPrompt) && mentionedProduct) {
        const comparisonProducts = findMentionedProducts(prompt)
          .filter(({ score }) => score >= 2)
          .map(({ product }) => product);
        const selected = comparisonProducts.length > 1 ? comparisonProducts : [mentionedProduct];
        setCompare((current) => [...new Set([...current, ...selected.map((product) => product.id)])].slice(-3));
        appendAssistantMessage(`Added ${selected.map((product) => product.name).join(" and ")} to the comparison.`);
        return;
      }
      if (/\b(clear|remove)\s+(the\s+)?(comparison|compare list)\b/i.test(prompt)) {
        setCompare([]);
        appendAssistantMessage("Cleared the comparison list.");
        return;
      }
      const result = await askAssistant(prompt, products);
      appendAssistantMessage(result.reply);
      if (result.products.length) setProducts((current) => current.map((item) => result.products.find((match) => match.id === item.id) ?? item));
    } catch (error) {
      appendAssistantMessage(error instanceof Error ? `I couldn’t reach the shopping service: ${error.message}` : "I couldn’t reach the shopping service. Please try again.");
    } finally { setLoadingChat(false); }
  };
  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    void processAssistantPrompt(chatInput);
  };
  const toggleVoiceInput = () => {
    if (voiceListening) {
      voiceRecognition.current?.stop();
      return;
    }
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError("Voice input isn’t supported in this browser. Try Chrome or Edge, or type your request.");
      return;
    }
    setVoiceError("");
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-IN";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
      if (transcript) void processAssistantPrompt(transcript);
    };
    recognition.onerror = (event) => {
      setVoiceError(event.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser’s site settings." : `Voice input failed (${event.error}). You can still type your request.`);
      setVoiceListening(false);
    };
    recognition.onend = () => setVoiceListening(false);
    voiceRecognition.current = recognition;
    try {
      recognition.start();
      setVoiceListening(true);
    } catch {
      setVoiceError("Couldn’t start the microphone. Please try again or type your request.");
      setVoiceListening(false);
    }
  };
  const submitCheckout = async (event: FormEvent) => {
    event.preventDefault();
    if (!account) {
      setAuthMode("login");
      setAuthOpen(true);
      setToast("Sign in or create an account before placing an order.");
      return;
    }
    setPaymentLoading(true);
    try {
      const payload = {
        customer_name: account.name,
        email: account.email,
        address,
        items: cartItems.map((item) => ({ product_id: item.id, quantity: cart[item.id] })),
      };
      const order = await placeCheckoutOrder(payload);
      setOrderNumber(order.id);
      setCart({});
      setCheckout(false);
      setDrawer("orders");
      if (account) {
        setOrdersLoading(true);
        getOrders().then(setCustomerOrders).catch((error: unknown) => {
          setToast(error instanceof Error ? error.message : "Order placed, but order history could not be refreshed.");
        }).finally(() => setOrdersLoading(false));
      }
      setToast(RAZORPAY_KEY_ID
        ? `Payment verified — order #${order.id} confirmed.`
        : `Demo order #${order.id} placed — payment is simulated.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not place your order");
    } finally {
      setPaymentLoading(false);
    }
  };
  const openOrderHistory = () => {
    setDrawer("orders");
    if (!account) return;
    setOrdersLoading(true);
    getOrders().then(setCustomerOrders).catch((error: unknown) => {
      setToast(error instanceof Error ? error.message : "Could not load order history.");
    }).finally(() => setOrdersLoading(false));
  };
  const loadAdmin = async () => {
    setAdminLoading(true);
    setAdminError("");
    try {
      const summary = await getAdminSummary();
      setAdminData(summary);
      setProducts(summary.products);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not load the seller studio.");
    } finally {
      setAdminLoading(false);
    }
  };
  const openSellerStudio = () => {
    if (!account) {
      setAuthMode("login");
      setAuthOpen(true);
      setToast("Sign in with your configured admin account to open the seller studio.");
      return;
    }
    if (!account.is_admin) {
      setToast("Seller studio access is only available to the configured admin account.");
      return;
    }
    setAdminOpen(true);
    setAdminTab("overview");
    void loadAdmin();
  };
  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError("");
    try {
      const result = await authenticate(authMode, {
        ...(authMode === "signup" ? { name: authName } : {}),
        email: authEmail,
        password: authPassword,
        ...(authAdminSetupToken.trim() ? { admin_setup_token: authAdminSetupToken } : {}),
      });
      localStorage.setItem("kartify_token", result.access_token);
      let signedInAccount = result.user;
      if (authMode === "login" && authAdminSetupToken.trim()) {
        try {
          await claimAdminAccess(authAdminSetupToken);
          signedInAccount = await getAccount();
        } catch (error) {
          localStorage.removeItem("kartify_token");
          throw error;
        }
      }
      setAccount(signedInAccount);
      setAuthOpen(false);
      setAuthPassword("");
      setAuthAdminSetupToken("");
      setToast(`Welcome${signedInAccount.name ? `, ${signedInAccount.name.split(" ")[0]}` : ""}!`);
      if (signedInAccount.is_admin) {
        setAdminOpen(true);
        void loadAdmin();
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign in failed. Please try again.");
    }
  };
  const finishSocialSignIn = async (provider: "google" | "facebook", credential: string) => {
    setAuthError("");
    try {
      const result = await authenticateSocial(provider, credential, authAdminSetupToken);
      localStorage.setItem("kartify_token", result.access_token);
      setAccount(result.user);
      setAuthOpen(false);
      setAuthAdminSetupToken("");
      setToast(`Welcome${result.user.name ? `, ${result.user.name.split(" ")[0]}` : ""}!`);
      if (result.user.is_admin) {
        setAdminOpen(true);
        void loadAdmin();
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : `${provider} sign-in failed. Please try again.`);
    }
  };
  const finishSocialLink = async (provider: "google" | "facebook", credential: string) => {
    setAuthError("");
    try {
      await linkSocialAccount(provider, credential);
      setToast(`${provider === "google" ? "Google" : "Facebook"} linked to your Kartify account.`);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : `Could not link ${provider}. Please try again.`);
    }
  };
  socialIntent.current = account ? "link" : "signin";
  socialSignInHandler.current = (provider, credential) => {
    if (socialIntent.current === "link") void finishSocialLink(provider, credential);
    else void finishSocialSignIn(provider, credential);
  };
  useEffect(() => {
    if (GOOGLE_CLIENT_ID) {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => setGoogleSdkReady(Boolean(window.google?.accounts.id));
      script.onerror = () => setAuthError("Google sign-in could not load. Check your connection and try again.");
      document.head.append(script);
    }
    if (FACEBOOK_APP_ID) {
      window.fbAsyncInit = () => {
        window.FB?.init({ appId: FACEBOOK_APP_ID, cookie: true, xfbml: false, version: "v22.0" });
        setFacebookSdkReady(Boolean(window.FB));
      };
      const script = document.createElement("script");
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      script.onerror = () => setAuthError("Facebook sign-in could not load. Check your connection and try again.");
      document.head.append(script);
    }
  }, []);
  useEffect(() => {
    if (!authOpen || !googleSdkReady || !GOOGLE_CLIENT_ID || !googleButton.current || !window.google) return;
    googleButton.current.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        if (response.credential) socialSignInHandler.current("google", response.credential);
        else setAuthError("Google did not return a sign-in credential. Please try again.");
      },
    });
    window.google.accounts.id.renderButton(googleButton.current, {
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      width: 320,
    });
  }, [account, authOpen, googleSdkReady]);
  const startFacebookSignIn = () => {
    if (!window.FB) {
      setAuthError("Facebook sign-in is still loading. Please try again in a moment.");
      return;
    }
    window.FB.login((response) => {
      const credential = response.authResponse?.accessToken;
      if (credential) socialSignInHandler.current("facebook", credential);
      else if (response.status !== "unknown") setAuthError("Facebook sign-in was cancelled. You can try again.");
    }, { scope: "email,public_profile" });
  };
  const explainSocialSetup = (provider: "google" | "facebook") => {
    setAuthError(provider === "google"
      ? "Google sign-in isn’t configured yet. Set VITE_GOOGLE_CLIENT_ID in frontend/.env.local and GOOGLE_CLIENT_ID in backend/.env, then restart both servers."
      : "Facebook sign-in isn’t configured yet. Set VITE_FACEBOOK_APP_ID in frontend/.env.local, then set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in backend/.env. Restart both servers.");
  };
  const signOut = () => {
    localStorage.removeItem("kartify_token");
    setAccount(null);
    setAdminOpen(false);
    setAdminData(null);
    setToast("You’ve been signed out.");
  };
  const startProductEdit = (product: Product) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      category: product.category,
      price: String(product.price),
      original_price: String(product.original_price),
      image: product.image,
      description: product.description,
      badge: product.badge,
      stock: String(product.stock),
      tags: product.tags.join(", "),
    });
    setAdminTab("products");
  };
  const resetProductForm = () => {
    setEditingProduct(null);
    setProductForm({ name: "", category: "Home", price: "", original_price: "", image: "", description: "", badge: "NEW", stock: "10", tags: "" });
  };
  const submitProduct = async (event: FormEvent) => {
    event.preventDefault();
    setAdminError("");
    try {
      const product = await saveProduct({
        ...(editingProduct ? { id: editingProduct.id, rating: editingProduct.rating, review_count: editingProduct.review_count } : {}),
        name: productForm.name.trim(),
        category: productForm.category,
        price: Number(productForm.price),
        original_price: Number(productForm.original_price || productForm.price),
        image: productForm.image.trim(),
        description: productForm.description.trim(),
        badge: productForm.badge.trim(),
        stock: Number(productForm.stock),
        tags: productForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      setProducts((current) => editingProduct ? current.map((item) => item.id === product.id ? product : item) : [product, ...current]);
      resetProductForm();
      await loadAdmin();
      setToast(editingProduct ? "Product changes saved." : "Product published to your store.");
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not save this product.");
    }
  };
  const deleteAdminProduct = async (product: Product) => {
    if (!window.confirm(`Delete "${product.name}" from your catalog?`)) return;
    setAdminError("");
    try {
      await removeProduct(product.id);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      await loadAdmin();
      setToast("Product removed from the catalog.");
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not delete this product.");
    }
  };
  const setAdminOrderStatus = async (id: number, status: string) => {
    try {
      await updateOrderStatus(id, status);
      await loadAdmin();
      setToast(`Order #${id} updated to ${status}.`);
      return true;
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not update this order.");
      return false;
    }
  };

  return (
    <main className={dark ? "app dark" : "app"}>
      <div className="announcement"><Sparkles size={14} /> A little something for your next good day <span>— free delivery over ₹1,999</span></div>
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="Open menu"><Menu size={20} /></button>
        <a className="wordmark" href="#" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>kartify<span>.</span></a>
        <nav className="main-nav"><a href="#shop">Discover</a><a href="#shop" onClick={() => setCategory("Home")}>Home & living</a><a href="#shop" onClick={() => setCategory("Clothing")}>Clothing</a><a href="#story">Our story</a></nav>
        <div className="header-actions">
          <button className="icon-button theme-button" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button className="icon-button account-button" onClick={() => setAuthOpen(true)} aria-label={account ? "Account settings" : "Sign in"}><UserRound size={19} /><span className="action-label">{account ? account.name.split(" ")[0] : "Sign in"}</span></button>
          {account?.is_admin && <button className="icon-button studio-button" onClick={openSellerStudio} aria-label="Open seller studio"><LayoutDashboard size={18} /><span className="action-label">Studio</span></button>}
          <button className="icon-button" onClick={() => setDrawer("wishlist")} aria-label="Wishlist"><Heart size={20} /><span className="action-label">Saved</span>{wishlist.length > 0 && <i className="count-dot">{wishlist.length}</i>}</button>
          <button className="icon-button" onClick={() => setDrawer("cart")} aria-label="Shopping bag"><ShoppingBag size={20} /><span className="action-label">Bag</span><i className="count-dot">{cartCount}</i></button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-line" /> GOOD FINDS, MADE PERSONAL</span>
          <h1>Find your<br /><em>kind of</em> lovely.</h1>
          <p>Thoughtful little things for the life you’re making. Picked with care, just for you.</p>
          <div className="hero-buttons"><a className="button primary" href="#shop">Find your thing <ArrowRight size={16} /></a><button className="button text-button" onClick={() => setAssistantOpen(true)}><Sparkles size={16} /> Ask our little helper</button></div>
          <div className="hero-proof"><div className="avatar-stack"><span>✿</span><span>☺</span><span>✦</span></div><div><strong>Loved by 12,000+ happy humans</strong><small>4.9/5 from real, lovely people</small></div></div>
        </div>
        <div className="hero-art">
          <div className="hero-image-wrap"><img src="https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1300&q=90" alt="A curated outfit laid out in soft natural light" /></div>
          <div className="floating-note"><span className="note-sparkle">✳</span><span>Made for your<br /><b>everyday magic</b></span></div>
          <div className="hero-caption">THE SLOW SUNDAY EDIT <ArrowUpRight size={13} /></div>
        </div>
        <div className="hero-index">01 <span>/</span> 04</div>
      </section>

      <section className="trust-strip"><span><Check size={15} /> Thoughtfully picked</span><i /><span><Check size={15} /> Easy 7-day returns</span><i /><span><Check size={15} /> Made to make you smile</span><i /><span className="trust-promo">Use <b>HELLO10</b> for 10% off your first order</span></section>

      <section className="shop-section" id="shop">
        <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> THE GOOD STUFF</span><h2>A little bit of <em>everything.</em></h2></div><button className="link-button" onClick={() => { setCategory("Everything"); setSearch(""); }}>See it all <ArrowRight size={15} /></button></div>
        <div className="shop-toolbar">
          <div className="category-tabs">{categories.map((item) => <button key={item} className={category === item ? "category-tab active" : "category-tab"} onClick={() => setCategory(item)}>{item}</button>)}</div>
          <div className="shop-tools"><label className="search-box"><Search size={16} /><input aria-label="Search products" placeholder="Find something lovely..." value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}<kbd>⌘ K</kbd></label><label className="sort-select"><SlidersHorizontal size={15} /><select value={sort} aria-label="Sort products" onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="rating">Top rated</option></select><ChevronDown size={13} /></label></div>
        </div>
        {search && <div className="search-hint"><Sparkles size={14} /> Searching by meaning, not just words. Try “gift”, “soft” or “walking in rain”.</div>}
        <div className="product-grid">{filtered.map((product, index) => <article key={product.id} className="product-card" style={{ animationDelay: `${index * 45}ms` }}>
          <div className="product-image-wrap" onClick={() => openProduct(product)} role="button" tabIndex={0} onKeyDown={(event) => event.key === "Enter" && openProduct(product)}>
            <img src={product.image} alt={product.name} loading="lazy" />
            {product.badge && <span className="product-badge">{product.badge}</span>}
            {product.stock <= 5 && <span className="stock-badge">Only {product.stock} left</span>}
            <button className={wishlist.includes(product.id) ? "wishlist-button selected" : "wishlist-button"} aria-label="Save product" onClick={(event) => { event.stopPropagation(); toggleWishlist(product.id); }}><Heart size={17} fill={wishlist.includes(product.id) ? "currentColor" : "none"} /></button>
            <button className="quick-add" onClick={(event) => { event.stopPropagation(); addToCart(product); }}>Quick add <Plus size={14} /></button>
          </div>
          <div className="product-meta"><span>{product.category}</span><span className="rating">★ {product.rating} <small>({product.review_count})</small></span></div>
          <button className="product-title" onClick={() => openProduct(product)}>{product.name}</button>
          <div className="product-price"><strong>{money(product.price)}</strong><del>{money(product.original_price)}</del><span>{Math.round((1 - product.price / product.original_price) * 100)}% off</span></div>
          <label className="compare-option"><input type="checkbox" checked={compare.includes(product.id)} onChange={(event) => setCompare((current) => event.target.checked ? [...current, product.id].slice(-3) : current.filter((id) => id !== product.id))} /> Compare</label>
        </article>)}</div>
        {filtered.length === 0 && <div className="empty-search"><span>✿</span><h3>No finds just yet.</h3><p>Try another search or browse everything we love.</p><button className="button primary" onClick={() => { setSearch(""); setCategory("Everything"); }}>Show me everything</button></div>}
        <div className="catalog-footer"><span>Showing {filtered.length} of {products.length} lovely finds</span><button className="button outline" onClick={() => setToast("You've seen all the good stuff for now!")}>That's everything <Check size={15} /></button></div>
      </section>

      <section className="personal-pick" id="story"><div className="pick-image"><img src="https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1100&q=85" alt="Calm, cozy living space" /><span className="image-sticker">a softer<br />kind of living</span></div><div className="pick-copy"><span className="eyebrow"><span className="eyebrow-line" /> A NOTE FROM US</span><h2>Less scrolling.<br />More <em>“that’s so me.”</em></h2><p>We believe the best things aren’t just things. They’re the mug you reach for every morning, the bag that goes everywhere, the little details that feel a bit like you.</p><p>So we look for the good stuff, and make finding it feel good too.</p><button className="button primary" onClick={() => setAssistantOpen(true)}>Find my kind of lovely <Sparkles size={16} /></button><span className="handwritten">here for the good little things <span>♡</span></span></div></section>

      <section className="newsletter"><span className="newsletter-flower">✳</span><span className="eyebrow">LETTERS, NOT SPAM</span><h2>A little good in your <em>inbox.</em></h2><p>New finds, thoughtful notes, and 10% off your first order.</p><form onSubmit={(event) => { event.preventDefault(); subscribeNewsletter(); }}><input ref={newsletterInput} required type="email" placeholder="Your email address" aria-label="Your email address" value={newsletterEmail} onChange={(event) => setNewsletterEmail(event.target.value)} /><button type="submit">Count me in <ArrowRight size={15} /></button></form><small>Newsletter delivery isn’t enabled on this local install. No emails are sent.</small></section>
      <footer className="footer"><a className="wordmark" href="#">kartify<span>.</span></a><span>A little more lovely, every day.</span><div><button onClick={openSellerStudio}>Seller studio</button><button onClick={openOrderHistory}>Order history</button>{import.meta.env.DEV && <a href={`${import.meta.env.VITE_API_URL ?? "https://kartify-1-pox4.onrender.com"}/docs`} target="_blank" rel="noreferrer">API docs ↗</a>}</div><small>© 2025 Kartify. Made with a little extra care.</small></footer>

      {compare.length > 0 && <div className="compare-bar"><div><strong>Compare your picks</strong><span>{compare.map((id) => products.find((item) => item.id === id)?.name).join(" · ")}</span></div><button onClick={() => setToast(`Comparing ${compare.length} products side by side`)}>Compare now <ArrowRight size={15} /></button><button className="compare-close" aria-label="Clear comparison" onClick={() => setCompare([])}><X size={17} /></button></div>}
      <button className="assistant-fab" onClick={() => setAssistantOpen(!assistantOpen)} aria-label="Open AI shopping assistant"><Sparkles size={20} /><span>Need a little help?</span></button>
      {assistantOpen && (
        <aside className="assistant-panel">
          <div className="assistant-head">
            <div className="assistant-avatar"><Sparkles size={17} /></div>
            <div><strong>Your Kartify sidekick</strong><small><i /> Shopping actions · checkout needs your confirmation</small></div>
            <button className="icon-button" onClick={() => setAssistantOpen(false)} aria-label="Close assistant"><X size={18} /></button>
          </div>
          <div className="assistant-context">Try “add the mug”, “search for linen”, or “put me@example.com in the newsletter email field”. I’ll ask before placing an order. ✨</div>
          <div className="chat-messages">
            {messages.map((message, index) => <div key={index} className={`chat-bubble ${message.role}`}>{message.content}</div>)}
            {loadingChat && <div className="chat-bubble assistant typing">Working on that<span> · · ·</span></div>}
          </div>
          <div className="chat-suggestions">{["Gift under ₹2000", "Add the mug", "Checkout"].map((item) => <button key={item} onClick={() => setChatInput(item)}>{item}</button>)}</div>
          {voiceError && <div className="voice-error" role="status">{voiceError}</div>}
          {voiceListening && <div className="voice-status" role="status">Listening… speak your request</div>}
          <form className="chat-form" onSubmit={sendMessage}>
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={agentCheckoutStep === "name" ? "Say your full name..." : agentCheckoutStep === "email" ? "Say your email address..." : agentCheckoutStep === "address" ? "Say your delivery address..." : agentCheckoutStep === "confirm" ? "Say “confirm order” or “cancel”..." : "Tell me what you're after..."}
            />
            <button className={voiceListening ? "voice-button listening" : "voice-button"} aria-label={voiceListening ? "Stop voice input" : "Start voice input"} aria-pressed={voiceListening} type="button" onClick={toggleVoiceInput} disabled={loadingChat}>
              {voiceListening ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
            <button aria-label="Send message" type="submit" disabled={loadingChat}><ArrowRight size={17} /></button>
          </form>
        </aside>
      )}

      {(drawer || activeProduct || adminOpen || authOpen) && <div className="overlay" onClick={() => { setDrawer(null); setActiveProduct(null); setAdminOpen(false); setAuthOpen(false); setCheckout(false); }} />}
      {drawer && <aside className="drawer"><div className="drawer-head"><div><span className="eyebrow">YOUR KARTIFY</span><h3>{drawer === "cart" ? "Your bag" : drawer === "wishlist" ? "Saved for later" : "Order updates"}</h3></div><button className="icon-button" onClick={() => { setDrawer(null); setCheckout(false); }} aria-label="Close panel"><X size={19} /></button></div>
        {drawer === "cart" && !checkout && <>{cartItems.length ? <><div className="drawer-items">{cartItems.map((item) => <div className="drawer-item" key={item.id}><img src={item.image} alt="" /><div className="drawer-item-info"><strong>{item.name}</strong><span>{money(item.price)}</span><div className="qty-control"><button aria-label="Decrease quantity" onClick={() => setCart((current) => ({ ...current, [item.id]: Math.max(0, (current[item.id] ?? 1) - 1) }))}><Minus size={12} /></button><span>{cart[item.id]}</span><button aria-label="Increase quantity" onClick={() => setCart((current) => ({ ...current, [item.id]: (current[item.id] ?? 0) + 1 }))}><Plus size={12} /></button></div></div><button className="remove-item" onClick={() => setCart((current) => { const next = { ...current }; delete next[item.id]; return next; })}><X size={15} /></button></div>)}</div><div className="drawer-bottom"><div className="shipping-note">✳ You’re {money(Math.max(0, 1999 - subtotal))} away from free delivery</div><div className="subtotal"><span>Subtotal</span><strong>{money(subtotal)}</strong></div><small>Taxes included. Shipping calculated at checkout.</small><button className="button primary full-button" onClick={() => setCheckout(true)}>Continue to checkout <ArrowRight size={16} /></button><button className="continue-shopping" onClick={() => setDrawer(null)}>Keep finding good stuff</button></div></> : <div className="drawer-empty"><ShoppingBag size={34} /><h3>Your bag’s taking a little nap.</h3><p>Let’s find something lovely to wake it up.</p><button className="button primary" onClick={() => setDrawer(null)}>Go find your thing</button></div>}</>}
        {drawer === "cart" && checkout && <form className="checkout-form" onSubmit={submitCheckout}>
          <button type="button" className="back-link" onClick={() => setCheckout(false)}><ChevronLeft size={15} /> Back to bag</button>
          <h3>Where should we send the good stuff?</h3>
          {!account && <p>Sign in or create an account before placing your order. Your bag will stay here.</p>}
          <label>Full name<input required readOnly={Boolean(account)} value={account?.name ?? customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
          <label>Email address<input type="email" required readOnly={Boolean(account)} value={account?.email ?? email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Delivery address<textarea required rows={3} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
          <div className="checkout-total"><span>{RAZORPAY_KEY_ID ? "Total to pay securely" : IS_DEVELOPMENT ? "Total (payment demo)" : "Checkout unavailable"}</span><strong>{money(subtotal)}</strong></div>
          <button className="button primary full-button" type="submit" disabled={paymentLoading || !CHECKOUT_AVAILABLE}>
            {paymentLoading ? "Opening secure checkout…" : RAZORPAY_KEY_ID ? "Pay securely with Razorpay" : IS_DEVELOPMENT ? "Place demo order" : "Online checkout unavailable"} <ArrowRight size={16} />
          </button>
          <small>{RAZORPAY_KEY_ID ? "Your order is confirmed only after the server verifies payment." : IS_DEVELOPMENT ? "This demo does not charge a payment method." : "Online checkout is temporarily unavailable."}</small>
        </form>}
        {drawer === "wishlist" && <div className="drawer-items wishlist-items">{products.filter((item) => wishlist.includes(item.id)).map((item) => <div className="drawer-item" key={item.id}><img src={item.image} alt="" /><div className="drawer-item-info"><strong>{item.name}</strong><span>{money(item.price)}</span><button className="wishlist-add" onClick={() => addToCart(item)}>Add to bag</button></div><button className="remove-item" onClick={() => toggleWishlist(item.id)}><X size={15} /></button></div>)}{wishlist.length === 0 && <div className="drawer-empty"><Heart size={32} /><h3>Keep your little loves close.</h3><p>Tap the heart on anything that catches your eye.</p></div>}</div>}
        {drawer === "orders" && <div className="customer-orders">{!account ? <div className="drawer-empty"><div className="order-icon"><UserRound size={21} /></div><h3>Sign in to see your orders.</h3><p>Your order history is private to your account.</p><button className="button primary" onClick={() => { setDrawer(null); setAuthOpen(true); }}>Sign in <ArrowRight size={14} /></button></div> : ordersLoading ? <div className="drawer-empty"><div className="admin-loading"><span /> Loading your orders…</div></div> : customerOrders.length ? <>{customerOrders.map((order) => <article className="customer-order" key={order.id}><div className="customer-order-heading"><div><span className="eyebrow">ORDER #{order.id}</span><small>{new Date(order.created_at).toLocaleDateString()}</small></div><i className={`status-pill ${order.status.toLowerCase().replaceAll(" ", "-")}`}>{order.status}</i></div><small className="payment-status">Payment: {order.payment_status}</small><strong>{money(order.total)}</strong><div className="customer-order-items">{order.items.map((item) => <span key={`${order.id}-${item.product_id}`}>{products.find((product) => product.id === item.product_id)?.name ?? `Product #${item.product_id}`} × {item.quantity}</span>)}</div></article>)}</> : <div className="drawer-empty"><div className="order-icon"><ShoppingBag size={21} /></div><h3>{orderNumber ? `Order #${orderNumber} is in!` : "Your next good thing is on its way."}</h3><p>{orderNumber ? "We’ve received your order. Payment is currently simulated." : "Your placed orders will appear here after you check out."}</p></div>}</div>}
      </aside>}

      {activeProduct && <section className="product-modal"><button className="modal-close icon-button" onClick={() => setActiveProduct(null)} aria-label="Close product"><X size={19} /></button><div className="modal-image"><img src={activeProduct.image} alt={activeProduct.name} /></div><div className="modal-copy"><span className="eyebrow">{activeProduct.category.toUpperCase()} · {activeProduct.badge || "A GOOD FIND"}</span><h2>{activeProduct.name}</h2><div className="modal-rating">★ {activeProduct.rating} <span>({activeProduct.review_count} lovely reviews)</span></div><div className="modal-price">{money(activeProduct.price)} <del>{money(activeProduct.original_price)}</del></div><p>{activeProduct.description}</p><div className="fit-advice"><Sparkles size={16} /><span><b>A little tip:</b> {activeProduct.category === "Footwear" ? "Pair with your comfiest socks. Fit varies by foot shape, so check the size guide before ordering." : "Picked to be an easy everyday favorite. Thoughtful materials, made for regular use."}</span></div><div className="review-summary"><span>✳</span><div><b>People are saying</b><p>“Lovely quality and even better in person.” A customer favorite for thoughtful gifting.</p></div></div><div className="modal-stock">{activeProduct.stock <= 5 ? `Only ${activeProduct.stock} left — good things go quickly.` : "In stock · ready to make your day"}</div><button className="button primary full-button" onClick={() => addToCart(activeProduct)}>Add to bag · {money(activeProduct.price)} <ShoppingBag size={16} /></button><button className="modal-wishlist" onClick={() => toggleWishlist(activeProduct.id)}><Heart size={15} /> Save for later</button></div></section>}

      {authOpen && <section className="auth-modal">
        <button className="modal-close icon-button" onClick={() => setAuthOpen(false)} aria-label="Close account"><X size={19} /></button>
        {account ? <><span className="eyebrow">YOUR KARTIFY ACCOUNT</span><h2>Good to see you, {account.name.split(" ")[0]}.</h2><p>{account.email}</p><div className="account-card"><UserRound size={19} /><div><b>{account.is_admin ? "Store administrator" : "Shopper account"}</b><span>{account.is_admin ? "You have access to products, orders and store analytics." : "Your account is ready for your next good find."}</span></div></div><div className="social-auth account-social-auth">
            {GOOGLE_CLIENT_ID && <div><span className="social-label">Link Google</span><div className="google-signin" ref={googleButton}>{googleSdkReady ? "Loading Google sign-in…" : "Loading Google sign-in…"}</div></div>}
            {FACEBOOK_APP_ID && <button className="social-button" type="button" disabled={!facebookSdkReady} onClick={startFacebookSignIn}><b className="facebook-mark">f</b>Link Facebook</button>}
          </div>{authError && <p className="form-error" role="alert">{authError}</p>}{(GOOGLE_CLIENT_ID || FACEBOOK_APP_ID) && <small className="social-setup-hint">Link only a social account that uses this same email address.</small>}{account.is_admin && <button className="button primary full-button" onClick={() => { setAuthOpen(false); openSellerStudio(); }}><LayoutDashboard size={16} /> Open seller studio</button>}<button className="button outline full-button" onClick={signOut}><LogOut size={15} /> Sign out</button></> :
          <><span className="eyebrow"><span className="eyebrow-line" /> YOUR NEXT GOOD FIND</span><h2>{authMode === "login" ? "Welcome back." : "Make yourself at home."}</h2><p>{authMode === "login" ? "Sign in to pick up where you left off." : "Create an account for a more personal little shop."}</p><div className="social-auth">
            {GOOGLE_CLIENT_ID ? <div className="google-signin" ref={googleButton}>{googleSdkReady ? "Loading Google sign-in…" : "Loading Google sign-in…"}</div> : <button className="social-button" type="button" onClick={() => explainSocialSetup("google")}><b className="google-mark">G</b>Continue with Google</button>}
            <button className="social-button" type="button" onClick={FACEBOOK_APP_ID ? startFacebookSignIn : () => explainSocialSetup("facebook")}><b className="facebook-mark">f</b>Continue with Facebook</button>
          </div>
          {(!GOOGLE_CLIENT_ID || !FACEBOOK_APP_ID) && <small className="social-setup-hint">Add provider IDs in frontend/.env.local and the matching credentials in backend/.env to enable social sign-in.</small>}
          <div className="auth-divider"><span>or continue with email</span></div><form className="auth-form" onSubmit={submitAuth}>{authMode === "signup" && <label>Your name<input autoComplete="name" required minLength={2} value={authName} onChange={(event) => setAuthName(event.target.value)} /></label>}<label>Email address<input autoComplete="email" type="email" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label><label>Password<input autoComplete={authMode === "login" ? "current-password" : "new-password"} type="password" minLength={authMode === "signup" ? 8 : 1} required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />{authMode === "signup" && <small>At least 8 characters.</small>}</label><label>Seller setup code <small>Leave blank unless this is the configured store admin account.</small><input autoComplete="off" type="password" value={authAdminSetupToken} onChange={(event) => setAuthAdminSetupToken(event.target.value)} /></label>{authError && <p className="form-error" role="alert">{authError}</p>}<button className="button primary full-button" type="submit">{authMode === "login" ? "Sign in" : "Create account"} <ArrowRight size={15} /></button></form><button className="auth-switch" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); setAuthAdminSetupToken(""); }}>{authMode === "login" ? "New to Kartify? Create an account" : "Already have an account? Sign in"}</button></>}
      </section>}
      {adminOpen && <section className="admin-dashboard">
        <aside className="admin-sidebar"><a className="wordmark" href="#" onClick={(event) => event.preventDefault()}>kartify<span>.</span></a><span className="admin-sidebar-label">SELLER STUDIO</span><button className={adminTab === "overview" ? "admin-nav active" : "admin-nav"} onClick={() => setAdminTab("overview")}><LayoutDashboard size={17} /> Overview</button><button className={adminTab === "products" ? "admin-nav active" : "admin-nav"} onClick={() => setAdminTab("products")}><Package size={17} /> Products</button><button className={adminTab === "orders" ? "admin-nav active" : "admin-nav"} onClick={() => setAdminTab("orders")}><Boxes size={17} /> Orders</button><div className="admin-sidebar-bottom"><div className="admin-user"><div className="admin-avatar">{account?.name.slice(0, 1).toUpperCase()}</div><span><b>{account?.name}</b><small>Store admin</small></span></div><button className="admin-nav" onClick={signOut}><LogOut size={16} /> Sign out</button></div></aside>
        <div className="admin-main"><header className="admin-topbar"><div><button className="back-link" onClick={() => setAdminOpen(false)}><ChevronLeft size={16} /> Back to storefront</button><span className="admin-breadcrumb"> / Seller studio / {adminTab}</span></div><button className="icon-button admin-close" onClick={() => setAdminOpen(false)} aria-label="Close seller studio"><X size={19} /></button></header><div className="admin-content">
          <div className="admin-title-row"><div><span className="eyebrow"><span className="eyebrow-line" /> YOUR STORE, AT A GLANCE</span><h2>{adminTab === "overview" ? "Good evening, " + (account?.name.split(" ")[0] ?? "seller") + "." : adminTab === "products" ? "Your products." : "Orders to look after."}</h2><p>{adminTab === "overview" ? "Here’s what’s happening with your shop." : adminTab === "products" ? "Keep your catalog fresh and in stock." : "Manage fulfilment and keep customers in the loop."}</p></div>{adminTab === "products" && <button className="button primary" onClick={() => { resetProductForm(); setEditingProduct(null); document.querySelector(".admin-product-form")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><Plus size={16} /> Add a product</button>}</div>
          {adminError && <div className="admin-error" role="alert">{adminError}</div>}
          {adminLoading && <div className="admin-loading"><span /> Syncing your store data…</div>}
          {!adminLoading && adminData && adminTab === "overview" && <><div className="metric-grid"><div className="metric-card"><span><TrendingUp size={16} /> Total revenue</span><b>{money(adminData.total_revenue)}</b><small>Across {adminData.order_count} orders</small></div><div className="metric-card"><span><Package size={16} /> Orders</span><b>{adminData.order_count}</b><small>All-time orders placed</small></div><div className="metric-card"><span><Boxes size={16} /> Products</span><b>{adminData.product_count}</b><small>Live in your catalog</small></div><div className="metric-card"><span><Sparkles size={16} /> Low stock</span><b>{adminData.low_stock_count}</b><small>Five units or fewer</small></div></div><div className="admin-panels"><section className="admin-panel sales-panel"><div className="panel-heading"><div><b>Sales pulse</b><span>Last 7 days</span></div><TrendingUp size={18} /></div><div className="sales-chart">{adminData.sales.map((day) => { const max = Math.max(1, ...adminData.sales.map((item) => item.revenue)); return <div className="chart-day" key={day.date}><span className="chart-value">{day.revenue ? money(day.revenue) : ""}</span><div className="chart-track"><i style={{ height: `${day.revenue ? Math.max(6, day.revenue / max * 100) : 3}%` }} /></div><small>{day.label}</small></div>; })}</div></section><section className="admin-panel"><div className="panel-heading"><div><b>Recent orders</b><span>The latest from your customers</span></div><button className="link-button" onClick={() => setAdminTab("orders")}>All orders <ArrowRight size={14} /></button></div>{adminData.recent_orders.slice(0, 4).map((order) => <div className="recent-order" key={order.id}><span className="order-mini">#{order.id}</span><span><b>{order.customer_name}</b><small>{new Date(order.created_at).toLocaleDateString()}</small></span><strong>{money(order.total)}</strong><i className={`status-pill ${order.status.toLowerCase()}`}>{order.status}</i></div>)}{adminData.recent_orders.length === 0 && <p className="admin-empty">Your first order will show up here.</p>}</section></div></>}
          {!adminLoading && adminData && adminTab === "products" && <><form className="admin-product-form admin-panel" onSubmit={submitProduct}><div className="panel-heading"><div><b>{editingProduct ? "Edit product" : "Add a product"}</b><span>{editingProduct ? "Update the details in your catalog." : "Create a listing that’s ready for your storefront."}</span></div>{editingProduct && <button type="button" className="link-button" onClick={resetProductForm}>Cancel edit <X size={13} /></button>}</div><div className="product-form-grid"><label>Product name<input required minLength={2} value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} placeholder="e.g. Sunday sunshine vase" /></label><label>Category<select value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })}>{categories.filter((item) => item !== "Everything").map((item) => <option key={item}>{item}</option>)}</select></label><label>Price (₹)<input required type="number" min="1" step="1" value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: event.target.value })} /></label><label>Compare-at price (₹)<input type="number" min="1" step="1" value={productForm.original_price} onChange={(event) => setProductForm({ ...productForm, original_price: event.target.value })} /></label><label>Stock quantity<input required type="number" min="0" value={productForm.stock} onChange={(event) => setProductForm({ ...productForm, stock: event.target.value })} /></label><label>Badge<input maxLength={40} value={productForm.badge} onChange={(event) => setProductForm({ ...productForm, badge: event.target.value })} placeholder="NEW, BESTSELLER…" /></label><label className="form-wide">Image URL<input type="url" required value={productForm.image} onChange={(event) => setProductForm({ ...productForm, image: event.target.value })} placeholder="https://…" /></label><label className="form-wide">Description<textarea required minLength={5} rows={3} value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} /></label><label className="form-wide">Search tags <small>Comma-separated</small><input value={productForm.tags} onChange={(event) => setProductForm({ ...productForm, tags: event.target.value })} placeholder="gift, ceramic, handmade" /></label></div><button className="button primary" type="submit">{editingProduct ? "Save changes" : "Publish product"} <ArrowRight size={15} /></button></form><section className="admin-panel table-panel"><div className="panel-heading"><div><b>Catalog</b><span>{adminData.products.length} products</span></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Rating</th><th /></tr></thead><tbody>{adminData.products.map((product) => <tr key={product.id}><td><div className="table-product"><img src={product.image} alt="" /><b>{product.name}</b></div></td><td>{product.category}</td><td>{money(product.price)}</td><td><span className={product.stock <= 5 ? "stock-low" : ""}>{product.stock} units</span></td><td>★ {product.rating}</td><td><div className="table-actions"><button onClick={() => startProductEdit(product)} aria-label={`Edit ${product.name}`} title="Edit"><Pencil size={15} /></button><button onClick={() => void deleteAdminProduct(product)} aria-label={`Delete ${product.name}`} title="Delete"><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div></section></>}
          {!adminLoading && adminData && adminTab === "orders" && <section className="admin-panel table-panel"><div className="panel-heading"><div><b>All orders</b><span>{adminData.order_count} paid or demo orders · Update fulfilment status here</span></div></div>{adminData.recent_orders.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Total / payment</th><th>Status</th></tr></thead><tbody>{adminData.recent_orders.map((order) => <tr key={order.id}><td>#{order.id}</td><td><b>{order.customer_name}</b><small className="table-email">{order.email}</small></td><td>{new Date(order.created_at).toLocaleDateString()}</td><td>{money(order.total)}<small className="table-email">{order.payment_status}</small></td><td><select className="order-status-select" value={order.status} disabled={order.payment_status === "pending"} title={order.payment_status === "pending" ? "Fulfilment is locked until payment is confirmed." : undefined} onChange={(event) => void setAdminOrderStatus(order.id, event.target.value)}><option>Awaiting Payment</option><option>Processing</option><option>Shipped</option><option>Delivered</option><option>Cancelled</option></select></td></tr>)}</tbody></table></div> : <div className="admin-empty">No orders yet. New orders will appear here.</div>}</section>}
        </div></div>
      </section>}
      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
      <button className="back-top" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><ChevronRight size={17} /></button>
    </main>
  );
}

export default App;
