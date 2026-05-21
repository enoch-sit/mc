from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz


def extract_pdf(pdf_path: Path) -> Path:
    output_dir = pdf_path.parent / f"{pdf_path.stem}_extract"
    output_dir.mkdir(exist_ok=True)

    images_dir = output_dir / "images"
    images_dir.mkdir(exist_ok=True)

    document = fitz.open(pdf_path)
    payload: dict[str, object] = {
        "source_file": pdf_path.name,
        "page_count": document.page_count,
        "metadata": document.metadata,
        "pages": [],
    }

    combined_text: list[str] = []

    for page_index, page in enumerate(document, start=1):
        text = page.get_text("text")
        page_image_payloads = []
        combined_text.append(f"--- Page {page_index} ---\n{text.strip()}\n")

        for image_index, image in enumerate(page.get_images(full=True), start=1):
            xref = image[0]
            image_info = document.extract_image(xref)
            image_ext = image_info.get("ext", "bin")
            image_name = f"page_{page_index}_image_{image_index}.{image_ext}"
            image_path = images_dir / image_name
            image_path.write_bytes(image_info["image"])
            page_image_payloads.append(
                {
                    "file": str(image_path.relative_to(output_dir)),
                    "width": image_info.get("width"),
                    "height": image_info.get("height"),
                    "colorspace": image_info.get("colorspace"),
                    "xref": xref,
                }
            )

        page_txt_path = output_dir / f"page_{page_index}.txt"
        page_txt_path.write_text(text, encoding="utf-8")

        payload["pages"].append(
            {
                "page_number": page_index,
                "text_file": page_txt_path.name,
                "text_preview": text.strip().splitlines()[:10],
                "image_count": len(page_image_payloads),
                "images": page_image_payloads,
            }
        )

    combined_txt_path = output_dir / f"{pdf_path.stem}.txt"
    combined_txt_path.write_text("\n".join(combined_text).strip() + "\n", encoding="utf-8")

    json_path = output_dir / "document_data.json"
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    document.close()
    return json_path


def main() -> int:
    if len(sys.argv) > 1:
        pdf_path = Path(sys.argv[1]).expanduser().resolve()
    else:
        pdf_path = Path("AD-Symposium-Programme-g.pdf").resolve()

    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 1

    json_path = extract_pdf(pdf_path)
    print(f"Extracted PDF data to: {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())