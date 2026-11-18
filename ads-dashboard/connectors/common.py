"""Small helpers shared by the connectors (standard library only)."""
import csv
import datetime as dt
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ROW_FIELDS = ["date", "platform", "account_id", "campaign_id", "campaign", "adset_id", "adset", "ad_id", "ad",
              "spend", "impressions", "clicks", "results", "revenue", "daily_budget", "campaign_status",
              "ad_status", "thumbnail_url"]
BREAKDOWN_FIELDS = ["date", "platform", "account_id", "dimension", "label", "value", "spend", "impressions",
                    "clicks", "results"]


def load_env():
    """Read ads-dashboard/.env (KEY=value lines) into os.environ. Real environment variables win."""
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def need(name):
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"Missing {name}. Put it in ads-dashboard/.env (see .env.example).")
    return v


def load_clients():
    p = os.path.join(ROOT, "config", "clients.json")
    if not os.path.exists(p):
        sys.exit("config/clients.json is missing. Copy demo/config/clients.json to config/ and edit it.")
    return json.load(open(p, encoding="utf-8"))


def accounts_for(platform):
    for c in load_clients()["clients"]:
        for a in c["accounts"]:
            if a["platform"] == platform:
                yield c, a


def date_range(days):
    """The last `days` full days, ending yesterday."""
    end = dt.date.today() - dt.timedelta(days=1)
    return end - dt.timedelta(days=days - 1), end


def write_rows(name, fields, rows):
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    p = os.path.join(ROOT, "data", name)
    with open(p, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"wrote data/{name}: {len(rows)} rows")
