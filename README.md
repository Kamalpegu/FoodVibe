# FlamPpo

FlamPpo is a Python food assistant that uses Groq models to suggest recipes from
a text query or fridge photo, and recommend ingredient substitutions with
updated cooking steps.

## Features

- Analyze a fridge image and/or text request to produce a structured recipe.
- Suggest ingredient alternatives and update the recipe steps for a selected
  substitute.
- Validate model responses with Pydantic schemas.

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

After completing setup, start the interactive assistant from the project root:

```powershell
python .\backend\start\main.py
```

You can optionally provide a recipe request and fridge image:

```powershell
python .\backend\start\main.py --query "quick breakfast with eggs" --image "C:\path\to\fridge.jpg"
```

The app suggests a recipe, optionally substitutes an ingredient, extracts
step timers, and lets you track cooking progress.

## Dependencies

Install the dependencies with:

```powershell
python -m pip install -r requirements.txt
```
