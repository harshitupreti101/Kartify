import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Product

STOP_WORDS = {
    "a", "an", "and", "are", "for", "i", "in", "is", "it", "me", "my", "of",
    "on", "or", "the", "to", "under", "with", "want", "need", "looking", "find",
}


def terms(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 2 and word not in STOP_WORDS}


def rank_products(db: Session, query: str, allowed_ids: list[int] | None = None) -> list[Product]:
    statement = select(Product)
    if allowed_ids:
        statement = statement.where(Product.id.in_(allowed_ids))
    products = list(db.scalars(statement).all())
    query_terms = terms(query)
    price_match = re.search(r"(?:under|below|less than)\s*₹?\s*([\d,]+)", query.lower())
    budget = int(price_match.group(1).replace(",", "")) if price_match else None

    def score(product: Product) -> tuple[float, float]:
        searchable = terms(f"{product.name} {product.category} {product.description} {product.tags}")
        overlap = len(query_terms & searchable)
        budget_bonus = 2 if budget and product.price <= budget else 0
        over_budget_penalty = -2 if budget and product.price > budget else 0
        return (overlap + budget_bonus + over_budget_penalty + product.rating / 5, product.rating)

    ranked = sorted(products, key=score, reverse=True)
    if query_terms:
        ranked = [item for item in ranked if score(item)[0] > 1]
    return ranked[:4]


def assistant_reply(message: str, recommendations: list[Product]) -> str:
    text = message.lower()
    if recommendations:
        names = ", ".join(product.name for product in recommendations[:3])
        return f"I found a few good matches for you: {names}. I balanced what you mentioned with customer favorites. Want to explore one?"
    if any(word in text for word in ("gift", "present", "dad", "mom", "birthday")):
        return "I couldn't find an exact match yet. Try adding a budget or a hint like home, coffee, clothing, or accessories."
    return "I couldn't find an exact match in this little catalog yet. Try a category, occasion, comfort need, or budget (for example: “gift under ₹2000”)."
