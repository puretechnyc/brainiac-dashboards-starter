#!/usr/bin/env python3
"""Pull Meta (Facebook / Instagram) ad results into data/meta_rows.csv and
data/meta_breakdowns.csv. READ-ONLY: it never changes anything in your ad account.

You need (in ads-dashboard/.env):
  META_ACCESS_TOKEN   a token with the ads_read permission for your ad accounts
                      (a System User token from Business Settings is best: it does not expire)
  META_API_VERSION    optional, e.g. v21.0

Which accounts: every account with "platform": "meta" in config/clients.json.
Which result counts: set "meta_result_action" on the account, e.g.
  "offsite_conversion.fb_pixel_purchase"   website purchases (pixel)
  "lead"                                   website leads (pixel)
  "onsite_conversion.lead_grouped"         Instant Form leads
If you leave it out: purchase accounts use pixel purchases, everything else uses "lead".

  python3 connectors/fetch_meta.py            # last 42 days
  python3 connectors/fetch_meta.py --days 90
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from common import BREAKDOWN_FIELDS, ROW_FIELDS, accounts_for, date_range, load_env, need, write_rows

DEFAULT_ACTION = {"purchase": "offsite_conversion.fb_pixel_purchase"}


def get(url, params):
    q = urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 500, 503) and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            sys.exit(f"Meta API error {e.code}: {body}")
    return {}


def paged(url, params):
    data = get(url, params)
    while True:
        for row in data.get("data", []):
            yield row
        nxt = data.get("paging", {}).get("next")
        if not nxt:
            return
        with urllib.request.urlopen(nxt, timeout=60) as r:
            data = json.load(r)


def pick(actions, action_type):
    for a in actions or []:
        if a.get("action_type") == action_type:
            return float(a.get("value", 0))
    return 0.0


def main():
    load_env()
    token = need("META_ACCESS_TOKEN")
    ver = os.environ.get("META_API_VERSION", "v21.0")
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 42
    since, until = date_range(days)
    base = f"https://graph.facebook.com/{ver}"
    rows, bds = [], []
    for client, acct in accounts_for("meta"):
        act = "act_" + str(acct["account_id"]).replace("act_", "")
        action = acct.get("meta_result_action") or DEFAULT_ACTION.get(acct.get("result_type"), "lead")
        print(f"{client['name']}: {act} (results = {action})")
        # budgets + statuses (current values)
        budgets, cstatus = {}, {}
        for c in paged(f"{base}/{act}/campaigns", {"access_token": token, "limit": 200,
                                                     "fields": "id,effective_status,daily_budget"}):
            budgets[c["id"]] = float(c.get("daily_budget", 0)) / 100 if c.get("daily_budget") else ""
            cstatus[c["id"]] = c.get("effective_status", "")
        ads = {}
        for a in paged(f"{base}/{act}/ads", {"access_token": token, "limit": 200,
                                               "fields": "id,effective_status,creative{thumbnail_url}"}):
            ads[a["id"]] = (a.get("effective_status", ""), (a.get("creative") or {}).get("thumbnail_url", ""))
        common = {"access_token": token, "level": "ad", "time_increment": 1, "limit": 500,
                  "time_range": json.dumps({"since": since.isoformat(), "until": until.isoformat()})}
        for r in paged(f"{base}/{act}/insights", {**common, "fields":
                       "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions,action_values"}):
            st, thumb = ads.get(r["ad_id"], ("", ""))
            rows.append({"date": r["date_start"], "platform": "meta", "account_id": str(acct["account_id"]),
                         "campaign_id": r["campaign_id"], "campaign": r["campaign_name"], "adset_id": r["adset_id"],
                         "adset": r["adset_name"], "ad_id": r["ad_id"], "ad": r["ad_name"],
                         "spend": r.get("spend", 0), "impressions": r.get("impressions", 0),
                         "clicks": r.get("clicks", 0), "results": pick(r.get("actions"), action),
                         "revenue": pick(r.get("action_values"), action),
                         "daily_budget": budgets.get(r["campaign_id"], ""),
                         "campaign_status": cstatus.get(r["campaign_id"], ""), "ad_status": st, "thumbnail_url": thumb})
        # breakdowns for the last 7 days
        b_since, b_until = date_range(7)
        bcommon = {"access_token": token, "level": "account", "time_increment": 1, "limit": 500,
                   "fields": "spend,impressions,clicks,actions",
                   "time_range": json.dumps({"since": b_since.isoformat(), "until": b_until.isoformat()})}
        for dim, brk, label in [("placement", "publisher_platform,platform_position", "Placement (Meta)"),
                                ("age_gender", "age,gender", "Age / gender (Meta)"),
                                ("impression_device", "impression_device", "Device (Meta)")]:
            for r in paged(f"{base}/{act}/insights", {**bcommon, "breakdowns": brk}):
                value = "|".join(str(r.get(k, "")) for k in brk.split(","))
                bds.append({"date": r["date_start"], "platform": "meta", "account_id": str(acct["account_id"]),
                            "dimension": dim, "label": label, "value": value, "spend": r.get("spend", 0),
                            "impressions": r.get("impressions", 0), "clicks": r.get("clicks", 0),
                            "results": pick(r.get("actions"), action)})
    write_rows("meta_rows.csv", ROW_FIELDS, rows)
    write_rows("meta_breakdowns.csv", BREAKDOWN_FIELDS, bds)


if __name__ == "__main__":
    main()
