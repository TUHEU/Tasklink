"""Small shared helpers: input cleaning, validation and upload checks."""
import re
from flask import request, jsonify

CITIES = ("Yaoundé", "Douala", "Other")
CATEGORIES = ("Design", "IT", "Education", "Sewing", "Photo", "Beauty",
              "Repair", "Finance", "Business", "Content", "Coaching")

# ---- stricter checks for sign-up / profile fields ---------------------------
# E-mail: lowercase only; local part STARTS with a letter and ends with a letter or digit (so "-a@x.com" and "123abc@x.com" are refused), no "..",
# at most 64 characters before the @, a real domain with at least one dot and a letters-only ending.
EMAIL_RE = re.compile(r"""^(?=[^@]{1,64}@)(?!.*\.\.)
    [a-z](?:[a-z0-9._%+-]*[a-z0-9])?
    @(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$""", re.X)
NAME_RE = re.compile(r"^[^\W\d_]+(?:[ '\u2019.-]{1,2}[^\W\d_]+)*\.?$")     # letters, spaces, - ' .
COMMON_PASSWORDS = {"password", "password1", "motdepasse", "motdepasse1", "12345678", "123456789", "1234567890",
                    "qwerty123", "azerty123", "azertyui", "qwertyui", "11111111", "00000000", "tasklink1",
                    "abcd1234", "abc12345", "iloveyou1"}


def valid_email(e):
    """Strict e-mail check. Capital letters are NOT accepted (the caller must not lower-case it first)."""
    if len(e) > 120 or not EMAIL_RE.match(e):
        return False
    local, domain = e.rsplit("@", 1)
    if not re.search(r"[a-z]", local.split("+", 1)[0]):      # only digits before the @ (123456@..., 123+tag@...)
        return False
    if domain in ("gmail.com", "googlemail.com"):
        # Real Gmail names: 6-30 letters, digits or dots (an optional +tag after them is allowed)
        return bool(re.fullmatch(r"[a-z0-9.]{6,30}", local.split("+", 1)[0]))
    return True


def clean_name(n):
    """Trim and collapse repeated spaces."""
    return re.sub(r"\s+", " ", n or "").strip()


def valid_name(n):
    """A real-looking name: 2-80 characters, letters (accents allowed), spaces, hyphen, apostrophe, dot."""
    return 2 <= len(n) <= 80 and bool(NAME_RE.match(n))


def password_problem(pw, email="", name=""):
    """None if the password is acceptable, otherwise the (translatable) message to show."""
    if len(pw) < 8:
        return "Password must contain at least 8 characters"
    if len(pw) > 128:
        return "Text is too long"
    if not re.search(r"[^\W\d_]", pw) or not re.search(r"\d", pw):
        return "Password must contain letters and at least one digit"
    low = pw.lower()
    if low in COMMON_PASSWORDS or low == (email or "").split("@")[0].lower() or low == (name or "").lower().replace(" ", ""):
        return "This password is too easy to guess"
    return None


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


def clean_phone(p):
    """Return the phone number in a clean form, or None if it is not a plausible number.
    Cameroon numbers (9 digits starting with 6 or 2, with or without +237) become +237XXXXXXXXX;
    other countries need the international form +<country code><number> (8-15 digits)."""
    n = re.sub(r"[\s().-]", "", p or "")
    if n.startswith("00"):
        n = "+" + n[2:]
    m = re.fullmatch(r"(?:\+?237)?([62]\d{8})", n)
    if m:
        n = "+237" + m.group(1)
    elif n.startswith("+237") or not re.fullmatch(r"\+[1-9]\d{7,14}", n):
        return None                                 # a +237 number must be a valid Cameroon number
    body = n[5:] if n.startswith("+237") else n.lstrip("+")      # skip the leading 6/2 of a Cameroon number
    if len(set(body)) == 1:                                       # 600000000, 666666666, 00000000 ...
        return None
    return n


def valid_phone(p):
    return clean_phone(p) is not None


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
