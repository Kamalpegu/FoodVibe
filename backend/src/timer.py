import re
import json
from pydantic import BaseModel, Field


class StepTimer(BaseModel):
    stepNumber: int
    has_timer: bool
    duration_seconds: int = Field(default=0, description="Total seconds for the countdown")
    label: str = Field(default="", description="Human-readable label like '3 mins' or '30 secs'")
    status: str = Field(default="idle", description="idle | running | paused | finished")


# Regex patterns for time expressions like "2-3 minutes", "30 seconds", "1.5 hrs"
TIME_PATTERN = re.compile(
    r"(?:(?P<min_val>\d+(?:\.\d+)?)\s*(?:-|to)\s*)?(?P<val>\d+(?:\.\d+)?)\s*"
    r"(?P<unit>hours?|hrs?|minutes?|mins?|seconds?|secs?)\b",
    re.IGNORECASE,
)


def _to_seconds(value: float, unit: str) -> int:
    unit_lower = unit.lower()
    if unit_lower.startswith("h"):
        return int(round(value * 3600))
    if unit_lower.startswith("m"):
        return int(round(value * 60))
    return int(round(value))


def extract_timers_from_steps(steps: list[dict]) -> list[dict]:
    """
    Scans recipe steps for any time mentions and returns structured timer objects.
    If a range is mentioned (e.g., '2-3 minutes'), uses the upper bound (3 minutes).
    """
    enriched_steps = []

    for step in steps:
        step_num = step.get("stepNumber")
        instruction = step.get("instruction", "")
        match = TIME_PATTERN.search(instruction)

        if match:
            # Use upper bound if a range like "2-3 minutes" is given
            val = float(match.group("val"))
            unit = match.group("unit")
            seconds = _to_seconds(val, unit)
            raw_phrase = match.group(0).strip()

            timer_obj = StepTimer(
                stepNumber=step_num,
                has_timer=True,
                duration_seconds=seconds,
                label=raw_phrase,
                status="idle",
            )
        else:
            timer_obj = StepTimer(
                stepNumber=step_num,
                has_timer=False,
                duration_seconds=0,
                label="",
                status="idle",
            )

        enriched_steps.append({
            **step,
            "timer": timer_obj.model_dump(),
        })

    return enriched_steps


# Standalone test
if __name__ == "__main__":
    sample_steps = [
        {"stepNumber": 1, "instruction": "Dice the bell pepper and onion."},
        {"stepNumber": 2, "instruction": "Sauté the diced vegetables for 2-3 minutes until softened."},
        {"stepNumber": 3, "instruction": "Sprinkle cheddar cheese and let it melt for 30 seconds."},
    ]
    print(json.dumps(extract_timers_from_steps(sample_steps), indent=2))