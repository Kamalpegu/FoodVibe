"""HTTP API used by the React frontend."""

import logging
import os
import threading
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from groq import APIError
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from backend.start.main import _load_backend_modules


logger = logging.getLogger(__name__)
MAX_IMAGE_BYTES = 10 * 1024 * 1024
LLM_CONCURRENCY = max(1, int(os.getenv("FOODVIBE_LLM_CONCURRENCY", "8")))
llm_slots = threading.BoundedSemaphore(LLM_CONCURRENCY)
cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "FOODVIBE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app = FastAPI(title="FoodVibe API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class SwapRequest(BaseModel):
    recipe: dict
    missing_ingredient: str = Field(min_length=1)
    preferred_swap: str = ""
    fridge_items: list[str] = Field(default_factory=list)


class ProgressRequest(BaseModel):
    steps: list[dict]
    step_number: int
    completed: bool = True


def _get_backend_functions():
    (
        analyze_recipe,
        resolve_swap,
        initialize_progress,
        mark_progress,
        extract_timers,
    ) = _load_backend_modules()
    return analyze_recipe, resolve_swap, initialize_progress, mark_progress, extract_timers


async def _run_llm(function, **kwargs):
    if not llm_slots.acquire(blocking=False):
        raise HTTPException(
            status_code=503,
            detail="The recipe service is busy. Please try again shortly.",
            headers={"Retry-After": "2"},
        )
    try:
        return await run_in_threadpool(function, **kwargs)
    finally:
        llm_slots.release()


async def _read_image(image: UploadFile | None) -> tuple[bytes | None, str]:
    if image is None:
        return None, "image/jpeg"
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Choose a JPG, PNG, or WEBP image.")

    image_bytes = await image.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="The fridge image must be 10 MB or smaller.")
    return image_bytes, image.content_type or "image/jpeg"


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/recipes")
async def create_recipe(
    query: Annotated[str, Form()] = "",
    image: Annotated[UploadFile | None, File()] = None,
) -> dict:
    if not query.strip() and image is None:
        raise HTTPException(status_code=400, detail="Add a recipe request or choose a fridge image.")

    analyze_recipe, _, initialize_progress, _, extract_timers = _get_backend_functions()
    image_bytes, mime_type = await _read_image(image)
    try:
        recipe = await _run_llm(
            analyze_recipe,
            food_query=query,
            image_bytes=image_bytes,
            mime_type=mime_type or "image/jpeg",
        )
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (APIError, ValidationError) as error:
        logger.exception("Recipe generation failed.")
        raise HTTPException(status_code=502, detail="Recipe generation failed. Check the Groq API configuration and try again.") from error

    steps = extract_timers(recipe["steps"])
    return {
        "recipe": {**recipe, "steps": steps},
        "progress": initialize_progress(recipe["steps"]),
    }


@app.post("/api/recipe-suggestions")
async def create_recipe_suggestions(
    query: Annotated[str, Form()] = "",
    image: Annotated[UploadFile | None, File()] = None,
) -> dict:
    if not query.strip() and image is None:
        raise HTTPException(status_code=400, detail="Add a recipe request or choose a fridge image.")

    analyze_recipe, _, initialize_progress, _, extract_timers = _get_backend_functions()
    image_bytes, mime_type = await _read_image(image)

    try:
        result = await _run_llm(
            analyze_recipe,
            food_query=query,
            image_bytes=image_bytes,
            mime_type=mime_type,
            suggestion_count=3,
        )
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (APIError, ValidationError) as error:
        logger.exception("Recipe suggestions failed.")
        raise HTTPException(status_code=502, detail="Recipe suggestions failed. Check the Groq API configuration and try again.") from error

    detected_items = result["detected_items"]
    suggestions = []
    for option in result["recipes"]:
        steps = extract_timers(option["steps"])
        recipe = {
            **option,
            "detected_items": detected_items,
            "steps": steps,
        }
        suggestions.append({
            "recipe": recipe,
            "progress": initialize_progress(option["steps"]),
        })

    return {"suggestions": suggestions}


@app.post("/api/substitutions")
async def substitute_ingredient(request: SwapRequest) -> dict:
    recipe = request.recipe
    ingredient = next(
        (
            item
            for item in recipe.get("ingredients", [])
            if item.get("name", "").casefold() == request.missing_ingredient.strip().casefold()
        ),
        None,
    )
    if ingredient is None:
        raise HTTPException(status_code=404, detail="That ingredient is not in this recipe.")

    _, resolve_swap, initialize_progress, _, extract_timers = _get_backend_functions()
    steps = [
        {"stepNumber": step["stepNumber"], "instruction": step["instruction"]}
        for step in recipe.get("steps", [])
    ]
    try:
        result = await _run_llm(
            resolve_swap,
            recipe_title=recipe.get("recipe_title", "Recipe"),
            missing_ingredient=ingredient["name"],
            original_quantity=ingredient["quantity"],
            original_unit=ingredient["unit"],
            current_steps=steps,
            available_fridge_items=request.fridge_items or recipe.get("detected_items", []),
            user_preferred_swap=request.preferred_swap,
        )
    except (APIError, ValidationError) as error:
        logger.exception("Ingredient substitution failed.")
        raise HTTPException(status_code=502, detail="Ingredient substitution failed. Check the Groq API configuration and try again.") from error

    updated_steps = result["updated_steps"]
    timed_steps = extract_timers(updated_steps)
    return {
        "substitution": result,
        "steps": timed_steps,
        "progress": initialize_progress(updated_steps),
    }


@app.post("/api/progress")
def update_progress(request: ProgressRequest) -> dict:
    _, _, _, mark_progress, _ = _get_backend_functions()
    try:
        return mark_progress(request.steps, request.step_number, request.completed)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
