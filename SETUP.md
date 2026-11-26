# HandScriptAI – Setup (login / sign up fix)

## 1. Backend
```
cd backend
cp .env.example .env      # then edit .env (MYSQL_URL, JWT_SECRET, GOOGLE_CLIENT_ID, API_KEY)
npm install
npm run dev
```
Open http://localhost:3001/api/health -> must show `"database":"connected","jwtSecret":true`

## 2. Frontend
```
cd frontend
cp .env.example .env      # VITE_BASE_URL=http://localhost:3001
npm install
npm run dev
```
Open http://localhost:5173

## Google Sign-In
Google Cloud Console -> APIs & Services -> Credentials -> your OAuth Client ->
"Authorized JavaScript origins": add http://localhost:5173 (and your deployed URL).
