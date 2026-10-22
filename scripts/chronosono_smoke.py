#!/usr/bin/env python3
"""Smoke test for a deployed ChronoSono game API: plays one turn with three fake phones.

Usage: python scripts/chronosono_smoke.py https://deploy-preview-36--example.netlify.app
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


def call(base: str, method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{base}/chronosono/api/{path}", data=data, method=method,
                                 headers={"Content-Type": "application/json", "User-Agent": "chronosono-smoke"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")


def main(base: str) -> None:
    base = base.rstrip("/")
    host, dj, jets = "smokehost0001", "smokedj000001", "smokejets0001"
    v = call(base, "POST", "rooms", {"deviceId": host, "role": "team", "name": "Sharks"})
    code = v["code"]
    print(f"room {code}, {v['songsInRange']} songs in default range")
    act = lambda device, type_, **kw: call(base, "POST", f"rooms/{code}/actions", {"deviceId": device, "type": type_, **kw})
    act(dj, "join", role="dj")
    act(jets, "join", role="team", name="Jets")
    act(host, "config", config={"yearMin": 1960, "yearMax": 2025, "target": 5})
    act(host, "start")
    v = act(dj, "next")
    assert v["spotify"] and len(v["spotify"]) == 22, "DJ phone did not get a Spotify ID"
    team_view = call(base, "GET", f"rooms/{code}?device={host}")
    assert team_view["game"]["current"] is None and team_view["spotify"] is None, "song leaked to a team phone"
    act(dj, "played", nonce=v["play"]["nonce"])
    active = host if team_view["game"]["turn"] == 0 else jets
    other = jets if active == host else host
    act(active, "place", gap=0)
    v = act(active, "lock")
    if v["stage"] == "challenge":
        v = act(other, "pass")
    assert v["stage"] == "judge", v["stage"]
    v = act(other, "judge", named=False)
    assert v["stage"] == "result"
    card = v["game"]["result"]["card"]
    print(f"revealed {card['title']} ({card['year']}), outcome {v['game']['result']['outcome']}")
    unchanged = call(base, "GET", f"rooms/{code}?device={host}&since={v['version']}")
    assert unchanged.get("unchanged"), "polling with the current version should return a short reply"
    act(host, "end")
    print("Smoke test passed.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
