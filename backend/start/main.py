"""Interactive command-line app for the FlamPpo recipe assistant."""

import argparse
import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = PROJECT_ROOT / "backend" / "src"


def _load_backend_modules():
    """Load the API key before importing modules that initialize the Groq client."""
    from dotenv import load_dotenv

    load_dotenv(SOURCE_DIR / ".env")
    if not os.environ.get("GROQ_API_KEY"):
        raise SystemExit(
            "GROQ_API_KEY is missing. Set it in backend/src/.env or your environment."
        )

    source_path = str(SOURCE_DIR)
    if source_path not in sys.path:
        sys.path.insert(0, source_path)

    from food_look import analyze_fridge_and_suggest
    from ingredient_swap import resolve_missing_ingredient
    from step_tracker import initialize_step_tracker, mark_step_status
    from timer import extract_timers_from_steps

    return (
        analyze_fridge_and_suggest,
        resolve_missing_ingredient,
        initialize_step_tracker,
        mark_step_status,
        extract_timers_from_steps,
    )


def _print_recipe(recipe: dict) -> None:
    print(f"\n{recipe['recipe_title']}")
    print(f"Preparation time: {recipe['prep_time_mins']} minutes")
    print(f"Servings: {recipe['base_servings']}")

    if recipe["detected_items"]:
        print("\nDetected ingredients:", ", ".join(recipe["detected_items"]))

    print("\nIngredients:")
    for ingredient in recipe["ingredients"]:
        amount = f"{ingredient['quantity']:g} {ingredient['unit']}".strip()
        print(f"  - {amount} {ingredient['name']}".strip())
        if ingredient["swaps"]:
            print(f"    Possible swaps: {', '.join(ingredient['swaps'])}")

    print("\nSteps:")
    for step in recipe["steps"]:
        print(f"  {step['stepNumber']}. {step['instruction']}")


def _offer_ingredient_swap(recipe: dict, resolve_missing_ingredient) -> list[dict]:
    answer = input("\nWould you like to replace a missing ingredient? [y/N]: ").strip().lower()
    if answer not in {"y", "yes"}:
        return recipe["steps"]

    missing = input("Ingredient to replace: ").strip()
    if not missing:
        print("No ingredient entered; keeping the original recipe steps.")
        return recipe["steps"]

    matched_ingredient = next(
        (
            ingredient
            for ingredient in recipe["ingredients"]
            if ingredient["name"].casefold() == missing.casefold()
        ),
        None,
    )
    if matched_ingredient is None:
        print(f"'{missing}' is not in the recipe ingredients; keeping the original steps.")
        return recipe["steps"]

    preferred_swap = input("Preferred substitute (optional): ").strip()
    inventory = input("Other ingredients you have (comma-separated, optional): ").strip()
    fridge_items = [item.strip() for item in inventory.split(",") if item.strip()]

    result = resolve_missing_ingredient(
        recipe_title=recipe["recipe_title"],
        missing_ingredient=matched_ingredient["name"],
        original_quantity=matched_ingredient["quantity"],
        original_unit=matched_ingredient["unit"],
        current_steps=recipe["steps"],
        available_fridge_items=fridge_items or recipe["detected_items"],
        user_preferred_swap=preferred_swap,
    )

    print(f"\nSubstitutes for {result['missing_ingredient']}:")
    for alternative in result["alternatives"]:
        amount = f"{alternative['quantity']:g} {alternative['unit']}".strip()
        print(f"  - {amount} {alternative['name']}: {alternative['prep_adjustment']}")

    recommended = result["recommended_swap"]
    amount = f"{recommended['quantity']:g} {recommended['unit']}".strip()
    print(f"\nRecommended: {amount} {recommended['name']}")
    print("Updated steps:")
    for step in result["updated_steps"]:
        print(f"  {step['stepNumber']}. {step['instruction']}")

    return result["updated_steps"]


def _track_cooking_steps(steps: list[dict], initialize_step_tracker, mark_step_status) -> None:
    state = initialize_step_tracker(steps)
    print("\nCooking progress:")

    while True:
        for step in state["steps"]:
            marker = "x" if step["completed"] else " "
            print(f"  [{marker}] {step['stepNumber']}. {step['instruction']}")

        print(
            f"Progress: {state['completed_count']}/{state['total_steps']} "
            f"steps ({state['progress_percent']}%)."
        )
        if state["is_recipe_finished"]:
            print("Recipe complete. Enjoy your meal!")
            return

        command = input(
            "Enter a step number to complete, 'undo <number>' to reopen it, or 'q' to quit: "
        ).strip().lower()
        if command in {"q", "quit", "exit"}:
            return

        parts = command.split()
        completed = True
        if len(parts) == 2 and parts[0] == "undo":
            parts = parts[1:]
            completed = False

        if len(parts) != 1 or not parts[0].isdigit():
            print("Enter a step number, 'undo <number>', or 'q'.\n")
            continue

        try:
            state = mark_step_status(state["steps"], int(parts[0]), completed=completed)
        except ValueError as error:
            print(f"{error}\n")


def run_app(query: str | None = None, image_path: str | None = None) -> None:
    (
        analyze_fridge_and_suggest,
        resolve_missing_ingredient,
        initialize_step_tracker,
        mark_step_status,
        extract_timers_from_steps,
    ) = _load_backend_modules()

    if query is None:
        query = input(
            "What would you like to cook? (Press Enter for a general fridge-based suggestion): "
        ).strip()
    if image_path is None:
        image_path = input("Fridge image path (optional; press Enter to skip): ").strip() or None

    recipe = analyze_fridge_and_suggest(
        food_query=query,
        image_path=image_path,
    )
    _print_recipe(recipe)

    cooking_steps = _offer_ingredient_swap(recipe, resolve_missing_ingredient)

    timed_steps = extract_timers_from_steps(cooking_steps)
    timers = [step["timer"] for step in timed_steps if step["timer"]["has_timer"]]
    if timers:
        print("\nSuggested timers:")
        for timer in timers:
            print(f"  Step {timer['stepNumber']}: {timer['label']}")
    else:
        print("\nNo timed steps were found in this recipe.")

    _track_cooking_steps(cooking_steps, initialize_step_tracker, mark_step_status)


def main() -> None:
    parser = argparse.ArgumentParser(description="FlamPpo recipe and cooking assistant.")
    parser.add_argument("--query", help="What you would like to cook")
    parser.add_argument("--image", help="Path to a fridge image to analyze")
    args = parser.parse_args()
    run_app(query=args.query, image_path=args.image)


if __name__ == "__main__":
    main()