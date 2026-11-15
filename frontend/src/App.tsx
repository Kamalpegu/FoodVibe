import { useCallback, useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

type Ingredient = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  swaps: string[];
};

type RecipeStep = {
  stepNumber: number;
  instruction: string;
  timer: {
    stepNumber: number;
    has_timer: boolean;
    duration_seconds: number;
    label: string;
    status: string;
  };
};

type Recipe = {
  detected_items: string[];
  recipe_title: string;
  prep_time_mins: number;
  base_servings: number;
  ingredients: Ingredient[];
  steps: RecipeStep[];
};

type TrackedStep = {
  stepNumber: number;
  instruction: string;
  completed: boolean;
};

type Progress = {
  total_steps: number;
  completed_count: number;
  progress_percent: number;
  is_recipe_finished: boolean;
  next_step_number: number | null;
  steps: TrackedStep[];
};

type TimerInfo = {
  stepNumber: number;
  duration_seconds: number;
  label: string;
};

type SubstituteResult = {
  missing_ingredient: string;
  alternatives: {
    name: string;
    quantity: number;
    unit: string;
    prep_adjustment: string;
  }[];
  recommended_swap: {
    name: string;
    quantity: number;
    unit: string;
    prep_adjustment: string;
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new Error("Could not reach FlamPpo. Make sure the backend is running.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function App() {
  const [query, setQuery] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [progressBusy, setProgressBusy] = useState(false);
  const [error, setError] = useState("");
  const [missingIngredient, setMissingIngredient] = useState("");
  const [preferredSwap, setPreferredSwap] = useState("");
  const [fridgeItems, setFridgeItems] = useState("");
  const [substitution, setSubstitution] = useState<SubstituteResult | null>(null);
  const [activeTimer, setActiveTimer] = useState<{ stepNumber: number; endsAt: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const imagePreview = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);

  useEffect(() => {
    if (!imagePreview) return;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  const updateStep = useCallback(
    async (stepNumber: number, completed: boolean) => {
      if (!progress) return;
      setProgressBusy(true);
      try {
        const updated = await request<Progress>("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            steps: progress.steps,
            step_number: stepNumber,
            completed,
          }),
        });
        setProgress(updated);
        setError("");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Could not update cooking progress.");
      } finally {
        setProgressBusy(false);
      }
    },
    [progress],
  );

  useEffect(() => {
    if (!activeTimer) return;
    const timerId = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((activeTimer.endsAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        window.clearInterval(timerId);
        setActiveTimer(null);
        void updateStep(activeTimer.stepNumber, true);
      }
    }, 250);
    return () => window.clearInterval(timerId);
  }, [activeTimer, updateStep]);

  async function generateRecipe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() && !image) {
      setError("Enter a dish or choose a fridge photo to get started.");
      return;
    }

    setLoading(true);
    setError("");
    setSubstitution(null);
    setProgress(null);
    setActiveTimer(null);
    const formData = new FormData();
    formData.append("query", query);
    if (image) formData.append("image", image);

    try {
      const result = await request<{ recipe: Recipe; progress: Progress }>("/api/recipes", {
        method: "POST",
        body: formData,
      });
      setRecipe(result.recipe);
      setProgress(result.progress);
      setMissingIngredient(result.recipe.ingredients[0]?.name ?? "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Recipe generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function findSubstitutes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipe || !missingIngredient) return;
    setSwapping(true);
    setError("");
    try {
      const result = await request<{
        substitution: SubstituteResult;
        steps: RecipeStep[];
        progress: Progress;
      }>("/api/substitutions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe,
          missing_ingredient: missingIngredient,
          preferred_swap: preferredSwap,
          fridge_items: fridgeItems.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      setRecipe({ ...recipe, steps: result.steps });
      setProgress(result.progress);
      setSubstitution(result.substitution);
      setActiveTimer(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not find ingredient swaps.");
    } finally {
      setSwapping(false);
    }
  }

  function startTimer(timer: TimerInfo) {
    setSecondsLeft(timer.duration_seconds);
    setActiveTimer({
      stepNumber: timer.stepNumber,
      endsAt: Date.now() + timer.duration_seconds * 1000,
    });
  }

  const currentTimer = activeTimer && recipe
    ? recipe.steps.find((step) => step.stepNumber === activeTimer.stepNumber)?.timer
    : null;
  const circumference = 2 * Math.PI * 50;
  const firstName = recipe?.recipe_title.split(" ")[0] ?? "your meal";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="FlamPpo home">
          <span className="brand-mark">f.</span>
          <span>flampppo</span>
        </a>
        <div className="topbar-note"><span className="status-dot" /> YOUR KITCHEN, IN GOOD HANDS</div>
        <a className="topbar-link" href="#how-it-works">How it works <span aria-hidden="true">↗</span></a>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><span /> A LITTLE HELP IN THE KITCHEN</p>
            <h1>Make something<br /><em>good today.</em></h1>
            <p className="hero-description">
              Tell us what you’re craving or show us what’s in your fridge.
              We’ll help with the recipe, the swaps, and every step in between.
            </p>
            <div className="hero-footnote"><span className="sparkle">✳</span> Less wondering. More delicious.</div>
          </div>

          <form className="recipe-form panel" onSubmit={generateRecipe}>
            <div className="form-heading">
              <span className="form-icon">01</span>
              <div>
                <h2>Let’s find your next meal</h2>
                <p>A craving, an ingredient, or a fridge photo.</p>
              </div>
            </div>
            <label className="field-label" htmlFor="food-query">WHAT SOUNDS GOOD?</label>
            <textarea
              id="food-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Something quick with eggs and greens…"
              rows={3}
            />
            <div className="upload-row">
              <label className={`upload-box${image ? " has-image" : ""}`} htmlFor="fridge-image">
                {imagePreview ? (
                  <img className="image-preview" src={imagePreview} alt="Selected fridge" />
                ) : (
                  <span className="upload-glyph" aria-hidden="true">＋</span>
                )}
                <span className="upload-text">
                  <strong>{image ? image.name : "Add a fridge photo"}</strong>
                  <small>{image ? "Click to choose another" : "JPG, PNG or WEBP"}</small>
                </span>
                <input
                  id="fridge-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setImage(event.target.files?.[0] ?? null)}
                />
              </label>
              {image && (
                <button className="remove-image" type="button" onClick={() => setImage(null)} aria-label="Remove photo">×</button>
              )}
            </div>
            <button className="primary-button generate-button" type="submit" disabled={loading}>
              {loading ? <><span className="spinner" /> Finding something delicious…</> : <>Find my recipe <span aria-hidden="true">↗</span></>}
            </button>
            <p className="form-caption">Powered by a little kitchen know-how and AI.</p>
          </form>
          <div className="hero-sticker" aria-hidden="true"><span>GOOD<br />FOOD<br /><i>starts here</i></span><b>✳</b></div>
        </section>

        {error && <div className="error-banner" role="alert"><span>!</span>{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

        {recipe && progress ? (
          <section className="results-section" aria-live="polite">
            <div className="section-heading">
              <div>
                <p className="eyebrow"><span /> YOUR RECIPE</p>
                <h2>A good thing is <em>cooking.</em></h2>
              </div>
              <button className="text-button" onClick={() => { setRecipe(null); setProgress(null); setSubstitution(null); setActiveTimer(null); }}>
                Start over <span aria-hidden="true">↗</span>
              </button>
            </div>

            <div className="recipe-grid">
              <article className="panel recipe-card">
                <div className="recipe-card-top">
                  <span className="recipe-kicker">MADE FOR YOUR KITCHEN</span>
                  <span className="recipe-stamp">FRESH<br />IDEA <b>✳</b></span>
                </div>
                <h3>{recipe.recipe_title}</h3>
                <div className="recipe-meta">
                  <span><b>◷</b> {recipe.prep_time_mins} min</span>
                  <span><b>♧</b> {recipe.base_servings} servings</span>
                </div>
                {recipe.detected_items.length > 0 && (
                  <div className="detected">
                    <p className="field-label">SPOTTED IN YOUR FRIDGE</p>
                    <div className="chips">{recipe.detected_items.map((item) => <span className="chip" key={item}>{item}</span>)}</div>
                  </div>
                )}
                <div className="ingredients-block">
                  <div className="subheading-row"><h4>What you’ll need</h4><span>{recipe.ingredients.length} ingredients</span></div>
                  <ul className="ingredient-list">
                    {recipe.ingredients.map((ingredient) => (
                      <li key={ingredient.id}>
                        <span className="ingredient-bullet" />
                        <span className="ingredient-name">{ingredient.name}<small>{ingredient.swaps.slice(0, 2).join(" · ")}</small></span>
                        <span className="ingredient-amount">{ingredient.quantity} {ingredient.unit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="swap-block">
                  <div className="subheading-row"><h4>Missing something?</h4><span>Easy does it</span></div>
                  <form className="swap-form" onSubmit={findSubstitutes}>
                    <label className="field-label" htmlFor="missing-ingredient">INGREDIENT TO SWAP</label>
                    <select id="missing-ingredient" value={missingIngredient} onChange={(event) => setMissingIngredient(event.target.value)}>
                      {recipe.ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.name}>{ingredient.name}</option>)}
                    </select>
                    <label className="field-label" htmlFor="preferred-swap">PREFERRED SUBSTITUTE <span>(OPTIONAL)</span></label>
                    <input id="preferred-swap" value={preferredSwap} onChange={(event) => setPreferredSwap(event.target.value)} placeholder="e.g. plain yogurt" />
                    <label className="field-label" htmlFor="fridge-inventory">OTHER THINGS YOU HAVE <span>(OPTIONAL)</span></label>
                    <input id="fridge-inventory" value={fridgeItems} onChange={(event) => setFridgeItems(event.target.value)} placeholder="Comma-separated ingredients" />
                    <button className="secondary-button" type="submit" disabled={swapping || !missingIngredient}>
                      {swapping ? <><span className="spinner dark" /> Finding swaps…</> : <>Find a good swap <span aria-hidden="true">↗</span></>}
                    </button>
                  </form>
                </div>
                {substitution && (
                  <div className="swap-result">
                    <p className="field-label">OUR PICK FOR {substitution.missing_ingredient.toUpperCase()}</p>
                    <strong>{substitution.recommended_swap.quantity} {substitution.recommended_swap.unit} {substitution.recommended_swap.name}</strong>
                    <p>{substitution.recommended_swap.prep_adjustment}</p>
                    {substitution.alternatives.length > 0 && <small>Also works: {substitution.alternatives.map((item) => item.name).join(", ")}</small>}
                    <p className="swap-note">Cooking steps have been updated with this recommended swap.</p>
                  </div>
                )}
              </article>

              <article className="panel steps-card">
                <div className="steps-heading">
                  <div><p className="recipe-kicker">ONE STEP AT A TIME</p><h3>Let’s get cooking.</h3></div>
                  <div className="progress-ring" aria-label={`${progress.progress_percent}% complete`}>
                    <svg viewBox="0 0 120 120" aria-hidden="true">
                      <circle className="ring-track" cx="60" cy="60" r="50" />
                      <circle className="ring-value" cx="60" cy="60" r="50" style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress.progress_percent / 100) }} />
                    </svg>
                    <span>{Math.round(progress.progress_percent)}<small>%</small></span>
                  </div>
                </div>
                <div className="progress-caption">{progress.completed_count} of {progress.total_steps} steps done</div>

                {activeTimer && currentTimer && (
                  <div className="active-timer" role="status">
                    <div className="timer-pulse">◷</div>
                    <div className="timer-copy">
                      <span className="field-label">TIMER RUNNING · STEP {activeTimer.stepNumber}</span>
                      <strong>{currentTimer.label}</strong>
                    </div>
                    <span className="timer-readout">{formatTime(secondsLeft)}</span>
                    <button className="timer-cancel" onClick={() => setActiveTimer(null)} aria-label="Cancel timer">×</button>
                  </div>
                )}

                {progress.is_recipe_finished && (
                  <div className="finished-banner"><span>✳</span><div><strong>Beautifully done.</strong><small>Enjoy every bite of {firstName}.</small></div></div>
                )}

                <ol className="step-list">
                  {recipe.steps.map((step, index) => {
                    const tracked = progress.steps.find((item) => item.stepNumber === step.stepNumber);
                    const completed = Boolean(tracked?.completed);
                    const stepTimer = step.timer?.has_timer && step.timer.duration_seconds > 0
                      ? { stepNumber: step.stepNumber, duration_seconds: step.timer.duration_seconds, label: step.timer.label }
                      : null;
                    const isTiming = activeTimer?.stepNumber === step.stepNumber;
                    const disabled = Boolean(activeTimer && !isTiming);
                    return (
                      <li className={`step-item${completed ? " completed" : ""}${isTiming ? " timing" : ""}`} key={step.stepNumber}>
                        <span className="step-number">{completed ? "✓" : String(index + 1).padStart(2, "0")}</span>
                        <div className="step-content">
                          <p>{step.instruction}</p>
                          {stepTimer && <span className="step-time">◷ &nbsp;{stepTimer.label}</span>}
                        </div>
                        <div className="step-action">
                          {completed ? (
                            <button className="step-button done-button" disabled={progressBusy} onClick={() => void updateStep(step.stepNumber, false)}>Undo</button>
                          ) : stepTimer ? (
                            <button
                              className={`step-button${isTiming ? " running-button" : " timer-button"}`}
                              disabled={disabled || isTiming || progressBusy}
                              onClick={() => startTimer(stepTimer)}
                            >
                              {isTiming ? <>{formatTime(secondsLeft)} <span className="mini-spinner" /></> : <>Start timer <span>↗</span></>}
                            </button>
                          ) : (
                            <button className="step-button complete-button" disabled={disabled || progressBusy} onClick={() => void updateStep(step.stepNumber, true)}>
                              Mark done <span>→</span>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <div className="steps-footnote"><span>✳</span> Timed steps will count down right here. We’ll let you know when it’s time to move on.</div>
                <span className="steps-sunburst" aria-hidden="true">✳</span>
              </article>
            </div>
          </section>
        ) : (
          <section className="how-section" id="how-it-works">
            <div className="how-title"><p className="eyebrow"><span /> HERE’S THE PLAN</p><h2>From “what’s for dinner?”<br />to <em>“that was lovely.”</em></h2></div>
            <div className="how-steps">
              <article><span className="how-number">01</span><div className="how-symbol">⌕</div><h3>Tell us what you have</h3><p>Share a craving, an ingredient, or a quick snapshot of your fridge.</p></article>
              <article><span className="how-number">02</span><div className="how-symbol">✳</div><h3>Get a recipe that fits</h3><p>We’ll turn what you have into a practical meal, with easy swaps if you need them.</p></article>
              <article><span className="how-number">03</span><div className="how-symbol">◷</div><h3>Cook at your own pace</h3><p>Follow each step, use the built-in timers, and enjoy the little victories.</p></article>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <a className="brand footer-brand" href="#"><span className="brand-mark">f.</span><span>flampppo</span></a>
        <span>A little more joy in the everyday meal.</span>
        <span className="footer-year">MADE FOR THE LOVE OF FOOD <b>✳</b></span>
      </footer>
    </div>
  );
}

export default App;
