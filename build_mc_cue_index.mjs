import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(".");
const PROGRAMME_PATH = path.join(ROOT, "AD-Symposium-Programme-g_extract", "programme_schedule.csv");
const DUTIES_PATH = path.join(ROOT, "2026 Symposium List (version 3)_extract", "duties_records.csv");
const PRACTICE_LINES_PATH = path.join(ROOT, "mc_practice_lines.txt");
const MC_SCRIPT_PATH = path.join(ROOT, "MCScript.txt");
const OUTPUT_DIR = path.join(ROOT, "webapp", "data");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "mc_cue_index.json");

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(rawText) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const character = rawText[index];
    const nextCharacter = rawText[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(current);
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += character;
  }

  if (current !== "" || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const [header, ...body] = rows;
  return body.map((cells) => {
    const record = {};
    for (let index = 0; index < header.length; index += 1) {
      record[header[index]] = normalizeWhitespace(cells[index] || "");
    }
    return record;
  });
}

function parsePracticeLines(rawText) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separatorIndex = line.indexOf("|");
      return {
        id: line.slice(0, separatorIndex).trim(),
        text: line.slice(separatorIndex + 1).trim(),
      };
    });
}

function parseMcScript(rawText) {
  return rawText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function findProgrammeEvent(programme, predicate, fallbackTitle) {
  return programme.find(predicate) || { time_label: "To confirm", session_title: fallbackTitle, event_title: fallbackTitle, start_time: "", end_time: "" };
}

function matchDuties(duties, keywords) {
  return duties
    .filter((duty) => {
      const haystack = `${duty.duty} ${duty.notes} ${duty.materials_needed}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword));
    })
    .map((duty) => ({
      dutyNo: duty.duty_no,
      assignedTo: duty.assigned_to || "Unassigned",
      duty: duty.duty,
      materialsNeeded: duty.materials_needed || "",
      notes: duty.notes || "",
    }));
}

function range(start, end) {
  const results = [];
  for (let value = start; value <= end; value += 1) {
    results.push(String(value).padStart(3, "0"));
  }
  return results;
}

function collectLines(practiceLines, ids) {
  const byId = new Map(practiceLines.map((line) => [line.id, line]));
  return ids.map((id) => {
    const line = byId.get(id);
    return {
      id,
      text: line ? line.text : "Missing normalized line",
      hasAudio: Boolean(line && Number(id) <= 59),
    };
  });
}

function withSchedule(phase, startTime, endTime) {
  return {
    ...phase,
    schedule: {
      startTime,
      endTime,
      active: Boolean(startTime),
    },
  };
}

const PERSON_NAME_PATTERN = /\b(?:Professor|Prof\.?|Dr\.?|Ms\.?|Mr\.?|Mrs\.?)\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4}/g;
const TITLE_PREFIX_PATTERN = /^(Professor|Prof\.?|Dr\.?|Ms\.?|Mr\.?|Mrs\.?)\s+/;

function slugifyName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function addNameEntry(entries, displayName) {
  const normalizedName = normalizeWhitespace(displayName).replace(/[,:;!?]+$/g, "");
  if (!normalizedName) {
    return;
  }

  const id = slugifyName(normalizedName);
  if (!id || entries.has(id)) {
    return;
  }

  entries.set(id, {
    id,
    displayName: normalizedName,
    spokenText: normalizedName,
  });
}

function collectNamesFromText(entries, text) {
  const matches = normalizeWhitespace(text).match(PERSON_NAME_PATTERN) || [];
  matches.forEach((match) => {
    addNameEntry(entries, match);

    const withoutTitle = match.replace(TITLE_PREFIX_PATTERN, "").trim();
    if (withoutTitle.split(/\s+/).length >= 2) {
      addNameEntry(entries, withoutTitle);
    }
  });
}

function buildNamePronunciations(phases) {
  const entries = new Map();

  phases.forEach((phase) => {
    [phase.title, phase.trigger, phase.nextAction, phase.sessionTitle, phase.timeLabel, phase.scriptCoverage]
      .forEach((text) => collectNamesFromText(entries, text));

    phase.whoOnStage.forEach((item) => collectNamesFromText(entries, item));
    phase.notes.forEach((note) => collectNamesFromText(entries, note));
    phase.lines.forEach((line) => collectNamesFromText(entries, line.text));
    phase.logistics.forEach((duty) => {
      [duty.assignedTo, duty.duty, duty.materialsNeeded, duty.notes]
        .forEach((text) => collectNamesFromText(entries, text));
    });
  });

  return Array.from(entries.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function buildPhases(programme, duties, practiceLines, scriptLines) {
  const welcomeEvent = findProgrammeEvent(
    programme,
    (event) => event.event_type === "welcome",
    "Welcome and Introduction"
  );
  const sessionTwoDiscussion = findProgrammeEvent(
    programme,
    (event) => event.session_title.includes("Session 2") && event.event_type === "discussion",
    "Session 2 discussion"
  );
  const lunchEvent = findProgrammeEvent(
    programme,
    (event) => event.event_type === "lunch",
    "Lunch"
  );
  const sessionFourDiscussion = findProgrammeEvent(
    programme,
    (event) => event.session_title.includes("Session 4") && event.event_type === "discussion",
    "Session 4 discussion"
  );
  const roundtableEvent = findProgrammeEvent(
    programme,
    (event) => event.event_type === "roundtable",
    "Roundtable Discussion"
  );
  const dinnerEvent = findProgrammeEvent(
    programme,
    (event) => event.event_type === "dinner",
    "Dinner"
  );

  return [
    withSchedule({
      id: "pre-event-logistics",
      title: "Pre-Event Logistics",
      kind: "logistics",
      navLabel: "Pre-Event",
      timeLabel: "Before 9:00 a.m.",
      sessionTitle: "Venue, arrivals, registration, and AV readiness",
      trigger: "Before the first spoken welcome line, the room and support flow should already be stable.",
      whoOnStage: ["MC ready", "Guests seated", "Support team in position"],
      nextAction: "Begin the opening welcome only after recording, registration, seating, and slides are ready.",
      notes: [
        "The workbook places speaker pickup at 8:00 a.m. from Hotel Jen.",
        "Recording and Zoom monitoring are support duties, not spoken MC cues.",
      ],
      scriptCoverage: "Workbook logistics only",
      lineIds: [],
      lines: [],
      logistics: matchDuties(duties, ["hotel jen", "recorded", "zoom", "camcorder", "signing in", "lanyards", "slides", "time keeper", "name stands", "water", "poster", "seating plan"]),
    }, "08:00", "09:00"),
    withSchedule({
      id: "opening-welcome",
      title: "Opening Welcome",
      kind: "spoken",
      navLabel: "Opening",
      timeLabel: welcomeEvent.time_label || "9:00 - 9:05",
      sessionTitle: welcomeEvent.event_title,
      trigger: "At the start of the symposium, before Professor Gilberto Leung begins the welcome speech and introduction.",
      whoOnStage: ["MC", "Dr. Anthony Ng", "Ms. Glenda Yu", "Audience seated"],
      nextAction: "Invite Professor Gilberto Leung to give the welcome speech and introduction.",
      notes: [
        "The original MC script says Professor Eric Ip handles the Session 1 intermission announcement, not the MC.",
        scriptLines.find((line) => line.includes("Prof Eric Ip will tell the audience")) || "",
      ].filter(Boolean),
      scriptCoverage: "Covered by practice audio",
      lineIds: range(1, 12),
      lines: collectLines(practiceLines, range(1, 12)),
      logistics: matchDuties(duties, ["time keeper", "slides", "recorded", "signing in", "name stands"]),
    }, welcomeEvent.start_time || "09:00", welcomeEvent.end_time || "09:05"),
    withSchedule({
      id: "session-one-handoff",
      title: "Session 1 Handoff Note",
      kind: "reference",
      navLabel: "Session 1 Note",
      timeLabel: "10:25 - 10:40",
      sessionTitle: "Session 1 intermission",
      trigger: "At the end of Session 1, the original script gives the intermission handoff to Professor Eric Ip instead of the MC.",
      whoOnStage: ["Professor Eric Ip", "Audience"],
      nextAction: "Treat this as a reference checkpoint, not an MC audio block.",
      notes: [
        scriptLines.find((line) => line.includes("Prof Eric Ip will tell the audience that the intermission starts")) || "Original script note retained.",
      ],
      scriptCoverage: "Reference only",
      lineIds: [],
      lines: [],
      logistics: matchDuties(duties, ["salad wraps", "coffee", "tea", "cutlery", "tissue"]),
    }, "10:25", "10:40"),
    withSchedule({
      id: "session-two-close",
      title: "Session 2 Close, Souvenirs, and Group Photo",
      kind: "spoken",
      navLabel: "Session 2 Close",
      timeLabel: sessionTwoDiscussion.time_label || "12:10 - 12:25",
      sessionTitle: sessionTwoDiscussion.session_title,
      trigger: "Say this after the Session 2 discussion finishes and before the lunch transition begins.",
      whoOnStage: ["Professor Gilberto Leung", "Professor Eric Ip", "Session 1 and Session 2 presenters as invited"],
      nextAction: "Complete souvenir presentations, group photo, then dismiss the room toward lunch.",
      notes: [
        "The workbook explicitly says the MC should invite each chair to present metal bookmarks.",
        "Photographer takes one photo per souvenir plus group photos.",
      ],
      scriptCoverage: "Covered by practice audio",
      lineIds: range(13, 31),
      lines: collectLines(practiceLines, range(13, 31)),
      logistics: matchDuties(duties, ["metal bookmarks", "photo", "photographer"]),
    }, sessionTwoDiscussion.start_time || "12:10", sessionTwoDiscussion.end_time || "12:25"),
    withSchedule({
      id: "lunch-transition",
      title: "Lunch Transition",
      kind: "spoken",
      navLabel: "Lunch",
      timeLabel: lunchEvent.time_label || "12:25 - 14:00",
      sessionTitle: lunchEvent.event_title,
      trigger: "Immediately after the Session 2 souvenir and group-photo block ends.",
      whoOnStage: ["MC", "Speakers and chairs preparing to leave"],
      nextAction: "Direct speakers and chairs to Bijas and remind them Session 3 resumes at 2:00 p.m.",
      notes: [
        "The workbook says Serene holds a card and accompanies speakers to Bijas for lunch.",
        "There is also a return-to-ACR support duty at 1:40 p.m.",
      ],
      scriptCoverage: "Covered by practice audio",
      lineIds: range(32, 37),
      lines: collectLines(practiceLines, range(32, 37)),
      logistics: matchDuties(duties, ["bijas", "conference poster", "1:40 pm"]),
    }, lunchEvent.start_time || "12:25", lunchEvent.end_time || "14:00"),
    withSchedule({
      id: "afternoon-break-logistics",
      title: "Afternoon Break Logistics",
      kind: "logistics",
      navLabel: "Afternoon Break",
      timeLabel: "15:15 - 15:25",
      sessionTitle: "Tea break support",
      trigger: "Use this as an operations checkpoint during the afternoon intermission.",
      whoOnStage: ["Support team"],
      nextAction: "Refresh food and drink setup before Session 4 resumes.",
      notes: [
        "The extracted workbook says fruit tarts, coffee, tea, cutlery, and tissue are handled in the afternoon break.",
      ],
      scriptCoverage: "Workbook logistics only",
      lineIds: [],
      lines: [],
      logistics: matchDuties(duties, ["fruit tarts", "coffee", "tea", "cutlery", "tissue"]),
    }, "15:15", "15:25"),
    withSchedule({
      id: "session-four-close",
      title: "Session 4 Close, Souvenirs, and Final Photos",
      kind: "spoken",
      navLabel: "Session 4 Close",
      timeLabel: `${sessionFourDiscussion.time_label || "16:05 - 16:15"} and ${roundtableEvent.time_label || "16:15 - 17:00"}`,
      sessionTitle: roundtableEvent.session_title || sessionFourDiscussion.session_title,
      trigger: "Use this block after the final discussion and roundtable conclude.",
      whoOnStage: ["Professor Carl Hildebrand", "Professor Julie Chen", "Session 3 and Session 4 presenters as invited"],
      nextAction: "Finish souvenir presentations, take the closing group photos, and formally end the symposium.",
      notes: [
        "The normalized audio groups Sessions 3 and 4 souvenir presentation into the final closing block.",
        "The workbook wording mentions Session 3 and after Dr Siraj; the current MC script instead presents Sessions 3 and 4 together at the end.",
      ],
      scriptCoverage: "Covered by practice audio",
      lineIds: range(38, 51),
      lines: collectLines(practiceLines, range(38, 51)),
      logistics: matchDuties(duties, ["metal bookmarks", "photo", "photographer"]),
    }, sessionFourDiscussion.start_time || "16:05", roundtableEvent.end_time || "17:00"),
    withSchedule({
      id: "dinner-transition",
      title: "Dinner Transition",
      kind: "spoken",
      navLabel: "Dinner",
      timeLabel: dinnerEvent.time_label || "After Session 4",
      sessionTitle: dinnerEvent.event_title,
      trigger: "Immediately after the symposium is formally closed.",
      whoOnStage: ["MC", "Speakers preparing to leave"],
      nextAction: "Send speakers to SCR at K. K. Leung Building with Serene leading the group.",
      notes: [
        "The workbook says Serene accompanies speakers to SCR for dinner.",
      ],
      scriptCoverage: "Covered by practice audio",
      lineIds: range(52, 55),
      lines: collectLines(practiceLines, range(52, 55)),
      logistics: matchDuties(duties, ["scr", "restaurant for dinner", "conference poster"]),
    }, dinnerEvent.start_time || "17:00", "18:30"),
    withSchedule({
      id: "pronunciation-drills",
      title: "Pronunciation and Time Drills",
      kind: "practice",
      navLabel: "Drills",
      timeLabel: "Practice anytime",
      sessionTitle: "Reference drills",
      trigger: "Use these lines as rehearsal support, not as live symposium cues.",
      whoOnStage: ["MC practicing alone"],
      nextAction: "Repeat until the time expressions sound natural.",
      notes: [
        "These lines are included only for pronunciation practice.",
      ],
      scriptCoverage: "Practice only",
      lineIds: range(56, 59),
      lines: collectLines(practiceLines, range(56, 59)),
      logistics: [],
    }, null, null),
  ];
}

async function main() {
  const [programmeRaw, dutiesRaw, practiceRaw, mcScriptRaw] = await Promise.all([
    fs.readFile(PROGRAMME_PATH, "utf8"),
    fs.readFile(DUTIES_PATH, "utf8"),
    fs.readFile(PRACTICE_LINES_PATH, "utf8"),
    fs.readFile(MC_SCRIPT_PATH, "utf8"),
  ]);

  const programme = parseCsv(programmeRaw);
  const duties = parseCsv(dutiesRaw);
  const practiceLines = parsePracticeLines(practiceRaw);
  const scriptLines = parseMcScript(mcScriptRaw);
  const phases = buildPhases(programme, duties, practiceLines, scriptLines);
  const namePronunciations = buildNamePronunciations(phases);

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFiles: [
      "AD-Symposium-Programme-g_extract/programme_schedule.csv",
      "2026 Symposium List (version 3)_extract/duties_records.csv",
      "mc_practice_lines.txt",
      "MCScript.txt",
    ],
    deploymentNotes: {
      host: "Vercel static deployment",
      passcodeWarning: "Client-side passcode is only a convenience gate. It is not real security.",
    },
    schedule: {
      timezone: "Asia/Hong_Kong",
      eventDate: "2026-05-23",
      mode: "time-of-day",
      note: "The live indicator uses Hong Kong time-of-day so it still shows what should be happening during rehearsal before symposium day.",
    },
    audioProviders: {
      local: "../mc_practice_audio",
      openrouter: "../teacher_tts_audio/openrouter",
      grok: "../teacher_tts_audio/grok",
    },
    namePronunciations,
    phases,
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`Wrote cue index to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});