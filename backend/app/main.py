import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from functools import partial
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

import requests
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token as google_id_token
from jose import JWTError, jwt
from sqlalchemy import func, inspect, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .ai import assistant_reply, rank_products
from .database import Base, engine, get_db
from .models import OAuthIdentity, Order, OrderItem, Product, Review, User
from .schemas import (
    AdminSetupRequest, AssistantRequest, LoginRequest, OrderCreate, OrderStatusUpdate,
    RazorpayPaymentVerification, SocialLoginRequest,
    ProductCreate, ReviewCreate, SignupRequest,
)

ENVIRONMENT = os.getenv("KARTIFY_ENV", "development").strip().lower()
if ENVIRONMENT not in {"development", "test", "production"}:
    raise RuntimeError("KARTIFY_ENV must be development, test, or production.")
SECRET_KEY = os.getenv("KARTIFY_SECRET_KEY", "").strip()
ADMIN_EMAIL = os.getenv("KARTIFY_ADMIN_EMAIL", "").strip().casefold()
ADMIN_SETUP_TOKEN = os.getenv("KARTIFY_ADMIN_SETUP_TOKEN", "").strip()
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
FACEBOOK_APP_ID = os.getenv("FACEBOOK_APP_ID", "").strip()
FACEBOOK_APP_SECRET = os.getenv("FACEBOOK_APP_SECRET", "").strip()
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "").strip()
if GOOGLE_CLIENT_ID.lower().startswith("your-"):
    GOOGLE_CLIENT_ID = ""
if FACEBOOK_APP_ID.lower().startswith("your-"):
    FACEBOOK_APP_ID = ""
if FACEBOOK_APP_SECRET.lower().startswith("replace-with"):
    FACEBOOK_APP_SECRET = ""
if RAZORPAY_KEY_ID.lower().startswith("rzp_test_replace"):
    RAZORPAY_KEY_ID = ""
if RAZORPAY_KEY_SECRET.lower().startswith("replace-with"):
    RAZORPAY_KEY_SECRET = ""
if RAZORPAY_WEBHOOK_SECRET.lower().startswith("replace-with"):
    RAZORPAY_WEBHOOK_SECRET = ""
if ENVIRONMENT == "production":
    if len(SECRET_KEY) < 32 or SECRET_KEY.lower().startswith("replace-with"):
        raise RuntimeError("Set KARTIFY_SECRET_KEY to a private random value of at least 32 characters.")
    if (
        not ADMIN_EMAIL
        or len(ADMIN_SETUP_TOKEN) < 32
        or ADMIN_SETUP_TOKEN.lower().startswith("replace-with")
    ):
        raise RuntimeError("Set KARTIFY_ADMIN_EMAIL and a private KARTIFY_ADMIN_SETUP_TOKEN of at least 32 characters.")
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET or not RAZORPAY_WEBHOOK_SECRET:
        raise RuntimeError("Set the Razorpay key ID, private key secret, and webhook secret before production startup.")
    if RAZORPAY_KEY_ID.startswith("rzp_test_"):
        raise RuntimeError("Production must use a live Razorpay key, not a test key.")
SECRET_KEY = SECRET_KEY or "local-demo-only-change-before-deployment"
ALGORITHM = "HS256"
Base.metadata.create_all(bind=engine)

with engine.begin() as connection:
    user_columns = {column["name"] for column in inspect(connection).get_columns("users")}
    if "is_admin" not in user_columns:
        connection.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE"))
    order_columns = {column["name"] for column in inspect(connection).get_columns("orders")}
    if "user_id" not in order_columns:
        connection.execute(text("ALTER TABLE orders ADD COLUMN user_id INTEGER REFERENCES users(id)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_user_id ON orders (user_id)"))

with engine.begin() as connection:
    order_columns = {column["name"] for column in inspect(connection).get_columns("orders")}
    for column_name, definition in (
        ("payment_status", "VARCHAR(30) NOT NULL DEFAULT 'demo'"),
        ("razorpay_order_id", "VARCHAR(100)"),
        ("razorpay_payment_id", "VARCHAR(100)"),
        ("razorpay_refund_id", "VARCHAR(100)"),
    ):
        if column_name not in order_columns:
            connection.execute(text(f"ALTER TABLE orders ADD COLUMN {column_name} {definition}"))
    connection.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_orders_razorpay_order_id ON orders (razorpay_order_id)"
    ))
    connection.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_orders_razorpay_payment_id ON orders (razorpay_payment_id)"
    ))

app = FastAPI(
    title="Kartify API",
    version="1.0.0",
    description="Kartify shopping API.",
    docs_url=None if ENVIRONMENT == "production" else "/docs",
    redoc_url=None if ENVIRONMENT == "production" else "/redoc",
    openapi_url=None if ENVIRONMENT == "production" else "/openapi.json",
)
cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
if "*" in cors_origins:
    raise RuntimeError("CORS_ORIGINS must list explicit origins; wildcard origins cannot be used with credentials.")
if ENVIRONMENT == "production" and not cors_origins:
    raise RuntimeError("Set CORS_ORIGINS to the exact frontend origin before running in production.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SEED_PRODUCTS = [
    {"name": "Everyday Carry Tote", "category": "Accessories", "price": 1299, "original_price": 1699, "rating": 4.8, "review_count": 124, "image": "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85", "description": "A roomy, responsibly made tote for all the little things your day brings.", "badge": "BESTSELLER", "stock": 12, "tags": "bag,cotton,everyday,gift"},
    {"name": "Cloud Knit Sweater", "category": "Clothing", "price": 2499, "original_price": 3299, "rating": 4.9, "review_count": 86, "image": "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=85", "description": "Soft, relaxed and made for the slow mornings you wish lasted longer.", "badge": "JUST IN", "stock": 8, "tags": "clothing,soft,winter,gift"},
    {"name": "Ribbed Ceramic Mug", "category": "Home", "price": 749, "original_price": 999, "rating": 4.7, "review_count": 203, "image": "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=85", "description": "Hand-finished stoneware that makes your first coffee feel like a ritual.", "badge": "LOVED", "stock": 18, "tags": "coffee,ceramic,home,gift"},
    {"name": "Weekend Runner", "category": "Footwear", "price": 3199, "original_price": 3999, "rating": 4.6, "review_count": 93, "image": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85", "description": "Lightweight everyday sneakers with a cushioned sole for long city walks.", "badge": "TRENDING", "stock": 5, "tags": "shoes,walking,comfort,rain"},
    {"name": "Soft Glow Desk Lamp", "category": "Home", "price": 1899, "original_price": 2399, "rating": 4.8, "review_count": 67, "image": "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85", "description": "A warm pool of light for the late-night reader and early-morning planner.", "badge": "", "stock": 9, "tags": "lamp,home,desk,gift"},
    {"name": "Sculpted Everyday Hoops", "category": "Accessories", "price": 999, "original_price": 1299, "rating": 4.9, "review_count": 158, "image": "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=85", "description": "A little golden detail that goes with absolutely everything.", "badge": "BESTSELLER", "stock": 22, "tags": "jewelry,gold,gift,accessories"},
    {"name": "Sunday Linen Shirt", "category": "Clothing", "price": 1999, "original_price": 2599, "rating": 4.5, "review_count": 72, "image": "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=85", "description": "Breathable linen with an easy, boxy fit for warmer days.", "badge": "", "stock": 14, "tags": "shirt,linen,clothing,summer"},
    {"name": "The Little Plant Set", "category": "Home", "price": 1199, "original_price": 1499, "rating": 4.7, "review_count": 51, "image": "https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=900&q=85", "description": "Three easy-going greens to bring a little more life to your space.", "badge": "GIFT PICK", "stock": 7, "tags": "plant,home,decor,gift"},
]


def serialize_product(product: Product) -> dict:
    return {
        "id": product.id, "name": product.name, "category": product.category,
        "price": product.price, "original_price": product.original_price,
        "rating": product.rating, "review_count": product.review_count,
        "image": product.image, "description": product.description,
        "badge": product.badge, "stock": product.stock,
        "tags": [tag for tag in product.tags.split(",") if tag],
    }


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{salt.hex()}${digest.hex()}"


def password_matches(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$", maxsplit=1)
        candidate = hash_password(password, bytes.fromhex(salt_hex)).split("$", maxsplit=1)[1]
    except ValueError:
        return False
    return hmac.compare_digest(candidate, digest_hex)


def issue_token(user: User) -> str:
    expiry = datetime.now(timezone.utc) + timedelta(hours=12)
    return jwt.encode({"sub": str(user.id), "exp": expiry}, SECRET_KEY, algorithm=ALGORITHM)


def current_user(token: str, db: Session) -> User:
    credentials_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub", ""))
    except (JWTError, ValueError):
        raise credentials_error
    user = db.get(User, user_id)
    if not user:
        raise credentials_error
    return user


def authenticated_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in is required")
    return current_user(authorization.removeprefix("Bearer "), db)


def admin_user(user: User = Depends(authenticated_user)) -> User:
    if not ADMIN_EMAIL or not user.is_admin or user.email != ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access is not configured for this account")
    return user


def auth_response(user: User) -> dict:
    return {
        "access_token": issue_token(user),
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "is_admin": bool(ADMIN_EMAIL) and user.is_admin and user.email == ADMIN_EMAIL,
        },
    }


def complete_social_login(
    provider: str,
    provider_user_id: str,
    name: str,
    email: str,
    admin_setup_token: str | None,
    db: Session,
) -> dict:
    email = email.casefold()
    identity = db.scalar(
        select(OAuthIdentity).where(
            OAuthIdentity.provider == provider,
            OAuthIdentity.provider_user_id == provider_user_id,
        )
    )
    if identity:
        user = db.get(User, identity.user_id)
        if not user:
            raise HTTPException(status_code=409, detail="This social account is not linked to an active Kartify account")
    else:
        user = db.scalar(select(User).where(User.email == email))
        if user and provider != "google":
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists. Sign in with its existing method first.",
            )
        if not user:
            is_admin = email == ADMIN_EMAIL
            if is_admin and (
                not ADMIN_SETUP_TOKEN
                or not admin_setup_token
                or not hmac.compare_digest(admin_setup_token, ADMIN_SETUP_TOKEN)
            ):
                raise HTTPException(status_code=403, detail="A valid seller setup code is required for this account")
            if admin_setup_token and not is_admin:
                raise HTTPException(status_code=400, detail="The seller setup code can only be used with the configured admin email")
            user = User(
                name=(name.strip() if isinstance(name, str) else "")[:120] or email.split("@", maxsplit=1)[0],
                email=email,
                password_hash=hash_password(secrets.token_urlsafe(48)),
                is_admin=is_admin,
            )
            db.add(user)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                raise HTTPException(status_code=409, detail="An account with this email already exists")

        identity = OAuthIdentity(
            user_id=user.id,
            provider=provider,
            provider_user_id=provider_user_id,
        )
        db.add(identity)

    if admin_setup_token:
        if email != ADMIN_EMAIL or not ADMIN_SETUP_TOKEN or not hmac.compare_digest(admin_setup_token, ADMIN_SETUP_TOKEN):
            raise HTTPException(status_code=403, detail="The seller setup code is invalid for this account")
        user.is_admin = True

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This social account or email is already linked to Kartify")
    db.refresh(user)
    return auth_response(user)


def facebook_profile(access_token: str) -> dict:
    if not FACEBOOK_APP_ID or not FACEBOOK_APP_SECRET:
        raise HTTPException(status_code=503, detail="Facebook sign-in is not configured on this server")

    debug_url = "https://graph.facebook.com/v22.0/debug_token?" + urlencode({
        "input_token": access_token,
        "access_token": f"{FACEBOOK_APP_ID}|{FACEBOOK_APP_SECRET}",
    })
    try:
        with urlopen(debug_url, timeout=8) as response:
            debug_payload = json.load(response)
            token_info = debug_payload.get("data", {}) if isinstance(debug_payload, dict) else {}
        scopes = token_info.get("scopes", [])
        if (
            not token_info.get("is_valid")
            or token_info.get("app_id") != FACEBOOK_APP_ID
            or not token_info.get("user_id")
            or not isinstance(scopes, list)
            or "email" not in scopes
        ):
            raise HTTPException(status_code=401, detail="Facebook sign-in could not be verified")

        profile_url = "https://graph.facebook.com/v22.0/me?" + urlencode({
            "fields": "id,name,email",
            "access_token": access_token,
        })
        with urlopen(profile_url, timeout=8) as response:
            profile = json.load(response)
        if not isinstance(profile, dict):
            raise HTTPException(status_code=401, detail="Facebook sign-in could not be verified")
    except HTTPException:
        raise
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Facebook sign-in could not be verified")

    if (
        not isinstance(profile.get("id"), str)
        or profile["id"] != token_info["user_id"]
        or not isinstance(profile.get("email"), str)
        or not profile["email"]
    ):
        raise HTTPException(status_code=401, detail="Facebook must provide an email address to use this sign-in method")
    return profile


def google_profile(credential: str) -> dict:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on this server")
    try:
        claims = google_id_token.verify_oauth2_token(
            credential,
            partial(GoogleRequest(), timeout=5),
            GOOGLE_CLIENT_ID,
        )
    except (GoogleAuthError, ValueError):
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified")
    if (
        not claims.get("email_verified")
        or not isinstance(claims.get("sub"), str)
        or not isinstance(claims.get("email"), str)
        or not claims["email"]
    ):
        raise HTTPException(status_code=401, detail="Google must provide a verified email address to sign in")
    return claims


def link_social_identity(provider: str, provider_user_id: str, email: str, user: User, db: Session) -> dict:
    if email.casefold() != user.email:
        raise HTTPException(status_code=409, detail="The social account must use the same email as your Kartify account")
    identity = db.scalar(
        select(OAuthIdentity).where(
            OAuthIdentity.provider == provider,
            OAuthIdentity.provider_user_id == provider_user_id,
        )
    )
    if identity:
        if identity.user_id != user.id:
            raise HTTPException(status_code=409, detail="This social account is linked to a different Kartify account")
        return {"linked": True}

    db.add(OAuthIdentity(user_id=user.id, provider=provider, provider_user_id=provider_user_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This social account is already linked to Kartify")
    return {"linked": True}


def razorpay_request(method: str, path: str, payload: dict | None = None) -> dict:
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(status_code=503, detail="Razorpay payments are not configured")
    try:
        response = requests.request(
            method,
            f"https://api.razorpay.com/v1/{path.lstrip('/')}",
            auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
            json=payload,
            timeout=12,
        )
        response.raise_for_status()
        result = response.json()
    except (requests.RequestException, ValueError):
        raise HTTPException(status_code=502, detail="Razorpay could not process the payment request")
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Razorpay returned an invalid response")
    return result


def order_amount_paise(order: Order) -> int:
    return int((Decimal(str(order.total)) * 100).quantize(Decimal("1")))


def record_order(
    request: OrderCreate,
    user: User,
    db: Session,
    *,
    status_value: str,
    payment_status: str,
) -> Order:
    if request.email.casefold() != user.email or request.customer_name.strip().casefold() != user.name.strip().casefold():
        raise HTTPException(status_code=422, detail="Order name and email must match the signed-in account")
    quantities: dict[int, int] = {}
    for line in request.items:
        quantities[line.product_id] = quantities.get(line.product_id, 0) + line.quantity
        if quantities[line.product_id] > 50:
            raise HTTPException(status_code=422, detail="A product quantity cannot exceed 50 per order")

    if engine.dialect.name == "sqlite":
        db.commit()
        db.execute(text("BEGIN IMMEDIATE"))
    products = {
        product.id: product
        for product in db.scalars(select(Product).where(Product.id.in_(quantities))).all()
    }
    if len(products) != len(quantities):
        db.rollback()
        raise HTTPException(status_code=404, detail="One or more products could not be found")
    for product_id, quantity in quantities.items():
        result = db.execute(
            update(Product)
            .where(Product.id == product_id, Product.stock >= quantity)
            .values(stock=Product.stock - quantity)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(status_code=409, detail=f"Not enough stock for {products[product_id].name}")

    total = round(sum(products[product_id].price * quantity for product_id, quantity in quantities.items()), 2)
    order = Order(
        user_id=user.id,
        customer_name=user.name,
        email=user.email,
        address=request.address.strip(),
        total=total,
        status=status_value,
        payment_status=payment_status,
    )
    db.add(order)
    db.flush()
    for product_id, quantity in quantities.items():
        product = products[product_id]
        order.items.append(OrderItem(product_id=product_id, quantity=quantity, unit_price=product.price))
    db.commit()
    db.refresh(order)
    return order


def set_order_paid(order: Order, payment_id: str, db: Session) -> None:
    if order.payment_status == "paid":
        if order.razorpay_payment_id != payment_id:
            raise HTTPException(status_code=409, detail="This order was already paid using a different payment")
        return
    if order.payment_status != "pending" or order.status != "Awaiting Payment":
        raise HTTPException(status_code=409, detail="This order is no longer awaiting payment")
    order.razorpay_payment_id = payment_id
    order.payment_status = "paid"
    order.status = "Processing"
    db.commit()


def restore_order_inventory(order: Order, db: Session) -> None:
    for item in order.items:
        db.execute(
            update(Product)
            .where(Product.id == item.product_id)
            .values(stock=Product.stock + item.quantity)
        )


@app.on_event("startup")
def seed_products():
    with Session(engine) as db:
        if db.scalar(select(func.count(Product.id))) == 0:
            db.add_all(Product(**product) for product in SEED_PRODUCTS)
            db.commit()


@app.get("/")
def root():
    return {"name": "Kartify API", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    with Session(engine) as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/products")
def list_products(category: str | None = None, q: str | None = None, sort: str = "featured", db: Session = Depends(get_db)):
    if q:
        products = rank_products(db, q)
    else:
        statement = select(Product)
        if category and category.lower() != "everything":
            statement = statement.where(func.lower(Product.category) == category.lower())
        if sort == "price-low":
            statement = statement.order_by(Product.price.asc())
        elif sort == "price-high":
            statement = statement.order_by(Product.price.desc())
        elif sort == "rating":
            statement = statement.order_by(Product.rating.desc())
        else:
            statement = statement.order_by(Product.id.asc())
        products = list(db.scalars(statement).all())
    return [serialize_product(product) for product in products]


@app.get("/api/products/{product_id}")
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return serialize_product(product)


@app.post("/api/assistant")
def assistant(request: AssistantRequest, db: Session = Depends(get_db)):
    recommendations = rank_products(db, request.message, request.product_ids or None)
    return {"reply": assistant_reply(request.message, recommendations), "products": [serialize_product(item) for item in recommendations]}


@app.get("/api/recommendations/{product_id}")
def recommendations(product_id: int, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    similar = rank_products(db, f"{product.category} {product.tags} {product.description}", [item.id for item in db.scalars(select(Product)).all() if item.id != product_id])
    return [serialize_product(item) for item in similar]


@app.post("/api/orders", status_code=status.HTTP_201_CREATED)
def create_order(
    request: OrderCreate,
    user: User = Depends(authenticated_user),
    db: Session = Depends(get_db),
):
    if ENVIRONMENT == "production":
        raise HTTPException(status_code=404, detail="Not found")
    order = record_order(request, user, db, status_value="Processing", payment_status="demo")
    return {
        "id": order.id,
        "status": order.status,
        "payment_status": order.payment_status,
        "total": order.total,
        "created_at": order.created_at,
    }


@app.post("/api/payments/razorpay/orders", status_code=status.HTTP_201_CREATED)
def create_razorpay_order(
    request: OrderCreate,
    user: User = Depends(authenticated_user),
    db: Session = Depends(get_db),
):
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(status_code=503, detail="Online checkout is not configured yet")
    active_orders = db.scalars(select(Order).where(
        Order.user_id == user.id,
        Order.payment_status == "pending",
    )).all()
    if active_orders:
        requested_items = sorted((line.product_id, line.quantity) for line in request.items)
        for active_order in active_orders:
            current_items = sorted((item.product_id, item.quantity) for item in active_order.items)
            if (
                active_order.address == request.address.strip()
                and current_items == requested_items
                and active_order.razorpay_order_id
            ):
                return {
                    "order_id": active_order.id,
                    "razorpay_order_id": active_order.razorpay_order_id,
                    "amount": order_amount_paise(active_order),
                    "currency": "INR",
                    "key_id": RAZORPAY_KEY_ID,
                    "name": active_order.customer_name,
                    "email": active_order.email,
                }
        raise HTTPException(
            status_code=409,
            detail="You have a checkout awaiting payment. Retry that checkout before starting another one.",
        )
    order = record_order(
        request,
        user,
        db,
        status_value="Awaiting Payment",
        payment_status="pending",
    )
    try:
        payment_order = razorpay_request("POST", "orders", {
            "amount": order_amount_paise(order),
            "currency": "INR",
            "receipt": f"kartify-{order.id}",
            "notes": {"kartify_order_id": str(order.id), "customer_email": order.email},
        })
    except HTTPException:
        restore_order_inventory(order, db)
        order.status = "Cancelled"
        order.payment_status = "failed"
        db.commit()
        raise
    if (
        not isinstance(payment_order.get("id"), str)
        or payment_order.get("amount") != order_amount_paise(order)
        or payment_order.get("currency") != "INR"
    ):
        restore_order_inventory(order, db)
        order.status = "Cancelled"
        order.payment_status = "failed"
        db.commit()
        raise HTTPException(status_code=502, detail="Razorpay returned an invalid payment order")
    order.razorpay_order_id = payment_order["id"]
    db.commit()
    return {
        "order_id": order.id,
        "razorpay_order_id": order.razorpay_order_id,
        "amount": order_amount_paise(order),
        "currency": "INR",
        "key_id": RAZORPAY_KEY_ID,
        "name": order.customer_name,
        "email": order.email,
    }


@app.post("/api/payments/razorpay/verify")
def verify_razorpay_payment(
    request: RazorpayPaymentVerification,
    user: User = Depends(authenticated_user),
    db: Session = Depends(get_db),
):
    order = db.scalar(select(Order).where(
        Order.razorpay_order_id == request.order_id,
        Order.user_id == user.id,
    ))
    if not order:
        raise HTTPException(status_code=404, detail="Payment order not found")
    expected_signature = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        f"{request.order_id}|{request.payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not RAZORPAY_KEY_SECRET or not hmac.compare_digest(expected_signature, request.signature):
        raise HTTPException(status_code=400, detail="Payment signature could not be verified")

    payment = razorpay_request("GET", f"payments/{request.payment_id}")
    if (
        payment.get("order_id") != request.order_id
        or payment.get("amount") != order_amount_paise(order)
        or payment.get("currency") != "INR"
        or payment.get("status") != "captured"
    ):
        raise HTTPException(status_code=409, detail="Razorpay has not confirmed the full payment yet")
    set_order_paid(order, request.payment_id, db)
    return {"id": order.id, "status": order.status, "payment_status": order.payment_status, "total": order.total}


@app.post("/api/payments/razorpay/webhook")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    if not RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Payment webhook is not configured")
    body = await request.body()
    supplied_signature = request.headers.get("X-Razorpay-Signature", "")
    expected_signature = hmac.new(
        RAZORPAY_WEBHOOK_SECRET.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    if not supplied_signature or not hmac.compare_digest(expected_signature, supplied_signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    try:
        event = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid webhook payload")
    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="Invalid webhook payload")
    event_name = event.get("event")
    payload = event.get("payload")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid webhook event")
    if event_name == "refund.processed":
        refund_data = payload.get("refund")
        refund_entity = refund_data.get("entity") if isinstance(refund_data, dict) else None
        if not isinstance(refund_entity, dict):
            raise HTTPException(status_code=400, detail="Invalid refund event")
        order = db.scalar(select(Order).where(Order.razorpay_payment_id == refund_entity.get("payment_id")))
        if not order or order.razorpay_refund_id != refund_entity.get("id"):
            raise HTTPException(status_code=404, detail="Refund order not found")
        if order.payment_status != "refunded":
            order.payment_status = "refunded"
            order.status = "Cancelled"
            restore_order_inventory(order, db)
            db.commit()
        return {"received": True}
    if event_name == "refund.failed":
        refund_data = payload.get("refund")
        refund_entity = refund_data.get("entity") if isinstance(refund_data, dict) else None
        if not isinstance(refund_entity, dict):
            raise HTTPException(status_code=400, detail="Invalid refund event")
        order = db.scalar(select(Order).where(Order.razorpay_payment_id == refund_entity.get("payment_id")))
        if order and order.razorpay_refund_id == refund_entity.get("id") and order.payment_status == "refund_pending":
            order.payment_status = "paid"
            order.razorpay_refund_id = None
            db.commit()
        return {"received": True}
    if event_name != "payment.captured":
        return {"received": True}

    payment = payload.get("payment")
    payment_entity = payment.get("entity") if isinstance(payment, dict) else None
    if not isinstance(payment_entity, dict):
        raise HTTPException(status_code=400, detail="Invalid payment event")
    razorpay_order_id = payment_entity.get("order_id")
    payment_id = payment_entity.get("id")
    order = db.scalar(select(Order).where(Order.razorpay_order_id == razorpay_order_id))
    if not order:
        raise HTTPException(status_code=404, detail="Payment order not found")
    if (
        not isinstance(payment_id, str)
        or payment_entity.get("amount") != order_amount_paise(order)
        or payment_entity.get("currency") != "INR"
        or payment_entity.get("status") != "captured"
    ):
        raise HTTPException(status_code=409, detail="Captured payment does not match the Kartify order")
    set_order_paid(order, payment_id, db)
    return {"received": True}


@app.get("/api/orders")
def get_orders(user: User = Depends(authenticated_user), db: Session = Depends(get_db)):
    orders = db.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())).all()
    return [{"id": order.id, "status": order.status, "payment_status": order.payment_status, "total": order.total, "created_at": order.created_at, "items": [{"product_id": item.product_id, "quantity": item.quantity, "unit_price": item.unit_price} for item in order.items]} for order in orders]


@app.post("/api/auth/signup", status_code=status.HTTP_201_CREATED)
def signup(request: SignupRequest, db: Session = Depends(get_db)):
    email = request.email.casefold()
    is_admin = False
    if email == ADMIN_EMAIL:
        if not ADMIN_SETUP_TOKEN or not request.admin_setup_token or not hmac.compare_digest(request.admin_setup_token, ADMIN_SETUP_TOKEN):
            raise HTTPException(status_code=403, detail="A valid seller setup code is required for this account")
        is_admin = True
    elif request.admin_setup_token:
        raise HTTPException(status_code=400, detail="The seller setup code can only be used with the configured admin email")
    user = User(name=request.name.strip(), email=email, password_hash=hash_password(request.password), is_admin=is_admin)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    db.refresh(user)
    return auth_response(user)


@app.post("/api/auth/admin-claim")
def claim_admin(
    request: AdminSetupRequest,
    user: User = Depends(authenticated_user),
    db: Session = Depends(get_db),
):
    if not ADMIN_EMAIL or user.email != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Only the configured admin account can claim seller access")
    if not ADMIN_SETUP_TOKEN or not hmac.compare_digest(request.admin_setup_token, ADMIN_SETUP_TOKEN):
        raise HTTPException(status_code=403, detail="The seller setup code is invalid")
    user.is_admin = True
    db.commit()
    return {"is_admin": True}


@app.post("/api/auth/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == request.email.lower()))
    if not user or not password_matches(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return auth_response(user)


@app.post("/api/auth/google")
def google_login(request: SocialLoginRequest, db: Session = Depends(get_db)):
    claims = google_profile(request.credential)
    return complete_social_login(
        "google",
        claims["sub"],
        claims.get("name") if isinstance(claims.get("name"), str) else "",
        claims["email"],
        request.admin_setup_token,
        db,
    )


@app.post("/api/auth/facebook")
def facebook_login(request: SocialLoginRequest, db: Session = Depends(get_db)):
    profile = facebook_profile(request.credential)
    return complete_social_login(
        "facebook",
        profile["id"],
        profile.get("name") if isinstance(profile.get("name"), str) else "",
        profile["email"],
        request.admin_setup_token,
        db,
    )


@app.post("/api/auth/link/{provider}")
def link_social_account(
    provider: str,
    request: SocialLoginRequest,
    user: User = Depends(authenticated_user),
    db: Session = Depends(get_db),
):
    if provider == "google":
        profile = google_profile(request.credential)
    elif provider == "facebook":
        profile = facebook_profile(request.credential)
    else:
        raise HTTPException(status_code=404, detail="Social sign-in provider is not supported")
    provider_user_id = profile["sub"] if provider == "google" else profile["id"]
    return link_social_identity(provider, provider_user_id, profile["email"], user, db)


@app.get("/api/auth/me")
def get_current_user(user: User = Depends(authenticated_user)):
    return auth_response(user)["user"]


@app.post("/api/products/{product_id}/reviews", status_code=status.HTTP_201_CREATED)
def add_review(product_id: int, request: ReviewCreate, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    review = Review(product_id=product_id, author=request.author.strip(), rating=request.rating, body=request.body.strip())
    db.add(review)
    product.rating = round((product.rating * product.review_count + request.rating) / (product.review_count + 1), 1)
    product.review_count += 1
    db.commit()
    db.refresh(review)
    return {"id": review.id, "author": review.author, "rating": review.rating, "body": review.body}


@app.get("/api/products/{product_id}/reviews")
def list_reviews(product_id: int, db: Session = Depends(get_db)):
    if not db.get(Product, product_id):
        raise HTTPException(status_code=404, detail="Product not found")
    reviews = db.scalars(select(Review).where(Review.product_id == product_id).order_by(Review.created_at.desc())).all()
    return [{"id": review.id, "author": review.author, "rating": review.rating, "body": review.body, "created_at": review.created_at} for review in reviews]


@app.get("/api/admin/summary")
def admin_summary(
    _: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    orders = list(db.scalars(select(Order).order_by(Order.created_at.desc())).all())
    products = list(db.scalars(select(Product)).all())
    settled_orders = [order for order in orders if order.payment_status in {"paid", "demo"}]
    now = datetime.now(timezone.utc).date()
    sales = []
    for offset in range(6, -1, -1):
        day = now - timedelta(days=offset)
        day_orders = [
            order for order in settled_orders
            if order.created_at.date() == day
        ]
        sales.append({
            "date": day.isoformat(),
            "label": day.strftime("%a"),
            "revenue": round(sum(order.total for order in day_orders), 2),
            "orders": len(day_orders),
        })
    return {
        "total_revenue": round(sum(order.total for order in settled_orders), 2),
        "order_count": len(settled_orders),
        "product_count": len(products),
        "low_stock_count": sum(product.stock <= 5 for product in products),
        "sales": sales,
        "recent_orders": [{
            "id": order.id,
            "customer_name": order.customer_name,
            "email": order.email,
            "total": order.total,
            "status": order.status,
            "payment_status": order.payment_status,
            "created_at": order.created_at,
        } for order in orders],
        "products": [serialize_product(product) for product in products],
    }


@app.post("/api/admin/products", status_code=status.HTTP_201_CREATED)
def add_product(request: ProductCreate, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    product = Product(**request.model_dump(exclude={"tags"}), tags=",".join(request.tags))
    db.add(product)
    db.commit()
    db.refresh(product)
    return serialize_product(product)


@app.put("/api/admin/products/{product_id}")
def update_product(product_id: int, request: ProductCreate, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    for field, value in request.model_dump(exclude={"tags"}).items():
        setattr(product, field, value)
    product.tags = ",".join(request.tags)
    db.commit()
    db.refresh(product)
    return serialize_product(product)


@app.delete("/api/admin/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if db.scalar(select(OrderItem.id).where(OrderItem.product_id == product_id).limit(1)):
        raise HTTPException(status_code=409, detail="This product is part of an order and cannot be deleted. Set its stock to zero instead.")
    if db.scalar(select(Review.id).where(Review.product_id == product_id).limit(1)):
        raise HTTPException(status_code=409, detail="This product has customer reviews and cannot be deleted. Set its stock to zero instead.")
    db.delete(product)
    db.commit()


@app.patch("/api/admin/orders/{order_id}")
def update_order_status(
    order_id: int,
    request: OrderStatusUpdate,
    _: User = Depends(admin_user),
    db: Session = Depends(get_db),
):
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    allowed_transitions = {
        "Processing": {"Shipped", "Cancelled"},
        "Shipped": {"Delivered"},
        "Delivered": set(),
        "Cancelled": set(),
    }
    if request.status == order.status:
        return {"id": order.id, "status": order.status}
    if order.payment_status == "refund_pending":
        raise HTTPException(status_code=409, detail="Razorpay is still processing the refund for this order")
    if request.status not in allowed_transitions.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot change an order from {order.status} to {request.status}")
    if request.status == "Cancelled":
        if order.payment_status == "paid":
            refund = razorpay_request("POST", f"payments/{order.razorpay_payment_id}/refund", {
                "amount": order_amount_paise(order),
                "notes": {"kartify_order_id": str(order.id)},
            })
            if not isinstance(refund.get("id"), str):
                raise HTTPException(status_code=502, detail="Razorpay did not confirm the refund")
            order.razorpay_refund_id = refund["id"]
            order.payment_status = "refund_pending"
            db.commit()
            return {"id": order.id, "status": order.status, "payment_status": order.payment_status}
        restore_order_inventory(order, db)
    order.status = request.status
    db.commit()
    return {"id": order.id, "status": order.status, "payment_status": order.payment_status}
