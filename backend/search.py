"""Smart search: understands short questions in French or English.

1. Small words and accents are ignored; words are cut to 5 letters
   ("economiser" and "economie" both become "econo").
2. Words are expanded with related ideas in both languages, so
   "how to save money" also finds "comment économiser mon argent".
"""
import re, unicodedata

STOP = {"comment", "faire", "pour", "les", "des", "une", "que", "qui", "quoi", "dans", "son", "ses",
        "mon", "mes", "ton", "tes", "est", "sur", "avec", "bien", "quel", "quelle", "quels", "quelles",
        "peut", "etre", "ainsi", "tout", "tous", "vous", "votre", "conseillez", "quelqu", "francs",
        "fcfa", "cherche", "chercher", "veut", "veux", "voudrais", "aimerais", "mais", "plus", "moins",
        "aussi", "comme", "entre", "sans", "sous", "par", "the", "how", "and", "for", "with", "what",
        "can", "you", "want", "need", "creation", "creer", "cree", "that", "this", "from", "have",
        "does", "should", "could", "would", "some", "good", "best", "who", "where", "when"}

# Groups of related 5-letter word starts (French + English).
CONCEPTS = [
    {"money", "argen", "econo", "eparg", "save", "savin", "finan", "budge", "inves", "cash", "banqu",
     "bank", "reven", "incom", "gagne", "profi"},
    {"busin", "entre", "commerc", "vente", "vendr", "sell", "boutiq", "shop", "start", "lance", "marke",
     "marche", "clien", "custo", "store"},
    {"desig", "logo", "graph", "affic", "poste", "flyer", "brand", "illus", "dessi", "draw"},
    {"sewin", "coutu", "coudr", "tailo", "robe", "dress", "fashi", "tissu", "retou", "ourle"},
    {"beaut", "coiff", "hair", "maqui", "makeu", "ongle", "nail", "tress", "braid", "salon"},
    {"infor", "compu", "ordin", "codin", "code", "progr", "websi", "appli", "mobil", "softw", "logic",
     "tech", "excel", "sites"},
    {"educa", "cours", "lesso", "tutor", "repet", "forma", "train", "learn", "appre", "ensei", "teach",
     "class", "ecole", "schoo", "study", "etude"},
    {"photo", "video", "camer", "image", "film", "monta", "pictu"},
    {"repar", "repai", "fix", "depan", "plomb", "plumb", "elect", "mecan", "mecha"},
    {"conte", "post", "socia", "reseau", "youtu", "tikto", "blog", "write", "redac", "ecrit"},
    {"coach", "mento", "advic", "conse", "guide"},
]


def norm(text):
    return unicodedata.normalize("NFKD", str(text or "").lower()).encode("ascii", "ignore").decode()


def keywords(text):
    """Important words of a question, cut to 5 letters."""
    return [w[:5] for w in re.findall(r"[a-z0-9]+", norm(text))
            if len(w) >= 3 and w not in STOP and not w.isdigit()]


def related(words):
    """Related word starts (other language, synonyms) not already in `words`."""
    extra = set()
    for group in CONCEPTS:
        if group & set(words):
            extra |= group
    return sorted(extra - set(words))


def score(words, title, *others, extra=()):
    """Higher = better match. Typed words count more than related words."""
    title = norm(title)
    rest = norm(" ".join(str(o or "") for o in others))
    total = sum((4 if w in title else 0) + (2 if w in rest else 0) for w in words)
    total += sum((2 if w in title else 0) + (1 if w in rest else 0) for w in extra)
    return total
