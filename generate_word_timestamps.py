import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SAMPLE_RATE = 16000


@dataclass
class PracticeLine:
    id: str
    text: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate word timestamps for MC practice audio using WhisperX forced alignment."
    )
    parser.add_argument("--provider", choices=["local", "openrouter", "grok"], required=True)
    parser.add_argument("--input", default="mc_practice_lines.txt", help="Practice lines file")
    parser.add_argument("--audio-dir", default=None, help="Override provider audio directory")
    parser.add_argument("--output-dir", default="word_timestamps", help="Output directory for timestamp files")
    parser.add_argument("--start-id", default=None, help="First line ID to process")
    parser.add_argument("--end-id", default=None, help="Last line ID to process")
    parser.add_argument("--language", default="en", help="Language code for the align model")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="Execution device")
    parser.add_argument("--batch-size", type=int, default=4, help="Reserved for future transcription-based alignment")
    parser.add_argument("--compute-type", default="int8", help="Reserved for future transcription-based alignment")
    return parser.parse_args()


def parse_practice_lines(raw_text: str) -> list[PracticeLine]:
    lines: list[PracticeLine] = []
    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        separator_index = line.find("|")
        if separator_index == -1:
            raise ValueError(f"Invalid practice line: {line}")
        line_id = line[:separator_index].strip()
        text = line[separator_index + 1 :].strip()
        if not line_id or not text:
            raise ValueError(f"Invalid practice line: {line}")
        lines.append(PracticeLine(id=line_id, text=text))
    return lines


def select_lines(lines: list[PracticeLine], start_id: str | None, end_id: str | None) -> list[PracticeLine]:
    selected: list[PracticeLine] = []
    for line in lines:
        if start_id and line.id < start_id:
            continue
        if end_id and line.id > end_id:
            continue
        selected.append(line)
    return selected


def default_audio_dir(provider: str) -> Path:
    if provider == "local":
        return Path("mc_practice_audio")
    return Path("teacher_tts_audio") / provider


def audio_extension(provider: str) -> str:
    return ".wav" if provider == "local" else ".mp3"


def normalize_word(text: str) -> str:
    return "".join(character.lower() for character in text if character.isalnum() or character == "'")


def extract_word_segments(alignment_result: dict) -> list[dict]:
    direct_segments = alignment_result.get("word_segments") or []
    if direct_segments:
        return direct_segments

    collected: list[dict] = []
    for segment in alignment_result.get("segments", []):
        collected.extend(segment.get("words", []))
    return collected


def map_display_words(display_words: list[str], aligned_words: list[dict], duration: float) -> list[dict]:
    mapped = [
        {
            "text": word,
            "normalized": normalize_word(word),
            "start": None,
            "end": None,
        }
        for word in display_words
    ]
    normalized_aligned = [
        {
            "text": item.get("word", item.get("text", "")).strip(),
            "normalized": normalize_word(item.get("word", item.get("text", ""))),
            "start": float(item.get("start", 0.0)),
            "end": float(item.get("end", 0.0)),
        }
        for item in aligned_words
        if item.get("start") is not None and item.get("end") is not None
    ]

    aligned_index = 0
    for entry in mapped:
        normalized = entry["normalized"]
        if not normalized:
            continue
        while aligned_index < len(normalized_aligned) and normalized_aligned[aligned_index]["normalized"] != normalized:
            aligned_index += 1
        if aligned_index < len(normalized_aligned):
            entry["start"] = normalized_aligned[aligned_index]["start"]
            entry["end"] = normalized_aligned[aligned_index]["end"]
            aligned_index += 1

    fill_missing_timings(mapped, duration)
    compact_words: list[dict] = []
    for entry in mapped:
        compact_words.append(
            {
                "text": entry["text"],
                "start": round(float(entry["start"]), 3),
                "end": round(float(entry["end"]), 3),
            }
        )
    return compact_words


def fill_missing_timings(mapped_words: list[dict], duration: float) -> None:
    index = 0
    while index < len(mapped_words):
        if mapped_words[index]["start"] is not None and mapped_words[index]["end"] is not None:
            index += 1
            continue

        missing_start = index
        while index < len(mapped_words) and (mapped_words[index]["start"] is None or mapped_words[index]["end"] is None):
            index += 1
        missing_end = index - 1

        previous_end = mapped_words[missing_start - 1]["end"] if missing_start > 0 else 0.0
        next_start = mapped_words[index]["start"] if index < len(mapped_words) and mapped_words[index]["start"] is not None else duration
        span = max(next_start - previous_end, 0.1)
        slice_duration = span / (missing_end - missing_start + 1)

        for offset, word_index in enumerate(range(missing_start, missing_end + 1), start=0):
            start = previous_end + slice_duration * offset
            end = previous_end + slice_duration * (offset + 1)
            mapped_words[word_index]["start"] = start
            mapped_words[word_index]["end"] = end

    previous_end = 0.0
    for entry in mapped_words:
        start = max(float(entry["start"]), previous_end)
        end = max(float(entry["end"]), start + 0.03)
        entry["start"] = start
        entry["end"] = min(end, duration)
        previous_end = entry["end"]


def align_line(whisperx, model, metadata, device: str, line: PracticeLine, audio_path: Path) -> dict:
    audio = whisperx.load_audio(str(audio_path))
    duration = len(audio) / SAMPLE_RATE
    forced_segments = [{"start": 0.0, "end": duration, "text": line.text}]
    alignment_result = whisperx.align(
        forced_segments,
        model,
        metadata,
        audio,
        device,
        return_char_alignments=False,
    )
    aligned_words = extract_word_segments(alignment_result)
    word_timings = map_display_words(line.text.split(), aligned_words, duration)
    return {
        "id": line.id,
        "text": line.text,
        "duration": round(duration, 3),
        "words": word_timings,
    }


def write_outputs(output_root: Path, provider: str, records: list[dict]) -> None:
    provider_dir = output_root / provider
    provider_dir.mkdir(parents=True, exist_ok=True)

    bundle = {provider: {record["id"]: record["words"] for record in records}}
    bundle_json_path = output_root / "word_timestamps_data.json"
    bundle_script_path = output_root / "word_timestamps_data.js"

    for record in records:
        output_path = provider_dir / f"{record['id']}.json"
        output_path.write_text(json.dumps(record, indent=2), encoding="utf-8")

    existing_bundle = {}
    if bundle_json_path.exists():
        existing_bundle = json.loads(bundle_json_path.read_text(encoding="utf-8"))
    existing_bundle.update(bundle)

    bundle_json_path.write_text(json.dumps(existing_bundle, indent=2), encoding="utf-8")
    bundle_script_path.write_text(
        "window.WORD_TIMESTAMPS = Object.assign(window.WORD_TIMESTAMPS || {}, "
        + json.dumps(existing_bundle, ensure_ascii=False)
        + ");\n",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()

    try:
        import whisperx
    except ImportError as error:
        raise SystemExit(
            "whisperx is not installed. Create a venv and run: pip install -r requirements-word-alignment.txt"
        ) from error

    input_path = Path(args.input)
    output_root = Path(args.output_dir)
    audio_dir = Path(args.audio_dir) if args.audio_dir else default_audio_dir(args.provider)
    extension = audio_extension(args.provider)

    lines = parse_practice_lines(input_path.read_text(encoding="utf-8"))
    selected_lines = select_lines(lines, args.start_id, args.end_id)
    if not selected_lines:
        raise SystemExit("No practice lines matched the selected range.")

    model, metadata = whisperx.load_align_model(language_code=args.language, device=args.device)
    records: list[dict] = []

    for line in selected_lines:
        audio_path = audio_dir / f"{line.id}{extension}"
        if not audio_path.exists():
            raise SystemExit(f"Missing audio file: {audio_path}")
        print(f"Aligning {args.provider} {line.id}")
        record = align_line(whisperx, model, metadata, args.device, line, audio_path)
        records.append(record)

    write_outputs(output_root, args.provider, records)
    generated_at = datetime.now(timezone.utc).isoformat()
    print(f"Generated {len(records)} timestamp file(s) for {args.provider} at {generated_at}")


if __name__ == "__main__":
    main()
