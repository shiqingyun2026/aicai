const STORAGE_KEY = "acai-prototype-form";

function getActiveDirectionValues() {
  return Array.from(document.querySelectorAll(".pick-pill"))
    .filter((pill) => pill.classList.contains("is-active"))
    .map((pill) => pill.dataset.value);
}

function renderTags(container, values) {
  if (!container) {
    return;
  }

  const markup =
    values.length > 0
      ? values.map((value) => `<span class="tag">${value}</span>`).join("")
      : '<span class="tag">不限</span>';

  container.innerHTML = markup;
}

function readSelectedText(fieldName) {
  const field = document.querySelector(`[data-field="${fieldName}"]`);
  const selected = field?.querySelector(".segmented-option.is-selected");
  return selected?.textContent?.trim() || "";
}

function setupSegmentedFields() {
  document.querySelectorAll("[data-field] .segmented-option").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest(".segmented-group");
      group?.querySelectorAll(".segmented-option").forEach((option) => {
        option.classList.remove("is-selected");
      });
      button.classList.add("is-selected");
    });
  });
}

function setupDirectionPicker() {
  const pills = document.querySelectorAll(".pick-pill");
  const selectedDirections = document.getElementById("selected-directions");

  if (!pills.length) {
    return;
  }

  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pill.classList.toggle("is-active");
      renderTags(selectedDirections, getActiveDirectionValues());
    });
  });

  renderTags(selectedDirections, getActiveDirectionValues());
}

function saveFormState() {
  const payload = {
    budget: document.getElementById("budget")?.value?.trim() || "50000",
    targetReturn: document.getElementById("target-return")?.value?.trim() || "12",
    riskTolerance: readSelectedText("risk_tolerance") || "可接受最大回撤 10%",
    investmentCycle: readSelectedText("investment_cycle") || "一年",
    volatilityAcceptance: readSelectedText("volatility_acceptance") || "尽量不接受",
    stylePreference: readSelectedText("style_preference") || "红利",
    directions: getActiveDirectionValues(),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function readStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setupFormPage() {
  setupSegmentedFields();
  setupDirectionPicker();

  const goResultButton = document.getElementById("go-result");
  if (!goResultButton) {
    return;
  }

  goResultButton.addEventListener("click", () => {
    saveFormState();
    window.location.href = "./result.html";
  });
}

function populateResultPage() {
  const state = readStoredState();
  if (!state) {
    renderTags(document.getElementById("result-directions"), ["高股息", "家电", "出海制造"]);
    return;
  }

  const fieldMap = {
    "summary-budget": `${state.budget} 元`,
    "summary-target-return": `${state.targetReturn}%`,
    "summary-risk-tolerance": state.riskTolerance,
    "summary-investment-cycle": state.investmentCycle,
    "summary-volatility-acceptance": state.volatilityAcceptance,
    "summary-style-preference": state.stylePreference,
  };

  Object.entries(fieldMap).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  });

  renderTags(document.getElementById("result-directions"), state.directions || []);
}

function setupEvidenceToggles() {
  document.querySelectorAll(".evidence-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const content = toggle.nextElementSibling;
      const shouldOpen = toggle.getAttribute("aria-expanded") !== "true";

      toggle.setAttribute("aria-expanded", String(shouldOpen));
      content?.classList.toggle("is-open", shouldOpen);
    });
  });
}

const currentPage = document.body.dataset.page;

if (currentPage === "form") {
  setupFormPage();
}

if (currentPage === "result") {
  populateResultPage();
  setupEvidenceToggles();
}
