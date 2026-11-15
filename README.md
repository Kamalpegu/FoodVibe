# FoodVibe

FoodVibe is a Python food assistant that uses Groq models to suggest recipes from
a text query or fridge photo, and recommend ingredient substitutions with
updated cooking steps.

## Features

- Analyze a fridge image and/or text request to produce a structured recipe.
- Suggest ingredient alternatives and update the recipe steps for a selected
  substitute.
- Validate model responses with Pydantic schemas.

## Where AI is used

FoodVibe uses Groq-hosted language models for two specific tasks:

- **Recipe suggestions:** The model uses the user's text request and, when
  provided, a fridge image to identify visible ingredients and generate recipe
  options with ingredients and cooking instructions. The API validates the
  returned data against Pydantic schemas before sending it to the frontend.
- **Ingredient substitutions:** When a user requests a swap, the model suggests
  alternatives and rewrites the affected cooking steps. Its response is also
  schema-validated.

The rest of the core flow is handled by application code: the React interface,
API routing, recipe selection, timer extraction and countdowns, cooking
progress, and saving/restoring the browser session. These parts do not use AI
to make their decisions.

## Setup

See [setup.md](./setup.md) for Python environment setup, dependency installation,
and Groq API key configuration.

## Modules

- `backend/src/food_look.py` provides `analyze_fridge_and_suggest()`. It accepts
  a text query, image bytes, or an image file path and returns a recipe
  dictionary.
- `backend/src/ingredient_swap.py` provides
  `resolve_missing_ingredient()`. It accepts a recipe, a missing ingredient,
  and optional fridge items or a preferred substitute, and returns alternatives
  plus updated steps.

Both modules can also be run directly for their built-in example. They require
`GROQ_API_KEY` and call the Groq API.

## Run the application

After completing setup, start the backend API from the project root:

```powershell
python -m uvicorn backend.start.api:app --reload
```

In another terminal, start the React frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). The
frontend suggests three recipes from a text request or fridge photo. Choose one
to reveal its ingredients and mapped cooking steps. It also finds ingredient
substitutions, tracks cooking progress, and runs visible countdowns for timed
steps. Vite proxies `/api` requests to the local backend. To test on a phone,
open the Network URL printed by Vite while the phone and computer are on the
same Wi-Fi. The backend requires `GROQ_API_KEY`.

## Running beyond local development

The API limits concurrent Groq requests to 8 per worker by default and rejects
additional requests with HTTP 503 rather than allowing unbounded model work.
Set `FOODVIBE_LLM_CONCURRENCY` to tune that limit for your Groq plan and host.
The limit is per worker process; total possible concurrent model calls are the
limit multiplied by the number of workers and replicas.

For a single-host deployment, run without `--reload` and choose a worker count
appropriate for the host:

```powershell
python -m uvicorn backend.start.api:app --host 0.0.0.0 --port 8000 --workers 4
```

Set `FOODVIBE_CORS_ORIGINS` to a comma-separated list of trusted frontend
origins when deploying the frontend separately, for example
`https://foodvibe.example.com`. Use a managed secrets store for `GROQ_API_KEY`.
This is a stateless API foundation, not a capacity guarantee: throughput is
constrained by the Groq model's rate limits, response latency, and your hosting
plan. Monitor provider usage and HTTP 503/502 responses before increasing
worker or concurrency counts.

## Dependencies

Install the backend dependencies with:

```powershell
python -m pip install -r requirements.txt
```
