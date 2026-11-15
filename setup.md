# Setup

## Requirements

- Python 3.10 or later
- A Groq API key

## Install

From the project root, create and activate a virtual environment:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install the Python dependencies:

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## Configure the API key

Create `backend/src/.env` with your Groq API key:

```dotenv
GROQ_API_KEY=your_groq_api_key
```

Keep this key private and do not commit `.env` files.

## Run the examples

From the project root, start the backend API:

```powershell
python -m uvicorn backend.start.api:app --reload
```

In another terminal, install and start the React frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). The
frontend suggests three recipes. Choose one to see its ingredients and
step-by-step cooking route, then optionally substitute ingredients, use timers,
and track progress. Keep the backend terminal running while you use the app.
Vite proxies API requests to the backend. To try the app on a phone, open the
Network URL printed by Vite while the phone and computer are on the same Wi-Fi.

## Deployment and concurrency

The API allows up to 8 concurrent Groq requests per worker by default. Busy
requests beyond that limit receive HTTP 503 with a short retry hint. Configure
the limit with `FOODVIBE_LLM_CONCURRENCY`; it applies independently in each
worker process, so the total is `workers × replicas × limit`. Tune it against
your Groq plan and host rather than raising it blindly.

For a single-host deployment, omit `--reload` and set a worker count suitable
for the machine:

```powershell
python -m uvicorn backend.start.api:app --host 0.0.0.0 --port 8000 --workers 4
```

If frontend and backend use different origins, set `FOODVIBE_CORS_ORIGINS` to a
comma-separated list of trusted frontend origins. Keep `GROQ_API_KEY` in the
hosting provider's secrets manager. This does not remove Groq quota or hosting
limits; monitor request latency and HTTP 503/502 responses as usage grows.

The original command-line examples are still available from the project root:

```powershell
python .\backend\src\food_look.py
python .\backend\src\ingredient_swap.py
python .\backend\start\main.py
```

To run the command-line app with a request or fridge image:

```powershell
python .\backend\start\main.py --query "quick breakfast with eggs" --image "C:\path\to\fridge.jpg"
```

All recipe and ingredient-substitution commands make live requests to the Groq
API and require a valid API key.
