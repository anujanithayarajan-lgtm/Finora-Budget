# Finora Budget

A modern personal finance web application that stores transactions in Sri Lankan Rupees (LKR) and supports selectable display currencies.

## Features
- User signup and login
- Income and expense tracking
- Category management
- Monthly and yearly filtering
- Summary cards and chart analytics
- PDF export for summary reports
- Finora logo branding in the app and downloaded PDF reports
- Dark and light theme switch
- Edit and delete transactions
- SQLite database backend
- Search transactions by month and year, view the full matching history, and export it as a PDF
- Browse yearly and monthly balance summaries, with annual and monthly PDF reports
- Convert displayed and entered amounts from the stored LKR values to supported currencies (LKR, USD, EUR, GBP, INR, AUD, CAD, JPY and AED)

Currency conversions use the latest rates from ExchangeRate-API. Transactions remain stored in LKR, and the selected display currency is saved in the browser.

## Demo login
- Email: demo@finora.com
- Password: demo123

## Project structure
- `backend/` - Express API and SQLite database
- `frontend/` - React dashboard UI

## Run locally

### Backend
```bash
cd backend
npm install
npm start
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Then open:
- http://localhost:4173

The local API uses SQLite at `backend/data/finance.db`. To point the frontend at another API, set `VITE_API_URL` (see [frontend/.env.example](./frontend/.env.example)).

## API summary
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/categories`
- `POST /api/categories`
- `DELETE /api/categories/:id`
- `GET /api/summary`
- `GET /api/transactions`
- `POST /api/transactions`
- `PUT /api/transactions/:id`
- `DELETE /api/transactions/:id`
- `GET /api/years`

## Deployment

The frontend is configured for Vercel. The Express API can run on Render and uses PostgreSQL when `DATABASE_URL` is set; local development continues to use SQLite. The repository includes a Render Blueprint in `render.yaml`.

1. Create a PostgreSQL database with a managed provider such as Neon and copy its connection string. Keep it private.
2. In Render, create a Blueprint from this repository. Set `DATABASE_URL` to the PostgreSQL connection string and use a temporary value for `FRONTEND_URL`; Render generates `JWT_SECRET`.
3. Import the repository into Vercel with the project root set to `frontend`, and set `VITE_API_URL` to the Render API URL followed by `/api` (for example, `https://your-api.onrender.com/api`).
4. Deploy the frontend, then set `FRONTEND_URL` in Render to the resulting Vercel origin and redeploy the API.

The hosted service starts with a fresh database and seeds the demo account. Local SQLite records are not automatically copied to PostgreSQL. Never commit database files, `.env` files, or deployment secrets.
