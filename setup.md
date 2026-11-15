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

From the project root:

```powershell
python .\backend\start\main.py
python .\backend\src\food_look.py
python .\backend\src\ingredient_swap.py
```

The main app interactively generates a recipe, optionally substitutes an
ingredient, shows timers found in the steps, and tracks cooking progress. You
can also pass a query or image path:

```powershell
python .\backend\start\main.py --query "quick breakfast with eggs" --image "C:\path\to\fridge.jpg"
```

These commands make live requests to the Groq API and require a valid API key.
