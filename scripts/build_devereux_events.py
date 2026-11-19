"""Build the Devereux page's tide history and event catalog from the Python project.

Usage: python scripts/build_devereux_events.py PATH/TO/devereux-breach/analysis/berm/results

Reads tide_hourly.csv, mouth_events.json and hourly_level.csv and writes
  devereux/tide-history.json  NOAA 9411340 hourly tide, ft NAVD88, in hundredths (null = missing)
  devereux/events.json        every breach, closure and overtopping event, plus hourly
                              level-and-tide windows for the overtopping examples.
Tide is for display beside the slough level only; it is never a model input.
"""
import csv
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PAC = ZoneInfo("America/Los_Angeles")
OUT = Path(__file__).resolve().parent.parent / "devereux"

# Overtopping examples shown on the page, keyed by start_utc (to the hour), with the copy.
# The step at each high tide is the signal; the berm crest is well above the still-water
# tide, so waves running up the beach at high tide likely carry most of the water over.
# In 2026 the tide itself ran unusually high (surge, then high sea level).
EXAMPLES = {
    "2026-05-16T05": ("Storm surge tops the berm, May 2026",
                      "Spring tides ran about half a foot above the prediction. Three high tides "
                      "reached up to 7.2 ft and each one stepped the slough up, adding about 0.5 ft "
                      "with no rain."),
    "2026-10-11T18": ("High sea level, October 2026",
                      "October 2026 ran nearly a foot above normal sea level, the highest anomaly "
                      "in the record, as in El Niño years. A 7.3 ft tide, 1.5 ft above the "
                      "prediction, coincided with a 0.2 ft jump in the slough within an hour."),
    "2025-08-12T07": ("Waves at high tide, August 2025",
                      "Ordinary tides with little surge (0.1 ft), yet the slough stepped up at "
                      "each high tide, about 1.1 ft over three days with no rain. Summer swell "
                      "running up the beach at high tide is the likely carrier."),
    "2020-05-05T05": ("Spring tides and waves, May 2020",
                      "Five high tides in a row stepped the slough up about 1 ft in four days, with "
                      "spring tides about 0.3 ft above the prediction and no rain to speak of."),
}


def utc(s):
    return datetime.strptime(s[:16].replace("Z", ""), "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)


def local_iso(dt):
    return dt.astimezone(PAC).strftime("%Y-%m-%dT%H:%M")


def main(res):
    res = Path(res)
    # tide: contiguous hourly series from the first row
    rows = [r for r in csv.reader(l for l in open(res / "tide_hourly.csv") if not l.startswith("#"))][1:]
    t0 = utc(rows[0][0])
    obs, pred = [], []
    for i, (t, o, p) in enumerate(rows):
        assert utc(t) == t0 + timedelta(hours=i), f"tide gap at {t}"
        obs.append(round(float(o) * 100) if o else None)
        pred.append(round(float(p) * 100) if p else None)
    last_obs = max(i for i, v in enumerate(obs) if v is not None)
    tide = {"station": "NOAA 9411340 Santa Barbara", "datum": "NAVD88", "units": "0.01 ft",
            "start_utc": t0.strftime("%Y-%m-%dT%H:%MZ"), "step_h": 1,
            "observed_through_utc": (t0 + timedelta(hours=last_obs)).strftime("%Y-%m-%dT%H:%MZ"),
            "observed": obs, "predicted": pred}
    (OUT / "tide-history.json").write_text(json.dumps(tide, separators=(",", ":")))
    tide_at = {t0 + timedelta(hours=i): (obs[i], pred[i]) for i in range(len(obs))}

    # hourly slough level (Pacific local clock time)
    level = {}
    for r in csv.DictReader(open(res / "hourly_level.csv")):
        try:
            level[datetime.strptime(r["time"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=PAC)] = float(r["level_ft"])
        except (ValueError, TypeError):
            continue

    events = json.load(open(res / "mouth_events.json"))
    keep = ["type", "peak_level_ft", "tide_high_ft", "surge_ft", "rain_in", "logged", "provisional",
            "summer", "total_rise_ft", "max_step_ft", "sea_level_anomaly_ft", "note"]
    out = []
    for e in events:
        r = {k: e.get(k) for k in keep}
        r["start"] = local_iso(utc(e["start_utc"]))
        r["end"] = local_iso(utc(e["end_utc"]))
        if e.get("tide_high_time_utc"):
            r["tide_high_time"] = local_iso(utc(e["tide_high_time_utc"]))
        out.append(r)

    examples = []
    for e in events:
        key = e["start_utc"][:13]
        if e["type"] != "overtopping" or key not in EXAMPLES:
            continue
        a, b = utc(e["start_utc"]) - timedelta(days=2), utc(e["end_utc"]) + timedelta(days=2)
        pts = []
        t = a
        while t <= b:
            lv = level.get(t.astimezone(PAC).replace(minute=0, second=0, microsecond=0))
            o, p = tide_at.get(t, (None, None))
            pts.append([local_iso(t), lv, None if o is None else o / 100, None if p is None else p / 100])
            t += timedelta(hours=1)
        title, text = EXAMPLES[key]
        examples.append({"title": title, "text": text, "start": local_iso(utc(e["start_utc"])),
                         "end": local_iso(utc(e["end_utc"])), "tide_high_ft": e["tide_high_ft"],
                         "surge_ft": e["surge_ft"], "total_rise_ft": e.get("total_rise_ft"), "hourly": pts})
    missing = set(EXAMPLES) - {x for x in (e["start_utc"][:13] for e in events)}
    assert not missing, f"examples not in the catalog: {missing}"
    examples.sort(key=lambda x: x["start"], reverse=True)
    doc = {"exported": datetime.now(PAC).strftime("%Y-%m-%d"),
           "_note": "Times are Pacific local. Provisional events come from the level record and await review.",
           "events": out, "examples": examples}
    (OUT / "events.json").write_text(json.dumps(doc, separators=(",", ":")))
    print(f"tide: {len(obs)} hours from {tide['start_utc']}; events: {len(out)}; examples: {len(examples)}")


if __name__ == "__main__":
    main(sys.argv[1])
