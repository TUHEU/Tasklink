"""Small shared helpers: input cleaning, validation and upload checks."""
import re
from flask import request, jsonify

CITIES = ("Yaoundé", "Douala", "Other")
CATEGORIES = ("Design", "IT", "Education", "Sewing", "Photo", "Beauty",
              "Repair", "Finance", "Business", "Content", "Coaching")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def body():
    """JSON body as a dict (an empty dict if missing or invalid)."""
    d = request.get_json(silent=True)
    return d if isinstance(d, dict) else {}


def fail(message, code=400):
    return jsonify(error=message), code


def text(d, key):
    """A cleaned string from the request (never raises, trims spaces)."""
    v = d.get(key, "")
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        return ""
    return str(v).strip()


def whole(v, lo=0, hi=1_000_000_000):
    """Whole number from 12000, '12000' or '12 000'. None if invalid or out of range."""
    try:
        if isinstance(v, bool):
            raise ValueError
        if isinstance(v, str):
            v = v.strip().replace(" ", "")
        n = float(v)
        if n != int(n):
            raise ValueError
        n = int(n)
    except (TypeError, ValueError, OverflowError):
        return None
    return n if lo <= n <= hi else None


def valid_phone(p):
    digits = re.sub(r"\D", "", p)
    return 8 <= len(digits) <= 15 and re.fullmatch(r"[+\d][\d\s().-]*", p) is not None


# ---- uploads: check the real file content, not only the extension --------
# extension -> (kind, content family)
FILE_TYPES = {
    "jpg": ("image", "jpg"), "jpeg": ("image", "jpg"), "png": ("image", "png"),
    "webp": ("image", "webp"), "mp4": ("video", "mp4"), "mov": ("video", "mp4"),
    "webm": ("video", "webm"),
}


# Chat attachments: pictures and PDF documents only
CHAT_TYPES = {
    "jpg": ("image", "jpg"), "jpeg": ("image", "jpg"), "png": ("image", "png"),
    "webp": ("image", "webp"), "pdf": ("pdf", "pdf"),
}


def sniff(head):
    """Identify a file from its first bytes -> (kind, family) or (None, None)."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image", "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", "png"
    if head.startswith(b"%PDF-"):
        return "pdf", "pdf"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image", "webp"
    if head[4:8] in (b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip"):
        return "video", "mp4"            # MP4 and QuickTime MOV
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video", "webm"
    return None, None


def inspect_upload(f, allowed_ext, types=None):
    """Validate an uploaded file. Returns (ext, kind, size, error_message).
    `types` maps extension -> (kind, family); the default is FILE_TYPES (portfolio)."""
    types = types or FILE_TYPES
    name = (f.filename or "") if f else ""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if not f or ext not in allowed_ext:
        return ext, None, 0, "BAD_TYPE"
    f.stream.seek(0, 2)
    size = f.stream.tell()
    f.stream.seek(0)
    head = f.stream.read(16)
    f.stream.seek(0)
    if size == 0:
        return ext, None, 0, "EMPTY"
    if sniff(head) != types[ext]:
        return ext, None, size, "BAD_TYPE"
    return ext, types[ext][0], size, None
