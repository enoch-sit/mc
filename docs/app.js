const config = window.MC_CUE_APP_CONFIG || {};
const gate = document.getElementById("gate");
const appShell = document.getElementById("appShell");
const passcodeInput = document.getElementById("passcodeInput");
const unlockButton = document.getElementById("unlockButton");
const gateError = document.getElementById("gateError");
const appTitle = document.getElementById("appTitle");
const appSubtitle = document.getElementById("appSubtitle");
const printButton = document.getElementById("printButton");
const collapseButton = document.getElementById("collapseButton");
const providerButtons = document.getElementById("providerButtons");
const phaseIndex = document.getElementById("phaseIndex");
const phaseList = document.getElementById("phaseList");
const statusText = document.getElementById("statusText");
const timerClock = document.getElementById("timerClock");
const timerCurrent = document.getElementById("timerCurrent");
const timerNext = document.getElementById("timerNext");

const assetPaths = {
  data: config.assetPaths?.data || "./data/mc_cue_index.json",
  localAudio: config.assetPaths?.localAudio || "../mc_practice_audio",
  openrouterAudio: config.assetPaths?.openrouterAudio || "../teacher_tts_audio/openrouter",
  grokAudio: config.assetPaths?.grokAudio || "../teacher_tts_audio/grok",
};

const providers = {
  local: {
    label: "Local",
    getSrc(id) {
      return `${assetPaths.localAudio}/${id}.wav`;
    },
  },
  openrouter: {
    label: "OpenRouter",
    getSrc(id) {
      return `${assetPaths.openrouterAudio}/${id}.mp3`;
    },
  },
  grok: {
    label: "Grok",
    getSrc(id) {
      return `${assetPaths.grokAudio}/${id}.mp3`;
    },
  },
};

let cueIndex = null;
let activeProvider = "grok";
let currentAudio = null;
let collapseAll = false;
let activeFilter = "all";
let timerHandle = 0;

function setStatus(message) {
  statusText.textContent = message;
}

function parseClockTime(value) {
  if (!value) {
    return null;
  }
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutes(minutes) {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${remainder}m`;
  }
  return `${remainder}m`;
}

function getHongKongNowParts() {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: cueIndex?.schedule?.timezone || "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    ...parts,
    totalMinutes: Number(parts.hour) * 60 + Number(parts.minute),
    clockLabel: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function getScheduledPhases() {
  return cueIndex.phases
    .filter((phase) => phase.schedule?.active)
    .map((phase) => ({
      ...phase,
      startMinutes: parseClockTime(phase.schedule.startTime),
      endMinutes: parseClockTime(phase.schedule.endTime),
    }))
    .filter((phase) => phase.startMinutes !== null)
    .sort((left, right) => left.startMinutes - right.startMinutes);
}

function updateScheduleIndicator() {
  if (!cueIndex) {
    return;
  }

  const now = getHongKongNowParts();
  const scheduledPhases = getScheduledPhases();
  const activePhase = scheduledPhases.find((phase) => {
    if (phase.endMinutes === null) {
      return now.totalMinutes >= phase.startMinutes;
    }
    return now.totalMinutes >= phase.startMinutes && now.totalMinutes < phase.endMinutes;
  });
  const nextPhase = scheduledPhases.find((phase) => phase.startMinutes > now.totalMinutes) || null;

  timerClock.textContent = `${now.clockLabel} HKT`;

  if (activePhase) {
    const remaining = activePhase.endMinutes === null ? null : activePhase.endMinutes - now.totalMinutes;
    timerCurrent.textContent = `Now: ${activePhase.title}`;
    timerNext.textContent = remaining === null
      ? `${activePhase.timeLabel} • Ongoing now.`
      : `${activePhase.timeLabel} • About ${formatMinutes(remaining)} left in this big event.`;
    return;
  }

  const firstPhase = scheduledPhases[0] || null;
  if (nextPhase) {
    timerCurrent.textContent = "Now: Between scheduled big events";
    timerNext.textContent = `Next: ${nextPhase.title} in about ${formatMinutes(nextPhase.startMinutes - now.totalMinutes)}.`;
    return;
  }

  if (firstPhase && now.totalMinutes < firstPhase.startMinutes) {
    timerCurrent.textContent = "Now: Before the symposium day schedule starts";
    timerNext.textContent = `Next: ${firstPhase.title} in about ${formatMinutes(firstPhase.startMinutes - now.totalMinutes)}.`;
    return;
  }

  timerCurrent.textContent = "Now: After the scheduled symposium blocks";
  timerNext.textContent = cueIndex.schedule?.note || "Use the cards below as a rehearsal reference.";
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  currentAudio = null;
}

async function playAudio(id, description) {
  stopAudio();
  const provider = providers[activeProvider];
  const audio = new Audio(provider.getSrc(id));
  currentAudio = audio;
  setStatus(`Playing ${provider.label}: ${description}`);

  try {
    await audio.play();
  } catch (error) {
    setStatus(`Could not play ${id}. Check that the ${provider.label} audio file exists.`);
    throw error;
  }

  return new Promise((resolve) => {
    audio.addEventListener("ended", () => {
      if (currentAudio === audio) {
        currentAudio = null;
        setStatus(`Finished: ${description}`);
      }
      resolve();
    }, { once: true });
  });
}

async function playLines(lines, label) {
  for (const line of lines) {
    if (!line.hasAudio) {
      continue;
    }
    await playAudio(line.id, `${label} paragraph ${line.id}`);
  }
}

function renderProviderButtons() {
  providerButtons.innerHTML = "";
  Object.entries(providers).forEach(([key, provider]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = provider.label;
    button.className = key === activeProvider ? "active-provider" : "secondary";
    button.addEventListener("click", () => {
      activeProvider = key;
      renderProviderButtons();
      setStatus(`Audio provider set to ${provider.label}.`);
    });
    providerButtons.append(button);
  });
}

function toggleFilterButtons() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("active-filter", button.dataset.filter === activeFilter);
  });
}

function shouldRenderPhase(phase) {
  if (activeFilter === "all") {
    return true;
  }
  if (activeFilter === "spoken") {
    return phase.kind === "spoken" || phase.kind === "reference";
  }
  return phase.kind === activeFilter;
}

function createTag(text) {
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = text;
  return tag;
}

function renderLine(line) {
  const card = document.createElement("article");
  card.className = "line-card";

  const head = document.createElement("div");
  head.className = "line-head";

  const meta = document.createElement("div");
  meta.className = "line-id";
  meta.textContent = `Line ${line.id}`;

  const actions = document.createElement("div");
  actions.className = "line-actions";

  if (line.hasAudio) {
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.textContent = "Play Paragraph";
    playButton.addEventListener("click", () => {
      playAudio(line.id, `Paragraph ${line.id}`).catch(() => {});
    });

    actions.append(playButton);
  } else {
    const unavailable = document.createElement("span");
    unavailable.className = "line-meta";
    unavailable.textContent = "Audio not available";
    actions.append(unavailable);
  }

  head.append(meta, actions);

  const text = document.createElement("p");
  text.className = "line-text";
  text.textContent = line.text;

  card.append(head, text);
  return card;
}

function renderLogistics(duty) {
  const card = document.createElement("article");
  card.className = "logistics-card";

  const head = document.createElement("div");
  head.className = "logistics-head";

  const id = document.createElement("div");
  id.className = "logistics-id";
  id.textContent = `Duty ${duty.dutyNo} • ${duty.assignedTo}`;

  head.append(id);

  const copy = document.createElement("p");
  copy.className = "logistics-copy";
  copy.textContent = duty.duty;

  card.append(head, copy);

  if (duty.materialsNeeded || duty.notes) {
    const extra = document.createElement("ul");
    extra.className = "logistics-extra";
    if (duty.materialsNeeded) {
      const item = document.createElement("li");
      item.textContent = `Materials: ${duty.materialsNeeded}`;
      extra.append(item);
    }
    if (duty.notes) {
      const item = document.createElement("li");
      item.textContent = `Note: ${duty.notes}`;
      extra.append(item);
    }
    card.append(extra);
  }

  return card;
}

function renderPhase(phase) {
  const section = document.createElement("section");
  section.className = "phase-card";
  section.id = phase.id;

  const header = document.createElement("div");
  header.className = "phase-header";

  const headingBlock = document.createElement("div");
  const title = document.createElement("h2");
  title.className = "phase-title";
  title.textContent = phase.title;

  const summary = document.createElement("p");
  summary.className = "phase-summary";
  summary.textContent = phase.trigger;

  const tags = document.createElement("div");
  tags.className = "tag-row";
  tags.append(
    createTag(phase.timeLabel),
    createTag(phase.sessionTitle),
    createTag(phase.scriptCoverage)
  );

  headingBlock.append(title, summary, tags);

  const actions = document.createElement("div");
  actions.className = "phase-actions";

  if (phase.lines.length > 0) {
    const playPhase = document.createElement("button");
    playPhase.type = "button";
    playPhase.textContent = "Play Paragraph Block";
    playPhase.addEventListener("click", () => {
      playLines(phase.lines, phase.title).catch(() => {});
    });
    actions.append(playPhase);
  }

  const toggleDetails = document.createElement("button");
  toggleDetails.type = "button";
  toggleDetails.className = "secondary";
  toggleDetails.textContent = collapseAll ? "Expand" : "Collapse";
  actions.append(toggleDetails);

  header.append(headingBlock, actions);
  section.append(header);

  const meta = document.createElement("div");
  meta.className = "tag-row";
  phase.whoOnStage.forEach((item) => meta.append(createTag(item)));
  section.append(meta);

  const nextAction = document.createElement("p");
  nextAction.className = "meta-text";
  nextAction.textContent = `Next action: ${phase.nextAction}`;
  section.append(nextAction);

  const content = document.createElement("div");
  content.className = "card-grid";
  content.style.display = collapseAll ? "none" : "grid";
  toggleDetails.addEventListener("click", () => {
    const collapsed = content.style.display === "none";
    content.style.display = collapsed ? "grid" : "none";
    toggleDetails.textContent = collapsed ? "Collapse" : "Expand";
  });

  const lineList = document.createElement("div");
  lineList.className = "line-list";
  if (phase.lines.length > 0) {
    phase.lines.forEach((line) => lineList.append(renderLine(line)));
  } else {
    const placeholder = document.createElement("article");
    placeholder.className = "line-card";
    placeholder.innerHTML = `<p class="line-text">No spoken audio block for this phase. Use it as a reference or logistics checkpoint.</p>`;
    lineList.append(placeholder);
  }

  const logisticsList = document.createElement("div");
  logisticsList.className = "logistics-list";
  if (phase.logistics.length > 0) {
    phase.logistics.forEach((duty) => logisticsList.append(renderLogistics(duty)));
  } else {
    const placeholder = document.createElement("article");
    placeholder.className = "logistics-card";
    placeholder.innerHTML = `<p class="logistics-copy">No extra logistics notes were merged into this phase.</p>`;
    logisticsList.append(placeholder);
  }

  content.append(lineList, logisticsList);
  section.append(content);

  if (phase.notes.length > 0) {
    const notes = document.createElement("ul");
    notes.className = "note-list";
    phase.notes.forEach((note) => {
      const item = document.createElement("li");
      item.textContent = note;
      notes.append(item);
    });
    section.append(notes);
  }

  return section;
}

function renderIndex(phases) {
  phaseIndex.innerHTML = "";
  const title = document.createElement("h2");
  title.className = "phase-index-title";
  title.textContent = "Quick Index";
  phaseIndex.append(title);

  const buttons = document.createElement("div");
  buttons.className = "provider-buttons";
  phases.forEach((phase) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost";
    button.textContent = phase.navLabel;
    button.addEventListener("click", () => {
      document.getElementById(phase.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    buttons.append(button);
  });
  phaseIndex.append(buttons);
}

function renderPhases() {
  const visiblePhases = cueIndex.phases.filter(shouldRenderPhase);
  renderIndex(visiblePhases);
  phaseList.innerHTML = "";
  visiblePhases.forEach((phase) => {
    phaseList.append(renderPhase(phase));
  });
  setStatus(`Loaded ${visiblePhases.length} phase card(s).`);
}

function unlock() {
  const configuredPasscode = config.passcode || "change-me";
  if (passcodeInput.value !== configuredPasscode) {
    gateError.textContent = "Incorrect passcode.";
    return;
  }

  sessionStorage.setItem("mc-cue-app-unlocked", "true");
  gate.classList.add("hidden");
  appShell.classList.remove("hidden");
}

async function loadData() {
  const response = await fetch(assetPaths.data, { cache: "no-store" });
  cueIndex = await response.json();
  appTitle.textContent = config.title || cueIndex.title || "MC Cue Index";
  appSubtitle.textContent = config.subtitle || "Scenario cards, voice playback, logistics notes, and print support.";
  renderProviderButtons();
  renderPhases();
  updateScheduleIndicator();
  if (timerHandle) {
    clearInterval(timerHandle);
  }
  timerHandle = window.setInterval(updateScheduleIndicator, 1000);
}

unlockButton.addEventListener("click", unlock);
passcodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    unlock();
  }
});

printButton.addEventListener("click", () => {
  window.print();
});

collapseButton.addEventListener("click", () => {
  collapseAll = !collapseAll;
  collapseButton.textContent = collapseAll ? "Expand All" : "Collapse All";
  renderPhases();
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    toggleFilterButtons();
    renderPhases();
  });
});

toggleFilterButtons();

if (sessionStorage.getItem("mc-cue-app-unlocked") === "true") {
  gate.classList.add("hidden");
  appShell.classList.remove("hidden");
}

loadData().catch((error) => {
  setStatus(`Could not load cue index: ${error.message}`);
});