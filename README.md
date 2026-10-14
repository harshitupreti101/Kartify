# Kartify

Kartify is a React + TypeScript storefront with a FastAPI backend. Local development uses SQLite; deployment uses a persistent Python host and PostgreSQL, since Vercel's filesystem is not a durable database.

## Run locally

### Backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Set private KARTIFY_SECRET_KEY, KARTIFY_ADMIN_EMAIL, and KARTIFY_ADMIN_SETUP_TOKEN.
uvicorn app.main:app --reload --env-file .env
```

The API runs at `http://localhost:8000`; interactive docs are at `http://localhost:8000/docs`. SQLite data is stored in `backend/kartify.db` and sample products are added automatically. Set `KARTIFY_ADMIN_EMAIL` and a private random `KARTIFY_ADMIN_SETUP_TOKEN`; use the token only when creating or claiming that specific seller account.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Vite prints the local URL, usually `http://localhost:5173`. Set frontend variables in `frontend/.env.local`.

### Social sign-in

Copy `frontend/.env.example` to `frontend/.env.local`, and set `VITE_GOOGLE_CLIENT_ID` and `VITE_FACEBOOK_APP_ID`. In `backend/.env`, set the matching `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID`, and private `FACEBOOK_APP_SECRET`. Never expose the Facebook app secret in the frontend or source control.

Register the local origins `http://localhost:5173` and `http://127.0.0.1:5173` with the respective OAuth apps. Add your deployed HTTPS frontend domain before launch. Restart the frontend and backend after editing env files. Existing email/password users can sign in and link a social account using the same email.

## Payments

Without a Razorpay key, local checkout remains explicitly marked as a demo and does not collect money. For a real test checkout, set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `backend/.env`; set the matching public `VITE_RAZORPAY_KEY_ID` in `frontend/.env.local`; and restart both servers. Only the public key ID belongs in frontend configuration.

The API calculates order totals from catalog prices, creates Razorpay orders, reserves stock, checks the checkout signature and fetches payment state from Razorpay before confirming an order. Only a full-amount captured INR payment marks an order as paid/Processing. Configure automatic capture in Razorpay. Set a Razorpay webhook to `https://<api-host>/api/payments/razorpay/webhook` and subscribe to `payment.captured`; set the webhook's private secret as `RAZORPAY_WEBHOOK_SECRET`.

## Deploy: Vercel frontend + hosted API/database

1. Push the repo to GitHub. Import it into Vercel with project root `frontend`, build command `npm run build`, and output directory `dist`. `frontend/vercel.json` provides SPA routing.
2. Provision a persistent Python web service and PostgreSQL database on Render or another host. Set the API service root to `backend`, build command to `pip install -r requirements.txt`, start command to `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, and health check to `/health`.
3. Set backend env values: `KARTIFY_ENV=production`, PostgreSQL `DATABASE_URL`, strong private `KARTIFY_SECRET_KEY`, `KARTIFY_ADMIN_EMAIL`, strong private `KARTIFY_ADMIN_SETUP_TOKEN`, exact `CORS_ORIGINS` (your Vercel HTTPS origin, no trailing slash), live Razorpay key ID/secret/webhook secret, and optional social-provider settings. Production refuses to start with test Razorpay keys or missing required secrets.
4. Set Vercel env values: `VITE_API_URL` (the API origin), `VITE_RAZORPAY_KEY_ID` (matching public live key ID), and optional `VITE_GOOGLE_CLIENT_ID` / `VITE_FACEBOOK_APP_ID`. Redeploy after changing `VITE_*` variables; they are embedded at build time.
5. Configure OAuth redirect/origin allowlists and the Razorpay webhook for the deployed HTTPS domain. Test `/health`, account creation, a Razorpay test payment and order status before switching to live payment keys.

Never put database credentials, Razorpay secrets, JWT secrets, admin setup tokens, or Facebook app secrets in `VITE_*` variables or chat. Vercel does not host this FastAPI API or durable SQLite storage. Local SQLite data does not automatically migrate to hosted PostgreSQL.

## Features and remaining integrations

- Catalog browsing, search, category filters, sorting, comparison, recently viewed, wishlist, cart, customer accounts, and order history.
- Seller studio for catalog, stock and fulfilment management.
- Cart-aware assistant uses local catalog logic; it is not a hosted LLM or vector search system.
- Newsletter signup, transactional email, account email verification/password recovery, and product image uploads still need external service integrations.
- Before serving customers, configure/test live provider accounts, backups, monitoring, abuse/rate limits, account recovery, and persistent image storage. Obtain live Razorpay credentials privately; never share the secret keys.
