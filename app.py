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

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


def _make_overlay_pdf(page_width: float, page_height: float, img_data: bytes, x: float, y: float, width: float, height: float) -> bytes:
    """Create a single-page PDF with the signature image at (x,y). PDF coords: origin bottom-left."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_width, page_height))
    # y from top in frontend -> PDF y from bottom
    y_pdf = page_height - y - height
    img = ImageReader(io.BytesIO(img_data))
    c.drawImage(img, x, y_pdf, width=width, height=height)
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

    # Normalize image to RGB if needed (e.g. PNG with transparency -> white background)
    img = Image.open(io.BytesIO(img_data))
    if img.mode in ("RGBA", "P"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")
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
