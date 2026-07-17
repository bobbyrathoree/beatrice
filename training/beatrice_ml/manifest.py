import csv, hashlib, re, unicodedata
from pathlib import Path

AVP_INST3 = {"kd": "kick", "sd": "snare", "hhc": "hihat", "hho": "hihat"}
LVT_INST3 = {"kick": "kick", "snare": "snare", "hh": "hihat"}
AVP_FILE_RE = re.compile(r"P(\d+)_(Kick|Snare|HHclosed|HHopened|Improvisation)_Personal\.csv$")
LVT_FILE_RE = re.compile(r"^([A-Za-z]{3})([PI])\.csv$")
# Improviso file code -> canonical Frase code (same person, inconsistent naming)
LVT_CODE_ALIASES = {"JSo": "JoS"}

def canon(s: str) -> str:
    return unicodedata.normalize("NFC", s.strip())

def parse_annotation_row(row: list[str], dataset: str) -> dict:
    inst = canon(row[1]).lower()
    if dataset == "avp_personal":
        if inst not in AVP_INST3:
            raise ValueError(f"unknown AVP instrument label: {row[1]!r}")
        inst3, inst4 = AVP_INST3[inst], inst
    else:
        if inst not in LVT_INST3:
            raise ValueError(f"unknown LVT instrument label: {row[1]!r}")
        inst3 = inst4 = LVT_INST3[inst]   # LVT has no 4-way split
    onset_phone = canon(row[2]) if len(row) > 2 else ""
    coda_phone = canon(row[3]) if len(row) > 3 else ""
    return {"onset_seconds": float(row[0]), "instrument4": inst4,
            "instrument3": inst3, "onset_phone": onset_phone,
            "coda_phone": coda_phone,
            "syllable": f"{onset_phone}_{coda_phone}"}

def _collect(csv_path: Path, root: Path, version: str, dataset: str,
             participant: str, recording: str, role: str) -> list[dict]:
    wav = csv_path.with_suffix(".wav")
    if dataset == "lvt":
        wav = csv_path.with_name(csv_path.stem + "3.wav")   # {Code}P.csv -> {Code}P3.wav
    if not wav.exists():
        raise FileNotFoundError(wav)
    rel = str(wav.relative_to(root))
    events = []
    with open(csv_path, newline="") as f:
        for i, raw in enumerate(csv.reader(f)):
            if not raw or not raw[0].strip():
                continue
            r = parse_annotation_row(raw, dataset)
            r.update(dataset=dataset, participant=participant,
                     recording=recording, role=role, path=rel)
            key = f"{version}|{rel}|{i}|{r['onset_seconds']:.9f}"
            r["event_id"] = hashlib.sha256(key.encode()).hexdigest()[:16]
            events.append(r)
    events.sort(key=lambda r: r["onset_seconds"])
    for j, r in enumerate(events):
        r["next_onset_seconds"] = (
            events[j + 1]["onset_seconds"] if j + 1 < len(events) else -1.0)
    return events

def build_avp_manifest(root: Path, version: str) -> list[dict]:
    rows = []
    for csv_path in sorted(root.rglob("P*_Personal.csv")):
        m = AVP_FILE_RE.search(csv_path.name)
        if not m:
            continue
        recording = m.group(2)
        role = "improvisation" if recording == "Improvisation" else "isolated"
        rows.extend(_collect(csv_path, root, version, "avp_personal",
                             f"avp:{int(m.group(1))}", recording, role))
    return rows

def build_lvt_manifest(root: Path, version: str) -> list[dict]:
    rows = []
    for sub, recording, role in [("Frase", "Frase", "isolated"),
                                 ("Improviso", "Improviso", "improvisation")]:
        for csv_path in sorted((root / sub).glob("*.csv")):
            m = LVT_FILE_RE.match(csv_path.name)
            if not m:
                raise ValueError(f"unexpected LVT file name: {csv_path.name}")
            code = LVT_CODE_ALIASES.get(m.group(1), m.group(1))
            rows.extend(_collect(csv_path, root, version, "lvt",
                                 f"lvt:{code}", recording, role))
    return rows

COLUMNS = ["event_id", "dataset", "participant", "recording", "role",
           "onset_seconds", "next_onset_seconds", "instrument4", "instrument3",
           "onset_phone", "coda_phone", "syllable", "path"]

def write_manifest(rows: list[dict], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
