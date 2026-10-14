from pydantic import BaseModel, EmailStr, Field


class ProductCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    category: str = Field(min_length=2, max_length=60)
    price: float = Field(gt=0)
    original_price: float = Field(gt=0)
    image: str = Field(min_length=5, max_length=500)
    description: str = Field(min_length=5)
    badge: str = ""
    stock: int = Field(default=0, ge=0)
    tags: list[str] = Field(default_factory=list)


class OrderLine(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=50)


class OrderCreate(BaseModel):
    customer_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    address: str = Field(min_length=8, max_length=1000)
    items: list[OrderLine] = Field(min_length=1, max_length=30)


class RazorpayPaymentVerification(BaseModel):
    order_id: str = Field(min_length=1, max_length=100)
    payment_id: str = Field(min_length=1, max_length=100)
    signature: str = Field(min_length=1, max_length=256)


class AssistantRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    product_ids: list[int] = Field(default_factory=list, max_length=200)


class SignupRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    admin_setup_token: str | None = Field(default=None, max_length=256)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class SocialLoginRequest(BaseModel):
    credential: str = Field(min_length=1, max_length=8192)
    admin_setup_token: str | None = Field(default=None, max_length=256)


class AdminSetupRequest(BaseModel):
    admin_setup_token: str = Field(min_length=1, max_length=256)


class ReviewCreate(BaseModel):
    author: str = Field(min_length=2, max_length=120)
    rating: int = Field(ge=1, le=5)
    body: str = Field(min_length=5, max_length=2000)


class OrderStatusUpdate(BaseModel):
    status: str = Field(pattern="^(Processing|Shipped|Delivered|Cancelled)$")
