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

The root `vercel.json` deploys the React frontend and Express API as Vercel Services. The backend uses PostgreSQL when `DATABASE_URL` is set and SQLite for local development.

1. Create a PostgreSQL database with a managed provider such as Neon and copy its connection string. Keep it private.
2. Import this repository into Vercel with the project root set to the repository root. The root `vercel.json` configures the frontend and API as separate services on one deployment.
3. Configure `DATABASE_URL` and a long random `JWT_SECRET` as Vercel environment variables. Set `FRONTEND_URL` to the deployed Vercel origin if the API is accessed cross-origin.
4. Deploy the Vercel project. In production the frontend calls the API through `/api`, routed to the backend service; `/transactions` is rewritten to the frontend entry point so direct visits and refreshes work.

The hosted service starts with a fresh database and seeds the demo account. Local SQLite records are not automatically copied to PostgreSQL. Never commit database files, `.env` files, or deployment secrets.
