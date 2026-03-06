"""
PDF Platform - Flask backend.
Scalable for future features: compress, convert, etc.
"""
import io
import os
import uuid
from pathlib import Path

from flask import Flask, request, jsonify, send_file, render_template
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image


def _trim_signature_margin(img: Image.Image) -> Image.Image:
    """Crop image to the bounding box of non-white / non-transparent content so margin does not hide PDF text."""
    if img.mode == "RGBA":
        # Bbox of pixels where alpha > threshold
        alpha = img.split()[-1]
        bbox = alpha.getbbox()
    else:
        img_rgb = img.convert("RGB")
        # Bbox of pixels that are not near-white (signature strokes)
        data = list(img_rgb.getdata())
        w, h = img.size
        non_white = [
            (i % w, i // w)
            for i, p in enumerate(data)
            if (p[0], p[1], p[2]) < (250, 250, 250)
        ]
        if not non_white:
            return img
        xs = [a for a, _ in non_white]
        ys = [b for _, b in non_white]
        bbox = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
    if bbox is None:
        return img
    return img.crop(bbox)


def _image_with_transparent_whites(img: Image.Image) -> Image.Image:
    """Convert to RGBA and make white/near-white pixels transparent so PDF text shows through."""
    if img.mode == "RGBA":
        data = list(img.getdata())
        new_data = [
            (255, 255, 255, 0) if (r >= 250 and g >= 250 and b >= 250) else (r, g, b, a)
            for (r, g, b, a) in data
        ]
        out = Image.new("RGBA", img.size)
        out.putdata(new_data)
        return out
    img = img.convert("RGB")
    img_rgba = Image.new("RGBA", img.size, (255, 255, 255, 0))
    data_rgb = list(img.getdata())
    w, h = img.size
    new_data = [
        (255, 255, 255, 0) if (p[0] >= 250 and p[1] >= 250 and p[2] >= 250) else (p[0], p[1], p[2], 255)
        for p in data_rgb
    ]
    img_rgba.putdata(new_data)
    return img_rgba


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def _make_overlay_pdf(page_width: float, page_height: float, img_data: bytes, x: float, y: float, width: float, height: float) -> bytes:
    """Create a single-page PDF with the signature image at (x,y). PDF coords: origin bottom-left.
    Image should be PNG with transparency so white margin does not block text underneath."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_width, page_height))
    # y from top in frontend -> PDF y from bottom
    y_pdf = page_height - y - height
    img = ImageReader(io.BytesIO(img_data))
    c.drawImage(img, x, y_pdf, width=width, height=height, mask="auto")
    c.save()
    buf.seek(0)
    return buf.read()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/uploads/<file_id>.pdf")
def serve_uploaded_pdf(file_id):
    path = UPLOAD_DIR / f"{file_id}.pdf"
    if not path.exists():
        return "Not found", 404
    return send_file(path, mimetype="application/pdf", download_name="document.pdf")


@app.route("/api/upload-pdf", methods=["POST"])
def upload_pdf():
    if "pdf" not in request.files:
        return jsonify({"error": "No PDF file"}), 400
    f = request.files["pdf"]
    if f.filename == "" or not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Invalid or missing PDF"}), 400
    file_id = str(uuid.uuid4())
    path = UPLOAD_DIR / f"{file_id}.pdf"
    f.save(path)
    reader = PdfReader(path)
    num_pages = len(reader.pages)
    page_sizes = []
    for p in reader.pages:
        mb = p.mediabox
        page_sizes.append({"width": float(mb.width), "height": float(mb.height)})
    return jsonify({"file_id": file_id, "num_pages": num_pages, "page_sizes": page_sizes})


@app.route("/api/sign-pdf", methods=["POST"])
def sign_pdf():
    file_id = request.form.get("file_id")
    page_index = int(request.form.get("page", 0))
    x = float(request.form.get("x", 100))
    y = float(request.form.get("y", 100))
    width = float(request.form.get("width", 200))
    height = float(request.form.get("height", 80))

    pdf_path = UPLOAD_DIR / f"{file_id}.pdf"
    if not pdf_path.exists():
        return jsonify({"error": "PDF not found"}), 404

    # Signature: either "signature" file (image) or "signature_data" (base64 data URL from canvas)
    img_data = None
    if "signature" in request.files and request.files["signature"].filename:
        img_data = request.files["signature"].read()
    elif request.form.get("signature_data"):
        import base64
        data = request.form["signature_data"]
        if "," in data:
            data = data.split(",", 1)[1]
        img_data = base64.b64decode(data)

    if not img_data:
        return jsonify({"error": "No signature provided"}), 400

    # Load image, trim white margin, then make white/empty areas transparent so PDF text shows through
    img = Image.open(io.BytesIO(img_data))
    if img.mode == "P":
        img = img.convert("RGBA")
    elif img.mode != "RGBA" and img.mode != "RGB":
        img = img.convert("RGB")
    # Trim margin so we only draw the signature content
    img = _trim_signature_margin(img)
    # Make white/near-white pixels transparent so the blue box margin does not block text
    img = _image_with_transparent_whites(img)
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format="PNG")
    img_byte_arr.seek(0)
    img_data = img_byte_arr.read()

    reader = PdfReader(pdf_path)
    page = reader.pages[page_index]
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)

    overlay_pdf_bytes = _make_overlay_pdf(page_width, page_height, img_data, x, y, width, height)
    overlay_reader = PdfReader(io.BytesIO(overlay_pdf_bytes))
    stamp_page = overlay_reader.pages[0]

    writer = PdfWriter()
    for i, p in enumerate(reader.pages):
        if i == page_index:
            p.merge_page(stamp_page, over=True)
        writer.add_page(p)

    out = io.BytesIO()
    writer.write(out)
    out.seek(0)

    # Optionally replace stored file so next sign uses updated PDF (for multiple signatures)
    with open(pdf_path, "wb") as fp:
        fp.write(out.getvalue())

    out.seek(0)
    return send_file(out, mimetype="application/pdf", as_attachment=True, download_name="signed.pdf")


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5001)
