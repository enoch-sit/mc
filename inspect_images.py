import openpyxl
from openpyxl.drawing.image import Image

file_path = "2026 Symposium List (version 2).xlsx"
try:
    wb = openpyxl.load_workbook(file_path)
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        images = ws._images
        print(f"Sheet: {sheet_name}")
        print(f"  Image Count: {len(images)}")
        for i, img in enumerate(images):
            # Anchor info
            pos = "Unknown"
            if hasattr(img, 'anchor'):
                # Many images use TwoCellAnchor or OneCellAnchor
                anchor = img.anchor
                try:
                    # OneCellAnchor or TwoCellAnchor
                    if hasattr(anchor, '_from'):
                         pos = f"From (Col: {anchor._from.col}, Row: {anchor._from.row})"
                    else:
                         pos = str(anchor)
                except:
                    pos = str(anchor)
            
            # Dimensions
            width = img.width
            height = img.height
            
            # Format/Path
            # openpyxl.drawing.image.Image usually has a .format if it's wrapping a PIL image
            # or we can check the original file ref if available.
            img_format = getattr(img, 'format', 'N/A')
            
            print(f"  - Image {i+1}:")
            print(f"    Position: {pos}")
            print(f"    Dimensions: {width}x{height}")
            print(f"    Format: {img_format}")
except Exception as e:
    import traceback
    traceback.print_exc()
