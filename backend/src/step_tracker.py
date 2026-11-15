import json
from pydantic import BaseModel


class TrackedStep(BaseModel):
    stepNumber: int
    instruction: str
    completed: bool = False


class RecipeProgress(BaseModel):
    total_steps: int
    completed_count: int
    progress_percent: float
    is_recipe_finished: bool
    next_step_number: int | None
    steps: list[TrackedStep]


def initialize_step_tracker(steps: list[dict]) -> dict:
    """
    Initializes a recipe's steps with 'completed': False and progress metadata.
    """
    tracked = [
        TrackedStep(
            stepNumber=step["stepNumber"],
            instruction=step["instruction"],
            completed=bool(step.get("completed", False)),
        )
        for step in steps
    ]
    return _build_progress(tracked).model_dump()


def mark_step_status(steps: list[dict], step_number: int, completed: bool = True) -> dict:
    """
    Marks a specific stepNumber as completed (True) or uncompleted (False),
    returning updated steps and overall completion metrics.
    """
    found = False
    updated_list: list[TrackedStep] = []

    for step in steps:
        is_done = bool(step.get("completed", False))
        if step["stepNumber"] == step_number:
            is_done = completed
            found = True

        updated_list.append(
            TrackedStep(
                stepNumber=step["stepNumber"],
                instruction=step["instruction"],
                completed=is_done,
            )
        )

    if not found:
        raise ValueError(f"Step number {step_number} not found in recipe steps.")

    return _build_progress(updated_list).model_dump()


def _build_progress(tracked_steps: list[TrackedStep]) -> RecipeProgress:
    total = len(tracked_steps)
    completed_count = sum(1 for s in tracked_steps if s.completed)
    percent = round((completed_count / total) * 100, 1) if total > 0 else 0.0

    # Find the first incomplete step
    next_step = next((s.stepNumber for s in tracked_steps if not s.completed), None)

    return RecipeProgress(
        total_steps=total,
        completed_count=completed_count,
        progress_percent=percent,
        is_recipe_finished=(total > 0 and completed_count == total),
        next_step_number=next_step,
        steps=tracked_steps,
    )


# Standalone test
if __name__ == "__main__":
    sample_steps = [
        {"stepNumber": 1, "instruction": "Dice the bell pepper and onion."},
        {"stepNumber": 2, "instruction": "Whisk eggs with milk, salt, and pepper."},
        {"stepNumber": 3, "instruction": "Cook in pan until set."},
    ]

    state = initialize_step_tracker(sample_steps)
    state = mark_step_status(state["steps"], step_number=1, completed=True)
    print(json.dumps(state, indent=2))
    