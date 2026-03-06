# PDF Platform

Online PDF tools: upload, sign (draw or upload image), with a scalable UI for future features (compress, convert, etc.).

## Setup

**Python 3.10, 3.11, or 3.12** is recommended. Then:

```bash
python3 -m venv venv
# Use the venv's pip and python so packages match (avoids "No module named 'flask'"):
./venv/bin/python -m pip install -r requirements.txt
./venv/bin/python app.py
```

Or with activation (Windows: `venv\Scripts\activate`):

```bash
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5001

## Features

- **Sign PDF**: Upload a PDF, add a digital signature by drawing or uploading an image, then download the signed PDF.
- *Planned*: Compress, convert, more tools.

## Tech

- **Backend**: Python, Flask
- **Frontend**: HTML, CSS, JavaScript
