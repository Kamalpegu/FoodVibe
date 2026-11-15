import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "";

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

type RecipeChoice = {
  recipe: Recipe;
  progress: Progress;
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
    throw new Error("Could not reach FoodVibe. Make sure the backend is running.");
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
  const [chatImage, setChatImage] = useState<File | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [suggestions, setSuggestions] = useState<RecipeChoice[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [progressBusy, setProgressBusy] = useState(false);
  const [error, setError] = useState("");
  const [missingIngredient, setMissingIngredient] = useState("");
  const [preferredSwap, setPreferredSwap] = useState("");
  const [fridgeItems, setFridgeItems] = useState("");
  const [substitution, setSubstitution] = useState<SubstituteResult | null>(null);
  const [selectedSwap, setSelectedSwap] = useState("");
  const [activeTimer, setActiveTimer] = useState<{ stepNumber: number; endsAt: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [timerFinished, setTimerFinished] = useState(false);
  const cookingMapRef = useRef<HTMLElement>(null);

  const imagePreview = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);
  const chatImagePreview = useMemo(() => (chatImage ? URL.createObjectURL(chatImage) : ""), [chatImage]);

  useEffect(() => {
    if (!imagePreview) return;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  useEffect(() => {
    if (!chatImagePreview) return;
    return () => URL.revokeObjectURL(chatImagePreview);
  }, [chatImagePreview]);

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
        setTimerFinished(true);
        void updateStep(activeTimer.stepNumber, true);
      }
    }, 250);
    return () => window.clearInterval(timerId);
  }, [activeTimer, updateStep]);

  async function generateRecipe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() && !image) {
      setError("Tell me what you’re craving or add a photo of your fridge.");
      return;
    }

    setLoading(true);
    setError("");
    setSubstitution(null);
    setSuggestions([]);
    setRecipe(null);
    setProgress(null);
    setActiveTimer(null);
    setTimerFinished(false);
    setChatImage(image);
    setLastPrompt(query.trim() || "What can I make with what’s in my fridge?");
    const formData = new FormData();
    formData.append("query", query);
    if (image) formData.append("image", image);

    try {
      const result = await request<{ suggestions: RecipeChoice[] }>("/api/recipe-suggestions", {
        method: "POST",
        body: formData,
      });
      setSuggestions(result.suggestions);
      setQuery("");
      setImage(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Recipe generation failed.");
    } finally {
      setLoading(false);
    }
  }

  function selectRecipe(choice: RecipeChoice) {
    setRecipe(choice.recipe);
    setProgress(choice.progress);
    setMissingIngredient(choice.recipe.ingredients[0]?.name ?? "");
    setSubstitution(null);
    setPreferredSwap("");
    setFridgeItems("");
    setActiveTimer(null);
    setTimerFinished(false);
    window.setTimeout(
      () => cookingMapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
  }

  async function applySwap(ingredient: Ingredient, swap: string) {
    if (!recipe || swapping) return;
    setSwapping(true);
    setSelectedSwap(`${ingredient.id}:${swap}`);
    setSubstitution(null);
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
          missing_ingredient: ingredient.name,
          preferred_swap: swap,
          fridge_items: fridgeItems.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      setRecipe({ ...recipe, steps: result.steps });
      setProgress(result.progress);
      setSubstitution(result.substitution);
      setActiveTimer(null);
      setTimerFinished(false);
      setPreferredSwap(swap);
      setMissingIngredient(ingredient.name);
      window.setTimeout(
        () => cookingMapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        50,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not find ingredient swaps.");
    } finally {
      setSwapping(false);
      setSelectedSwap("");
    }
  }

  async function findSubstitutes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ingredient = recipe?.ingredients.find((item) => item.name === missingIngredient);
    if (!ingredient) return;
    await applySwap(ingredient, preferredSwap.trim() || ingredient.swaps[0] || "");
  }

  function startTimer(timer: TimerInfo) {
    setTimerFinished(false);
    setSecondsLeft(timer.duration_seconds);
    setActiveTimer({
      stepNumber: timer.stepNumber,
      endsAt: Date.now() + timer.duration_seconds * 1000,
    });
  }

  function resetChat() {
    setRecipe(null);
    setSuggestions([]);
    setProgress(null);
    setLastPrompt("");
    setChatImage(null);
    setSubstitution(null);
    setActiveTimer(null);
    setTimerFinished(false);
    setError("");
  }

  const currentTimer = activeTimer && recipe
    ? recipe.steps.find((step) => step.stepNumber === activeTimer.stepNumber)?.timer
    : null;
  const firstName = recipe?.recipe_title.split(" ")[0] ?? "your meal";

  return (
    <div className={`app-shell chat-app${activeTimer ? " timer-active" : ""}`}>
      <header className="topbar chat-topbar">
        <a className="brand" href="#" aria-label="FoodVibe home">
          <span className="brand-mark">f.</span>
          <span>FoodVibe</span>
        </a>
        <div className="chat-status"><span className="status-dot" /> YOUR KITCHEN COMPANION</div>
        {recipe ? (
          <button className="new-chat-button" type="button" onClick={resetChat}>New chat <span>＋</span></button>
        ) : (
          <span className="chat-top-note">GOOD FOOD, GOOD MOOD</span>
        )}
      </header>

      <main className="chat-main">
        <div className="chat-thread">
          {!recipe || !progress ? suggestions.length === 0 ? (
            <section className="welcome-message">
              <div className="assistant-avatar">f.</div>
              <div className="welcome-content">
                <span className="message-author">FOODVIBE <span>· HERE TO HELP</span></span>
                <h1>Hey there! What are<br className="desktop-break" /> we cooking <em>today?</em></h1>
                <p>Tell me what you’re craving, what you have on hand, or show me your fridge. We’ll figure out something delicious together.</p>
                <div className="suggestion-label">A FEW IDEAS TO GET US STARTED</div>
                <div className="suggestions">
                  {["A quick dinner with veggies", "Something high-protein", "Use what’s in my fridge"].map((suggestion) => (
                    <button
                      type="button"
                      className="suggestion-chip"
                      key={suggestion}
                      onClick={() => setQuery(suggestion)}
                    >
                      <span>↗</span> {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <>
              <div className="chat-date"><span /> YOUR COOKING SESSION <span /></div>
              <section className="user-message" aria-label="Your request">
                <div className="user-bubble">{lastPrompt}</div>
                {chatImagePreview && <img className="chat-image" src={chatImagePreview} alt="Your fridge" />}
                <div className="user-avatar">YOU</div>
              </section>

              <section className="assistant-message" aria-live="polite">
                <div className="assistant-avatar">f.</div>
                <div className="assistant-content">
                  <span className="message-author">FOODVIBE <span>· A FEW IDEAS FOR YOU</span></span>
                  <p className="assistant-intro">I found a few ideas for you. Pick the one you’re in the mood for, and I’ll lay out the ingredients and cooking steps.</p>
                  <div className="suggestion-cards">
                    {suggestions.map((choice, index) => (
                      <article className="suggestion-recipe-card" key={`${choice.recipe.recipe_title}-${index}`}>
                        <div className="suggestion-card-top">
                          <span className="small-label">RECIPE IDEA {String(index + 1).padStart(2, "0")}</span>
                          <span className="suggestion-card-spark">✳</span>
                        </div>
                        <h2>{choice.recipe.recipe_title}</h2>
                        <p>A tasty way to make the most of what you have.</p>
                        <div className="recipe-facts">
                          <span><b>◷</b> {choice.recipe.prep_time_mins} min</span>
                          <span><b>♧</b> {choice.recipe.base_servings} servings</span>
                        </div>
                        {choice.recipe.detected_items.length > 0 && (
                          <div className="suggestion-uses">
                            <span className="small-label">MAKES USE OF</span>
                            <div className="ingredient-chips">
                              {choice.recipe.detected_items.slice(0, 5).map((item) => <span className="ingredient-chip" key={item}>{item}</span>)}
                            </div>
                          </div>
                        )}
                        <button className="choose-recipe-button" type="button" onClick={() => selectRecipe(choice)}>
                          Cook this recipe <span>→</span>
                        </button>
                      </article>
                    ))}
                  </div>
                  <span className="message-time">Choose a recipe to see everything you’ll need.</span>
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="chat-date"><span /> YOUR COOKING SESSION <span /></div>
              <section className="user-message" aria-label="Your request">
                <div className="user-bubble">{lastPrompt}</div>
                {chatImagePreview && <img className="chat-image" src={chatImagePreview} alt="Your fridge" />}
                <div className="user-avatar">YOU</div>
              </section>

              <section className="assistant-message" aria-live="polite">
                <div className="assistant-avatar">f.</div>
                <div className="assistant-content">
                  <span className="message-author">FOODVIBE <span>· RECIPE FOUND</span></span>
                  <p className="assistant-intro">Oh, this is going to be good. Here’s something lovely you can make:</p>

                  <article className="recipe-flashcard">
                    <div className="flashcard-overline"><span>YOUR RECIPE CARD</span><span className="flashcard-spark">✳</span></div>
                    <h2>{recipe.recipe_title}</h2>
                    <p className="recipe-description">A fresh-from-your-kitchen idea, made around the things you love.</p>
                    <div className="recipe-facts">
                      <span><b>◷</b> {recipe.prep_time_mins} min</span>
                      <span><b>♧</b> {recipe.base_servings} servings</span>
                      <span><b>✳</b> {recipe.ingredients.length} ingredients</span>
                    </div>
                    {recipe.detected_items.length > 0 && (
                      <div className="fridge-found">
                        <span className="small-label">I SPOTTED IN YOUR FRIDGE</span>
                        <div className="ingredient-chips">
                          {recipe.detected_items.map((item) => <span className="ingredient-chip" key={item}>{item}</span>)}
                        </div>
                      </div>
                    )}
                    <details className="ingredients-details" open>
                      <summary>Ingredients & quick swaps <span>{recipe.ingredients.length} ingredients</span></summary>
                      <p className="swap-instruction">Choose a suggested swap to regenerate the cooking steps.</p>
                      <ul className="chat-ingredient-list">
                        {recipe.ingredients.map((ingredient) => (
                          <li key={ingredient.id}>
                            <div className="ingredient-row-main">
                              <span className="ingredient-name">{ingredient.name}</span>
                              <span className="ingredient-amount">{ingredient.quantity} {ingredient.unit}</span>
                            </div>
                            {ingredient.swaps.length > 0 && (
                              <div className="ingredient-swap-options">
                                <span className="swap-prompt">Swap for</span>
                                {ingredient.swaps.map((swap) => {
                                  const swapKey = `${ingredient.id}:${swap}`;
                                  const isSelectedSwap = selectedSwap === swapKey;
                                  return (
                                    <button
                                      type="button"
                                      className={`ingredient-swap-chip${isSelectedSwap ? " selected" : ""}`}
                                      key={swap}
                                      disabled={swapping}
                                      onClick={() => void applySwap(ingredient, swap)}
                                      aria-label={`Replace ${ingredient.name} with ${swap}`}
                                    >
                                      {isSelectedSwap ? <><span className="spinner dark" /> Updating…</> : swap}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </article>

                  <details className="swap-details">
                    <summary>Missing an ingredient? Find an easy swap <span>＋</span></summary>
                    <form className="swap-form chat-swap-form" onSubmit={findSubstitutes}>
                      <label className="field-label" htmlFor="missing-ingredient">WHICH INGREDIENT IS MISSING?</label>
                      <select id="missing-ingredient" value={missingIngredient} onChange={(event) => setMissingIngredient(event.target.value)}>
                        {recipe.ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.name}>{ingredient.name}</option>)}
                      </select>
                      <label className="field-label" htmlFor="preferred-swap">WHAT DO YOU HAVE INSTEAD? <span>(OPTIONAL)</span></label>
                      <input id="preferred-swap" value={preferredSwap} onChange={(event) => setPreferredSwap(event.target.value)} placeholder="e.g. plain yogurt" />
                      <label className="field-label" htmlFor="fridge-inventory">OTHER THINGS IN YOUR FRIDGE <span>(OPTIONAL)</span></label>
                      <input id="fridge-inventory" value={fridgeItems} onChange={(event) => setFridgeItems(event.target.value)} placeholder="Comma-separated ingredients" />
                      <button className="swap-submit" type="submit" disabled={swapping || !missingIngredient}>
                        {swapping ? <><span className="spinner dark" /> Looking for a swap…</> : <>Find a good swap <span>↗</span></>}
                      </button>
                    </form>
                  </details>

                  {substitution && (
                    <div className="swap-chat-card">
                      <span className="small-label">EASY SWAP FOR {substitution.missing_ingredient.toUpperCase()}</span>
                      <strong>{substitution.recommended_swap.quantity} {substitution.recommended_swap.unit} {substitution.recommended_swap.name}</strong>
                      <p>{substitution.recommended_swap.prep_adjustment}</p>
                      {substitution.alternatives.length > 0 && <small>Other options: {substitution.alternatives.map((item) => item.name).join(", ")}</small>}
                      <span className="swap-updated">I’ve updated the cooking steps with this swap.</span>
                    </div>
                  )}

                  <div className="assistant-followup">
                    <span className="assistant-followup-icon">✳</span>
                    Ready when you are. I’ve mapped out every step below — we’ll take it one card at a time.
                  </div>

                  <section className="cooking-map" aria-label="Recipe cooking steps" ref={cookingMapRef}>
                    <div className="map-header">
                      <div>
                        <span className="small-label">YOUR COOKING ROUTE</span>
                        <h3>One step at a time.</h3>
                      </div>
                      <div className="map-progress" aria-label={`${progress.progress_percent}% complete`}>
                        <strong>{Math.round(progress.progress_percent)}%</strong>
                        <span>{progress.completed_count}/{progress.total_steps} done</span>
                      </div>
                    </div>
                    <div className="map-track">
                      {recipe.steps.map((step, index) => {
                        const tracked = progress.steps.find((item) => item.stepNumber === step.stepNumber);
                        const completed = Boolean(tracked?.completed);
                        const stepTimer = step.timer?.has_timer && step.timer.duration_seconds > 0
                          ? { stepNumber: step.stepNumber, duration_seconds: step.timer.duration_seconds, label: step.timer.label }
                          : null;
                        const isTiming = activeTimer?.stepNumber === step.stepNumber;
                        const isNext = progress.next_step_number === step.stepNumber;
                        const disabled = Boolean(activeTimer && !isTiming);
                        return (
                          <article
                            className={`map-stop${completed ? " completed" : ""}${isTiming ? " timing" : ""}${isNext ? " next-stop" : ""}`}
                            key={step.stepNumber}
                          >
                            <div className="route-node-wrap">
                              <span className="route-node">{completed ? "✓" : String(index + 1).padStart(2, "0")}</span>
                            </div>
                            <div className="step-flashcard">
                              <div className="step-card-top">
                                <span className="small-label">STEP {String(index + 1).padStart(2, "0")}</span>
                                {completed ? <span className="step-state done-state">DONE ✓</span> : isTiming ? <span className="step-state timer-state">TIMER ON</span> : isNext ? <span className="step-state next-state">UP NEXT</span> : <span className="step-state">COMING UP</span>}
                              </div>
                              <p className="step-instruction">{step.instruction}</p>
                              {stepTimer && (
                                <div className="step-timer-tag"><span>◷</span> Timer · {stepTimer.label}</div>
                              )}
                              <div className="step-card-actions">
                                {completed ? (
                                  <button className="step-action-button undo-action" disabled={progressBusy} onClick={() => void updateStep(step.stepNumber, false)}>Undo step</button>
                                ) : stepTimer ? (
                                  <button
                                    className={`step-action-button start-timer-action${isTiming ? " timer-running-action" : ""}`}
                                    disabled={disabled || isTiming || progressBusy}
                                    onClick={() => startTimer(stepTimer)}
                                  >
                                    {isTiming ? <>{formatTime(secondsLeft)} remaining <span className="mini-spinner" /></> : <>Start {stepTimer.label} timer <span>▶</span></>}
                                  </button>
                                ) : (
                                  <button className="step-action-button done-action" disabled={disabled || progressBusy} onClick={() => void updateStep(step.stepNumber, true)}>
                                    I’ve done this <span>→</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                      {progress.is_recipe_finished && (
                        <div className="route-finish"><span>✳</span><div><strong>You made it!</strong><small>Enjoy every bite of {firstName}.</small></div></div>
                      )}
                    </div>
                    <p className="map-note"><span>✳</span> Timed steps count down right here. I’ll let you know when it’s time to move on.</p>
                  </section>
                  {timerFinished && !activeTimer && (
                    <div className="timer-complete-message" role="status">⏰ Timer’s up — that step is done. Let’s keep going!</div>
                  )}
                  <span className="message-time">A little more joy in the everyday meal.</span>
                </div>
              </section>
            </>
          )}
          {error && <div className="error-banner" role="alert"><span>!</span>{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
          {loading && (
            <div className="thinking-row" role="status">
              <div className="assistant-avatar">f.</div>
              <div className="thinking-bubble"><span className="typing-dots"><i /><i /><i /></span> Thinking up something delicious…</div>
            </div>
          )}
        </div>
      </main>

      <footer className="chat-composer-wrap">
        {imagePreview && !recipe && (
          <div className="composer-attachment">
            <img src={imagePreview} alt="Selected fridge preview" />
            <span>{image?.name}</span>
            <button type="button" onClick={() => setImage(null)} aria-label="Remove photo">×</button>
          </div>
        )}
        <form className="chat-composer" onSubmit={generateRecipe}>
          <label className="attach-button" htmlFor="fridge-image" aria-label="Attach a fridge photo">＋</label>
          <input
            id="fridge-image"
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setImage(event.target.files?.[0] ?? null)}
          />
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={recipe ? "Ask for another idea or a cooking tip…" : "Tell me what you’re craving…"}
            rows={1}
            aria-label="Message FoodVibe"
            disabled={loading}
          />
          <button className="send-button" type="submit" disabled={loading || (!query.trim() && !image)} aria-label="Send message">
            {loading ? <span className="spinner" /> : <span>↑</span>}
          </button>
        </form>
        <p className="composer-footnote">FoodVibe can make mistakes. Good cooking starts with common sense.</p>
      </footer>

      {activeTimer && currentTimer && (
        <div className="active-timer" role="status">
          <div className="timer-pulse">◷</div>
          <div className="timer-copy">
            <span className="small-label">STEP {activeTimer.stepNumber} · TIMER RUNNING</span>
            <strong>{currentTimer.label}</strong>
          </div>
          <span className="timer-readout">{formatTime(secondsLeft)}</span>
          <button className="timer-cancel" onClick={() => setActiveTimer(null)} aria-label="Cancel timer">×</button>
        </div>
      )}
    </div>
  );
}

export default App;
