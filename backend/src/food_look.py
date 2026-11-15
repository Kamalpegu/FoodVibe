import os
import json
import base64
import mimetypes
from pathlib import Path
from pydantic import BaseModel, Field
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.environ.get("GROQ_API_KEY"), timeout=60.0, max_retries=1)

# --- Output Data Schemas ---
class IngredientItem(BaseModel):
    id: str = Field(description="Unique short id like ing_1, ing_2")
    name: str
    quantity: float = Field(description="Numeric amount for scaling servings")
    unit: str
    swaps: list[str] = Field(description="2 realistic ingredient substitutes")

class StepItem(BaseModel):
    stepNumber: int
    instruction: str

class RecipeOption(BaseModel):
    recipe_title: str
    prep_time_mins: int
    base_servings: int
    ingredients: list[IngredientItem]
    steps: list[StepItem]

class RecipeSuggestion(RecipeOption):
    detected_items: list[str] = Field(description="Food items spotted in the fridge photo")

class RecipeCollection(BaseModel):
    detected_items: list[str] = Field(description="Food items spotted in the fridge photo")
    recipes: list[RecipeOption] = Field(description="Distinct recipe choices the user can choose from")


# --- Core Function to Import in app.py ---
def analyze_fridge_and_suggest(
    food_query: str = "",
    image_bytes: bytes | None = None,
    image_path: str | None = None,
    mime_type: str = "image/jpeg",
    suggestion_count: int = 1,
) -> dict:
    """
    Analyzes a fridge image (from bytes or file path) and/or a text search query
    using Groq's multimodal vision model. Returns one recipe by default, or a
    collection of recipe choices when suggestion_count is greater than one.
    """
    if not 1 <= suggestion_count <= 4:
        raise ValueError("suggestion_count must be between 1 and 4.")

    if not food_query and not image_bytes and not image_path:
        raise ValueError("Provide at least a food_query, image_bytes, or image_path.")

    response_schema = RecipeSuggestion if suggestion_count == 1 else RecipeCollection
    recipe_instructions = (
        "Create one practical, delicious recipe combining the available ingredients and the user's request. "
        if suggestion_count == 1
        else f"Suggest exactly {suggestion_count} distinct, practical recipes that fit the user's request and ingredients. "
        "Give each recipe a different title and a meaningfully different preparation or flavor profile. "
        "Do not merely rename the same recipe. Put the detected fridge items once in the top-level 'detected_items' field, "
        "and put the recipe choices in the 'recipes' list. "
    )

    # Load bytes from file path if image_path was passed instead of raw bytes
    if image_path and not image_bytes:
        path_obj = Path(image_path)
        if not path_obj.exists():
            raise FileNotFoundError(f"Image not found at: {image_path}")
        image_bytes = path_obj.read_bytes()
        guessed_type, _ = mimetypes.guess_type(path_obj)
        if guessed_type:
            mime_type = guessed_type

    # Construct the prompt
    prompt_text = (
        "You are an expert chef assistant. Inspect the attached fridge photo (if provided) "
        "and list every visible edible ingredient in 'detected_items'. "
        f"User's search query / preference: '{food_query.strip() or 'Suggest the best meal I can make with what is in the fridge'}'. "
        f"{recipe_instructions}"
        "Assume basic pantry staples (salt, pepper, cooking oil, water) are on hand. "
        "Ensure all ingredient quantities are numeric floats so servings can scale mathematically, "
        "and provide 2 practical swaps per ingredient.\n\n"
        "Respond strictly with valid JSON matching this exact schema:\n"
        f"{json.dumps(response_schema.model_json_schema())}"
    )

    user_content = [{"type": "text", "text": prompt_text}]

    # Encode image to base64 data URL if present
    if image_bytes:
        encoded_img = base64.b64encode(image_bytes).decode("utf-8")
        user_content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime_type};base64,{encoded_img}"
            },
        })

    # Call Groq Vision API
    completion = client.chat.completions.create(
        model="qwen/qwen3.8-27b",
        messages=[
            {
                "role": "system",
                "content": "You output only valid JSON matching the requested schema. No markdown fences or extra text."
            },
            {
                "role": "user",
                "content": user_content
            }
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
    )

    raw_json = completion.choices[0].message.content

    # Validate and return standard Python dict
    validated = response_schema.model_validate_json(raw_json)
    if suggestion_count == 1:
        return validated.model_dump()

    collection = RecipeCollection.model_validate(validated)
    return collection.model_dump()


# Optional: Quick standalone test when running `python food_look.py` directly
if __name__ == "__main__":
    sample_result = analyze_fridge_and_suggest(
        food_query="quick breakfast with eggs and cheese"
    )
    print(json.dumps(sample_result, indent=2))