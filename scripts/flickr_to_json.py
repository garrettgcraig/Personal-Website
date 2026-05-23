"""
flickr_to_json.py

Fetches photos from one or more Flickr albums and outputs a photos.json
file for use in the garrettgcraig.com gallery.

Usage:
    python flickr_to_json.py

Output:
    photos.json — keyed by album theme, each entry has title, description,
                  and image URLs in multiple sizes.

Requirements:
    pip install requests python-dotenv

Setup:
    Create a .env file in the same directory as this script (already in .gitignore):
        FLICKR_API_KEY=your_api_key_here
"""

import requests
import json
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv optional; falls back to environment variables

# ── Config ────────────────────────────────────────────────────────────────────

API_KEY = os.environ.get("FLICKR_API_KEY")
if not API_KEY:
    print("✗ FLICKR_API_KEY not set. Add it to a .env file or export it as an environment variable.")
    sys.exit(1)
USER_ID = "38099003@N00"  # flickr.com/photos/ggc

# Add more albums here as you create them on Flickr.
# Key = theme label used on the website, Value = Flickr album (photoset) ID.
ALBUMS = {
    "highlights": "72177720329241105",
    "wildlife":   "72177720333803341",
    "macro":      "72177720333800335",
    "landscapes": "72177720333827079",
    "flora":      "72177720333815438",
}

# Number of photos to pull per album (max 500)
PHOTOS_PER_ALBUM = 50

# Flickr image size suffix to use as the main display image.
# Options (largest to smallest):
#   "url_o"  — original (can be huge)
#   "url_k"  — 2048px
#   "url_h"  — 1600px  ← good for full-screen display
#   "url_l"  — 1024px  ← good for gallery thumbnails
#   "url_c"  — 800px
#   "url_z"  — 640px
#   "url_m"  — 240px   ← thumbnail
DISPLAY_SIZE = "url_h"
THUMB_SIZE   = "url_z"

BASE_URL = "https://api.flickr.com/services/rest/"

# ── Helpers ───────────────────────────────────────────────────────────────────

def flickr_get(method, extra_params):
    params = {
        "method":         method,
        "api_key":        API_KEY,
        "format":         "json",
        "nojsoncallback": 1,
        **extra_params,
    }
    r = requests.get(BASE_URL, params=params, timeout=15)
    r.raise_for_status()
    data = r.json()
    if data.get("stat") != "ok":
        raise RuntimeError(f"Flickr API error: {data.get('message', data)}")
    return data


def get_album_info(photoset_id):
    data = flickr_get("flickr.photosets.getInfo", {
        "photoset_id": photoset_id,
        "user_id":     USER_ID,
    })
    info = data["photoset"]
    return {
        "title":       info["title"]["_content"],
        "description": info["description"]["_content"],
    }


def get_album_photos(photoset_id, per_page=50):
    """Returns list of photo dicts with URLs and metadata."""
    extras = ",".join([
        DISPLAY_SIZE, THUMB_SIZE,
        "url_o", "url_k", "url_l", "url_m",  # fetch all common sizes
        "title", "description",
        "date_taken", "geo",
        "tags",
    ])
    data = flickr_get("flickr.photosets.getPhotos", {
        "photoset_id": photoset_id,
        "user_id":     USER_ID,
        "extras":      extras,
        "per_page":    per_page,
        "page":        1,
    })

    photos = []
    for p in data["photoset"]["photo"]:
        # Pick best available display URL
        display_url = (
            p.get(DISPLAY_SIZE) or
            p.get("url_k") or
            p.get("url_l") or
            p.get("url_c") or
            p.get("url_z")
        )
        thumb_url = p.get(THUMB_SIZE) or p.get("url_m")

        if not display_url:
            print(f"  ⚠ Skipping photo {p['id']} — no usable URL found")
            continue

        photos.append({
            "id":          p["id"],
            "title":       p.get("title", ""),
            "description": p.get("description", {}).get("_content", "") if isinstance(p.get("description"), dict) else "",
            "date_taken":  p.get("datetaken", ""),
            "tags":        p.get("tags", ""),
            "display_url": display_url,
            "thumb_url":   thumb_url,
            "flickr_url":  f"https://www.flickr.com/photos/{USER_ID}/{p['id']}",
            "width":       p.get(f"{DISPLAY_SIZE.replace('url_', 'width_')}", None) or p.get("width_h"),
            "height":      p.get(f"{DISPLAY_SIZE.replace('url_', 'height_')}", None) or p.get("height_h"),
        })

    return photos


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    output = {}

    for theme, photoset_id in ALBUMS.items():
        print(f"\nFetching album: {theme} (ID: {photoset_id})")

        try:
            info   = get_album_info(photoset_id)
            photos = get_album_photos(photoset_id, per_page=PHOTOS_PER_ALBUM)
        except Exception as e:
            print(f"  ✗ Failed: {e}")
            sys.exit(1)

        print(f"  ✓ {len(photos)} photos retrieved from '{info['title']}'")

        output[theme] = {
            "album_title":       info["title"],
            "album_description": info["description"],
            "photos":            photos,
        }

    out_path = "photos.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Saved {out_path}")
    total = sum(len(v["photos"]) for v in output.values())
    print(f"  {total} photos across {len(output)} album(s)")


if __name__ == "__main__":
    main()
