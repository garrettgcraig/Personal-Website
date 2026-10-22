#!/usr/bin/env python3
"""
flickr_by_date.py — Find your own Flickr photos (public or private) taken on
given dates, so you can pick some for a Trail Log entry.

Flickr only returns private photos to a signed-in caller, so this script
uses read-only OAuth. It never edits, deletes, or shares anything.

ONE-TIME SETUP:
    1. In a .env file at the repo root (git-ignored), add your Flickr app's
       key and secret from https://www.flickr.com/services/apps/ :
           FLICKR_API_KEY=...
           FLICKR_API_SECRET=...
    2. python3 scripts/flickr_by_date.py auth
       Open the link it prints, approve read access, and paste the code
       Flickr shows back into the terminal. The token is saved to .env.

USAGE:
    # Contact sheet of everything taken May 23-29, 2024 (opens in a browser)
    python3 scripts/flickr_by_date.py list 2024-05-23 2024-05-29

    # Download picks at 1600px into a trail-log photo folder
    python3 scripts/flickr_by_date.py download trail-log/photos/isle-royale-2024 \
        54670724929 54669741202

DEPENDENCIES:
    pip install requests
"""

import base64
import hashlib
import hmac
import html
import json
import os
import secrets
import sys
import time
import urllib.parse
from datetime import date, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
REST = "https://api.flickr.com/services/rest/"
REQUEST_TOKEN = "https://www.flickr.com/services/oauth/request_token"
AUTHORIZE = "https://www.flickr.com/services/oauth/authorize"
ACCESS_TOKEN = "https://www.flickr.com/services/oauth/access_token"
# Largest first; downloads take the first size at or under 1600px.
DOWNLOAD_SIZES = ["Large 1600", "Large", "Medium 800", "Medium 640"]


# ── .env ──────────────────────────────────────────────────────────────────────

def read_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, _, value = line.partition("=")
                env[key.strip()] = value.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k.startswith("FLICKR_")})
    return env


def save_env(updates):
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    lines = [l for l in lines if l.partition("=")[0].strip() not in updates]
    lines += ["%s=%s" % (k, v) for k, v in updates.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n")
    os.chmod(ENV_PATH, 0o600)


def require(env, *keys):
    missing = [k for k in keys if not env.get(k)]
    if missing:
        sys.exit("Missing %s in %s. See the setup notes at the top of this script."
                 % (", ".join(missing), ENV_PATH))


# ── OAuth 1.0a (HMAC-SHA1) ────────────────────────────────────────────────────

def _quote(value):
    return urllib.parse.quote(str(value), safe="~")


def oauth_signature(method, url, params, consumer_secret, token_secret=""):
    """RFC 5849 signature over the method, base URL, and sorted parameters."""
    pairs = sorted((_quote(k), _quote(v)) for k, v in params.items())
    normalized = "&".join("%s=%s" % kv for kv in pairs)
    base = "&".join([method.upper(), _quote(url), _quote(normalized)])
    key = "%s&%s" % (_quote(consumer_secret), _quote(token_secret))
    digest = hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def signed_get(url, env, extra, token="", token_secret=""):
    params = {
        "oauth_consumer_key": env["FLICKR_API_KEY"],
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_version": "1.0",
        **extra,
    }
    if token:
        params["oauth_token"] = token
    params["oauth_signature"] = oauth_signature("GET", url, params, env["FLICKR_API_SECRET"], token_secret)
    r = requests.get(url, params=params, timeout=30)
    if r.status_code != 200:
        sys.exit("Flickr returned %s: %s" % (r.status_code, r.text[:300]))
    return r


def api(env, method, **extra):
    require(env, "FLICKR_API_KEY", "FLICKR_API_SECRET", "FLICKR_OAUTH_TOKEN", "FLICKR_OAUTH_TOKEN_SECRET")
    r = signed_get(REST, env, {"method": method, "format": "json", "nojsoncallback": "1", **extra},
                   env["FLICKR_OAUTH_TOKEN"], env["FLICKR_OAUTH_TOKEN_SECRET"])
    data = r.json()
    if data.get("stat") != "ok":
        sys.exit("Flickr API error: %s" % data.get("message", data))
    return data


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_auth(env):
    require(env, "FLICKR_API_KEY", "FLICKR_API_SECRET")
    r = signed_get(REQUEST_TOKEN, env, {"oauth_callback": "oob"})
    req = dict(urllib.parse.parse_qsl(r.text))
    print("\nOpen this link, approve read-only access, then copy the code Flickr shows:\n")
    print("  %s?oauth_token=%s&perms=read\n" % (AUTHORIZE, req["oauth_token"]))
    verifier = input("Code from Flickr: ").strip()
    r = signed_get(ACCESS_TOKEN, env, {"oauth_verifier": verifier},
                   req["oauth_token"], req["oauth_token_secret"])
    acc = dict(urllib.parse.parse_qsl(r.text))
    save_env({
        "FLICKR_OAUTH_TOKEN": acc["oauth_token"],
        "FLICKR_OAUTH_TOKEN_SECRET": acc["oauth_token_secret"],
        "FLICKR_USER_NSID": acc.get("user_nsid", ""),
    })
    print("Signed in as %s. Token saved to %s." % (acc.get("username", "?"), ENV_PATH))


def search(env, first, last):
    """All of your photos taken from `first` through `last` (inclusive)."""
    photos, page = [], 1
    while True:
        data = api(env, "flickr.photos.search",
                   user_id="me",
                   min_taken_date="%s 00:00:00" % first,
                   max_taken_date="%s 23:59:59" % last,
                   extras="date_taken,url_q,url_z,url_l,url_h,geo,tags",
                   sort="date-taken-asc", per_page="500", page=str(page))["photos"]
        photos += data["photo"]
        if page >= int(data["pages"]):
            return photos
        page += 1


def cmd_list(env, first, last, out=None):
    first, last = date.fromisoformat(first), date.fromisoformat(last)
    photos = search(env, first, last)
    out = Path(out or ROOT / ".flickr-picks" / ("%s_%s.html" % (first, last)))
    out.parent.mkdir(parents=True, exist_ok=True)
    by_day = {}
    for p in photos:
        by_day.setdefault(p["datetaken"][:10], []).append(p)
    cards = []
    d = first
    while d <= last:
        day = by_day.get(d.isoformat(), [])
        cards.append("<h2>%s · %d photos</h2><div class=grid>" % (d.strftime("%A, %B %-d, %Y"), len(day)))
        for p in day:
            private = "" if p.get("ispublic") else '<span class=lock>private</span>'
            cards.append(
                '<figure><a href="%s" target=_blank><img src="%s" loading=lazy></a>'
                "<figcaption><code>%s</code> %s<br>%s %s</figcaption></figure>"
                % (html.escape(p.get("url_l") or p.get("url_z", "")), html.escape(p.get("url_z") or p.get("url_q", "")),
                   p["id"], html.escape(p["datetaken"][11:16]), html.escape(p.get("title", "")), private))
        cards.append("</div>")
        d += timedelta(days=1)
    out.write_text(
        "<!doctype html><meta charset=utf-8><title>Flickr %s to %s</title>"
        "<style>body{font:15px system-ui;margin:24px;background:#F6F6F2;color:#1B2530}"
        ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}"
        "img{width:100%%;aspect-ratio:4/3;object-fit:cover;border-radius:6px}figure{margin:0}"
        "code{background:#ECEDE7;padding:1px 4px;border-radius:4px;user-select:all}"
        ".lock{color:#A65A3C;font-size:12px}</style>"
        "<h1>Flickr photos, %s to %s</h1><p>Click an ID to select it, then pass the IDs to "
        "<code>flickr_by_date.py download</code>.</p>%s" % (first, last, first, last, "".join(cards)))
    json_path = out.with_suffix(".json")
    json_path.write_text(json.dumps(photos, indent=1))
    print("%d photos. Contact sheet: %s" % (len(photos), out))


def cmd_download(env, dest, ids):
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    for photo_id in ids:
        sizes = {s["label"]: s for s in api(env, "flickr.photos.getSizes", photo_id=photo_id)["sizes"]["size"]}
        label = next((l for l in DOWNLOAD_SIZES if l in sizes), None)
        if not label:
            print("  %s: no size at or under 1600px, skipped" % photo_id)
            continue
        target = dest / ("%s.jpg" % photo_id)
        r = requests.get(sizes[label]["source"], timeout=60)
        r.raise_for_status()
        target.write_bytes(r.content)
        print("  %s -> %s (%s)" % (photo_id, target.relative_to(ROOT) if target.is_relative_to(ROOT) else target, label))


def main(argv):
    env = read_env()
    if len(argv) >= 1 and argv[0] == "auth":
        return cmd_auth(env)
    if len(argv) in (3, 4) and argv[0] == "list":
        return cmd_list(env, *argv[1:])
    if len(argv) >= 3 and argv[0] == "download":
        return cmd_download(env, argv[1], argv[2:])
    sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
