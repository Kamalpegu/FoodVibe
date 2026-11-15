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

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). The
frontend suggests a recipe, optionally substitutes an ingredient, shows timers,
and tracks cooking progress. Keep the backend terminal running while you use
the app.

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
