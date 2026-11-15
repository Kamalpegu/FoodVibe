import os
import json
from pydantic import BaseModel, Field
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.environ.get("GROQ_API_KEY"), timeout=60.0, max_retries=1)

# --- Output Data Schemas ---
class AlternativeOption(BaseModel):
    name: str = Field(description="Substitute ingredient name")
    quantity: float = Field(description="Converted numeric amount matching the original recipe scale")
    unit: str = Field(description="Unit of measurement")
    prep_adjustment: str = Field(description="How to prepare/use this swap instead of the original")

class StepItem(BaseModel):
    stepNumber: int
    instruction: str

class SwapResponse(BaseModel):
    missing_ingredient: str
    alternatives: list[AlternativeOption] = Field(
        description="2 to 3 practical substitutes with converted quantities"
    )
    recommended_swap: AlternativeOption = Field(
        description="The best single replacement automatically applied to the updated steps below"
    )
    updated_steps: list[StepItem] = Field(
        description="Full recipe steps rewritten to seamlessly use the recommended_swap"
    )


# --- Core Function to Import in app.py ---
def resolve_missing_ingredient(
    recipe_title: str,
    missing_ingredient: str,
    original_quantity: float,
    original_unit: str,
    current_steps: list[dict],
    available_fridge_items: list[str] | None = None,
    user_preferred_swap: str = "",
) -> dict:
    """
    Called when a user says an ingredient is missing or requests a specific swap.
    Returns converted substitute quantities and rewritten cooking steps.
    """
    fridge_context = (
        f"Items currently in user's fridge: {', '.join(available_fridge_items)}."
        if available_fridge_items
        else "No extra fridge inventory list provided."
    )

    preference_text = (
        f"The user selected '{user_preferred_swap}' as the substitute. Use this exact ingredient "
        "as 'recommended_swap' and rewrite every updated step to use it."
        if user_preferred_swap.strip()
        else "Pick the most common household/fridge substitute as 'recommended_swap'."
    )

    prompt = (
        f"Recipe: '{recipe_title}'\n"
        f"Missing Ingredient: {original_quantity} {original_unit} of '{missing_ingredient}'\n"
        f"{fridge_context}\n"
        f"{preference_text}\n\n"
        f"Current Cooking Steps:\n{json.dumps(current_steps, indent=2)}\n\n"
        "Tasks:\n"
        "1. Provide 2-3 realistic substitutes in 'alternatives' with exact converted numeric 'quantity' and 'unit' "
        "(prioritizing items already in the user's fridge if suitable).\n"
        "2. Set 'recommended_swap' to the exact user-selected substitute when one was provided; otherwise choose the best replacement.\n"
        "3. Rewrite 'updated_steps' so every mention or technique involving the missing ingredient "
        "is adjusted for the 'recommended_swap'.\n\n"
        "Respond strictly with valid JSON matching this schema:\n"
        f"{json.dumps(SwapResponse.model_json_schema())}"
    )

    completion = client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {
                "role": "system",
                "content": "You are a culinary substitution expert. Output only valid JSON matching the requested schema.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )

    raw_json = completion.choices[0].message.content
    validated = SwapResponse.model_validate_json(raw_json)
    return validated.model_dump()


# Standalone test
if __name__ == "__main__":
    sample_steps = [
        {"stepNumber": 1, "instruction": "In a bowl, whisk the eggs with the milk, salt, and pepper."},
        {"stepNumber": 2, "instruction": "Pour the egg mixture into a heated pan and scramble until set."},
    ]

    result = resolve_missing_ingredient(
        recipe_title="Cheesy Veggie Scramble",
        missing_ingredient="milk",
        original_quantity=30.0,
        original_unit="ml",
        current_steps=sample_steps,
        available_fridge_items=["eggs", "cheddar cheese", "bell pepper", "onion", "plain yogurt"],
    )
    print(json.dumps(result, indent=2))