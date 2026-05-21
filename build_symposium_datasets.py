from __future__ import annotations

import csv
import json
import re
from pathlib import Path


WORKSPACE = Path(__file__).resolve().parent
PDF_EXTRACT_DIR = WORKSPACE / "AD-Symposium-Programme-g_extract"
WORKBOOK_EXTRACT_DIR = WORKSPACE / "2026 Symposium List (version 3)_extract"
MERGED_EXTRACT_DIR = WORKSPACE / "symposium_merged_extract"

TIME_RANGE_RE = re.compile(r"^(?P<start>\d{1,2}:\d{2})\s*[–-]\s*(?P<end>\d{1,2}:\d{2})$")
PERSON_LINE_RE = re.compile(r"^(Prof|Dr|Ms|Mr|Mrs|Professor)\b", re.IGNORECASE)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return

    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def normalize_space(value: str) -> str:
    value = value.replace("\u00a0", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def parse_pdf_lines(pdf_text: str) -> list[str]:
    raw_lines = []
    for raw_line in pdf_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.isdigit():
            continue
        normalized = normalize_space(line)
        if normalized.lower() == "the programme":
            continue
        if re.fullmatch(r"---\s*Page\s+\d+\s*---", normalized, flags=re.IGNORECASE):
            continue
        raw_lines.append(normalized)

    cleaned_lines = []
    index = 0
    while index < len(raw_lines):
        line = raw_lines[index]
        if line.lower() == "after session 4" and index + 1 < len(raw_lines) and raw_lines[index + 1].lower() == "ends":
            cleaned_lines.append("After session 4 ends")
            index += 2
            continue
        cleaned_lines.append(line)
        index += 1

    return cleaned_lines


def is_time_marker(line: str) -> bool:
    return bool(TIME_RANGE_RE.match(line)) or line.lower() == "after session 4 ends"


def is_person_line(line: str) -> bool:
    return bool(PERSON_LINE_RE.match(line))


def classify_event(title: str) -> str:
    lowered = title.lower()
    if "welcome" in lowered:
        return "welcome"
    if "discussion" in lowered and "roundtable" in lowered:
        return "roundtable"
    if lowered == "discussion":
        return "discussion"
    if "intermission" in lowered or "tea break" in lowered:
        return "break"
    if "lunch" in lowered:
        return "lunch"
    if "dinner" in lowered:
        return "dinner"
    return "presentation"


def split_name_and_affiliation(lines: list[str]) -> tuple[str, str]:
    if not lines:
        return "", ""

    first_line = lines[0]
    if "," in first_line:
        name, remainder = first_line.split(",", 1)
        affiliation_parts = [remainder.strip()] if remainder.strip() else []
        affiliation_parts.extend(lines[1:])
        return normalize_space(name), normalize_space(" ".join(part for part in affiliation_parts if part))

    return normalize_space(first_line), normalize_space(" ".join(lines[1:]))


def extract_header_metadata(lines: list[str]) -> tuple[dict[str, str], int]:
    first_time_index = next(index for index, line in enumerate(lines) if is_time_marker(line))
    header_lines = lines[:first_time_index]

    title_lines: list[str] = []
    date = ""
    event_time = ""
    location_parts: list[str] = []

    for line in header_lines:
        if re.search(r"\b\d{4}\b", line) and any(month in line for month in [
            "January", "February", "March", "April", "May", "June", "July", "August", "September",
            "October", "November", "December",
        ]):
            date = line
            continue
        if "hong kong time" in line.lower():
            event_time = line
            continue
        if not date:
            title_lines.append(line)
        else:
            location_parts.append(line)

    title = ": ".join(title_lines[:2]) if len(title_lines) >= 2 else " ".join(title_lines)
    if len(title_lines) > 2:
        location_parts = title_lines[2:] + location_parts

    metadata = {
        "title": normalize_space(title),
        "date": date,
        "time": event_time,
        "location": normalize_space(" ".join(location_parts)),
    }
    return metadata, first_time_index


def parse_session(lines: list[str], start_index: int) -> tuple[dict[str, str], int]:
    index = start_index
    session_lines = [lines[index]]
    index += 1
    while index < len(lines) and not lines[index].startswith("Chair:") and not is_time_marker(lines[index]) and not lines[index].startswith("Session "):
        session_lines.append(lines[index])
        index += 1

    chair_name = ""
    chair_affiliation = ""
    if index < len(lines) and lines[index].startswith("Chair:"):
        index += 1
        chair_lines = []
        while index < len(lines) and not is_time_marker(lines[index]) and not lines[index].startswith("Session "):
            chair_lines.append(lines[index])
            index += 1
        chair_name, chair_affiliation = split_name_and_affiliation(chair_lines)

    session = {
        "title": normalize_space(" ".join(session_lines)),
        "chair_name": chair_name,
        "chair_affiliation": chair_affiliation,
    }
    return session, index


def parse_event_block(block_lines: list[str], current_session: dict[str, str], metadata: dict[str, str], sequence: int) -> dict[str, str]:
    time_label = block_lines[0]
    start_time = ""
    end_time = ""
    if time_label.lower() != "after session 4 ends":
        match = TIME_RANGE_RE.match(time_label)
        if match:
            start_time = match.group("start")
            end_time = match.group("end")

    content_lines = block_lines[1:]
    title_lines: list[str] = []
    detail_lines: list[str] = []
    detail_started = False
    for line in content_lines:
        if not detail_started and (is_person_line(line) or line.startswith("Chairs:")):
            detail_started = True
        if detail_started:
            detail_lines.append(line)
        else:
            title_lines.append(line)

    title = normalize_space(" ".join(title_lines)) if title_lines else ""
    event_type = classify_event(title)

    speaker_name = ""
    speaker_affiliation = ""
    moderators = ""
    participants = ""
    notes = ""

    if detail_lines:
        if detail_lines[0].startswith("Chairs:"):
            moderators = normalize_space(detail_lines[0].removeprefix("Chairs:").strip())
            if len(detail_lines) > 1:
                participants = normalize_space(" ".join(detail_lines[1:]))
        else:
            speaker_name, speaker_affiliation = split_name_and_affiliation(detail_lines)

    if time_label.lower() == "after session 4 ends":
        notes = "Occurs after session 4 concludes"

    return {
        "record_type": "programme",
        "sequence": str(sequence),
        "date": metadata["date"],
        "event_title": title,
        "event_type": event_type,
        "time_label": time_label,
        "start_time": start_time,
        "end_time": end_time,
        "session_title": current_session.get("title", ""),
        "session_chair_name": current_session.get("chair_name", ""),
        "session_chair_affiliation": current_session.get("chair_affiliation", ""),
        "speaker_name": speaker_name,
        "speaker_affiliation": speaker_affiliation,
        "moderators": moderators,
        "participants": participants,
        "location": metadata["location"],
        "notes": notes,
    }


def parse_programme(pdf_text: str) -> tuple[dict[str, str], list[dict[str, str]]]:
    lines = parse_pdf_lines(pdf_text)
    metadata, index = extract_header_metadata(lines)

    events: list[dict[str, str]] = []
    current_session = {"title": "", "chair_name": "", "chair_affiliation": ""}
    sequence = 1

    while index < len(lines):
        line = lines[index]
        if line.startswith("Session "):
            current_session, index = parse_session(lines, index)
            continue

        if is_time_marker(line):
            block_lines = [line]
            index += 1
            while index < len(lines) and not is_time_marker(lines[index]) and not lines[index].startswith("Session "):
                block_lines.append(lines[index])
                index += 1
            events.append(parse_event_block(block_lines, current_session, metadata, sequence))
            sequence += 1
            continue

        index += 1

    return metadata, events


def parse_workbook_duties(workbook_json_path: Path) -> tuple[dict[str, str], list[dict[str, str]]]:
    payload = json.loads(workbook_json_path.read_text(encoding="utf-8"))
    rows = payload["sheets"][0]["rows"]

    title = normalize_space(str(rows[0][0] or ""))
    source_link = normalize_space(str(rows[10][0] or ""))
    header_index = next(index for index, row in enumerate(rows) if row[:4] == ["No.", "Duty ", "Who?", "Materials needed"])

    records: list[dict[str, str]] = []
    for row in rows[header_index + 1:]:
        number = row[0]
        if number in (None, ""):
            continue
        if isinstance(number, str) and not number.strip().isdigit():
            continue
        if not isinstance(number, str) and not isinstance(number, (int, float)):
            continue
        records.append(
            {
                "record_type": "duty",
                "duty_no": str(int(number)) if isinstance(number, float) else str(number),
                "duty": normalize_space(str(row[1] or "")),
                "assigned_to": normalize_space(str(row[2] or "")),
                "materials_needed": normalize_space(str(row[3] or "")),
                "notes": normalize_space(str(row[4] or "")),
            }
        )

    metadata = {
        "title": title,
        "source_link": source_link,
    }
    return metadata, records


def merge_records(programme_records: list[dict[str, str]], duty_records: list[dict[str, str]]) -> list[dict[str, str]]:
    merged = []
    for record in programme_records:
        merged.append(record.copy())
    for record in duty_records:
        merged.append(record.copy())
    return merged


def build_datasets() -> dict[str, object]:
    pdf_text_path = PDF_EXTRACT_DIR / "AD-Symposium-Programme-g.txt"
    workbook_json_path = WORKBOOK_EXTRACT_DIR / "workbook_data.json"

    pdf_metadata, programme_records = parse_programme(read_text(pdf_text_path))
    workbook_metadata, duty_records = parse_workbook_duties(workbook_json_path)
    merged_records = merge_records(programme_records, duty_records)

    programme_json_path = PDF_EXTRACT_DIR / "programme_schedule.json"
    programme_csv_path = PDF_EXTRACT_DIR / "programme_schedule.csv"
    duties_json_path = WORKBOOK_EXTRACT_DIR / "duties_records.json"
    duties_csv_path = WORKBOOK_EXTRACT_DIR / "duties_records.csv"
    MERGED_EXTRACT_DIR.mkdir(exist_ok=True)
    merged_json_path = MERGED_EXTRACT_DIR / "symposium_merged.json"
    merged_csv_path = MERGED_EXTRACT_DIR / "symposium_merged_records.csv"

    programme_payload = {
        "metadata": pdf_metadata,
        "record_count": len(programme_records),
        "records": programme_records,
    }
    duties_payload = {
        "metadata": workbook_metadata,
        "record_count": len(duty_records),
        "records": duty_records,
    }
    merged_payload = {
        "programme_metadata": pdf_metadata,
        "workbook_metadata": workbook_metadata,
        "programme_record_count": len(programme_records),
        "duty_record_count": len(duty_records),
        "merged_record_count": len(merged_records),
        "records": merged_records,
    }

    write_json(programme_json_path, programme_payload)
    write_csv(programme_csv_path, programme_records)
    write_json(duties_json_path, duties_payload)
    write_csv(duties_csv_path, duty_records)
    write_json(merged_json_path, merged_payload)
    write_csv(merged_csv_path, merged_records)

    return {
        "programme_json": str(programme_json_path),
        "programme_csv": str(programme_csv_path),
        "duties_json": str(duties_json_path),
        "duties_csv": str(duties_csv_path),
        "merged_json": str(merged_json_path),
        "merged_csv": str(merged_csv_path),
        "programme_record_count": len(programme_records),
        "duty_record_count": len(duty_records),
        "merged_record_count": len(merged_records),
    }


def main() -> int:
    outputs = build_datasets()
    print(json.dumps(outputs, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())