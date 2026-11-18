#!/usr/bin/env python3
"""Pull Google Ads results into data/google_rows.csv, data/google_breakdowns.csv and
data/search_terms.csv. READ-ONLY: it only runs reports (GAQL searches).

You need (in ads-dashboard/.env):
  GOOGLE_ADS_DEVELOPER_TOKEN     from your Google Ads manager account: Tools > API Center
  GOOGLE_ADS_CLIENT_ID           an OAuth client (Google Cloud console, type "Desktop app")
  GOOGLE_ADS_CLIENT_SECRET
  GOOGLE_ADS_REFRESH_TOKEN       made once with that client, for a Google user who can see the accounts
  GOOGLE_ADS_LOGIN_CUSTOMER_ID   optional: your manager (MCC) account id, digits only
  GOOGLE_ADS_API_VERSION         optional, e.g. v21 (use the current version from Google's docs)

Which accounts: every account with "platform": "google" in config/clients.json
(account_id = the 10-digit customer id, digits only).
Results = the account's "Conversions" column (primary conversion actions).

  python3 connectors/fetch_google.py            # last 42 days
  python3 connectors/fetch_google.py --days 90
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from common import BREAKDOWN_FIELDS, ROW_FIELDS, accounts_for, date_range, load_env, need, write_rows


def access_token():
    body = urllib.parse.urlencode({
        "client_id": need("GOOGLE_ADS_CLIENT_ID"), "client_secret": need("GOOGLE_ADS_CLIENT_SECRET"),
        "refresh_token": need("GOOGLE_ADS_REFRESH_TOKEN"), "grant_type": "refresh_token"}).encode()
    try:
        with urllib.request.urlopen("https://oauth2.googleapis.com/token", body, timeout=30) as r:
            return json.load(r)["access_token"]
    except urllib.error.HTTPError as e:
        sys.exit(f"Google sign-in failed ({e.code}). Check the client id/secret and refresh token.")


def search(customer, query, token):
    ver = os.environ.get("GOOGLE_ADS_API_VERSION", "v21")
    url = f"https://googleads.googleapis.com/{ver}/customers/{customer}/googleAds:searchStream"
    headers = {"Authorization": f"Bearer {token}", "developer-token": need("GOOGLE_ADS_DEVELOPER_TOKEN"),
               "Content-Type": "application/json"}
    login = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "").replace("-", "").strip()
    if login:
        headers["login-customer-id"] = login
    req = urllib.request.Request(url, json.dumps({"query": query}).encode(), headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            chunks = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Google Ads API error {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")
    for chunk in chunks:
        for row in chunk.get("results", []):
            yield row


def money(micros):
    return round(int(micros or 0) / 1_000_000, 2)


def main():
    load_env()
    days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 42
    since, until = date_range(days)
    b_since, _ = date_range(7)
    token = access_token()
    rows, bds, terms = [], [], []
    for client, acct in accounts_for("google"):
        cid = str(acct["account_id"]).replace("-", "")
        print(f"{client['name']}: customer {cid}")
        where = f"segments.date BETWEEN '{since}' AND '{until}'"
        # 1) Search / Display / Video ads (ad level)
        q = ("SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, "
             "ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, "
             "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, "
             f"metrics.conversions_value FROM ad_group_ad WHERE {where} AND ad_group_ad.status != 'REMOVED'")
        for r in search(cid, q, token):
            c, g, a, m = r["campaign"], r["adGroup"], r["adGroupAd"], r["metrics"]
            ad = a.get("ad", {})
            rows.append({"date": r["segments"]["date"], "platform": "google", "account_id": cid,
                         "campaign_id": c["id"], "campaign": c["name"], "adset_id": g["id"], "adset": g["name"],
                         "ad_id": f"{g['id']}~{ad.get('id', '')}", "ad": ad.get("name") or f"Ad {ad.get('id', '')}",
                         "spend": money(m.get("costMicros")), "impressions": m.get("impressions", 0),
                         "clicks": m.get("clicks", 0), "results": m.get("conversions", 0),
                         "revenue": m.get("conversionsValue", 0),
                         "daily_budget": money(r.get("campaignBudget", {}).get("amountMicros")),
                         "campaign_status": "ACTIVE" if c.get("status") == "ENABLED" else c.get("status", ""),
                         "ad_status": "ACTIVE" if a.get("status") == "ENABLED" else a.get("status", ""),
                         "thumbnail_url": ""})
        # 2) Performance Max has no ad rows: take it at campaign level
        q = ("SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, "
             "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value "
             f"FROM campaign WHERE {where} AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'")
        for r in search(cid, q, token):
            c, m = r["campaign"], r["metrics"]
            rows.append({"date": r["segments"]["date"], "platform": "google", "account_id": cid,
                         "campaign_id": c["id"], "campaign": c["name"], "adset_id": c["id"], "adset": "Performance Max",
                         "ad_id": f"pmax-{c['id']}", "ad": "Performance Max assets",
                         "spend": money(m.get("costMicros")), "impressions": m.get("impressions", 0),
                         "clicks": m.get("clicks", 0), "results": m.get("conversions", 0),
                         "revenue": m.get("conversionsValue", 0),
                         "daily_budget": money(r.get("campaignBudget", {}).get("amountMicros")),
                         "campaign_status": "ACTIVE" if c.get("status") == "ENABLED" else c.get("status", ""),
                         "ad_status": "ACTIVE", "thumbnail_url": ""})
        # 3) Breakdowns, last 7 days
        bwhere = f"segments.date BETWEEN '{b_since}' AND '{until}'"
        for dim, seg, label in [("device", "segments.device", "Device (Google)"),
                                ("network_type", "segments.ad_network_type", "Network (Google)")]:
            q = (f"SELECT segments.date, {seg}, metrics.cost_micros, metrics.impressions, metrics.clicks, "
                 f"metrics.conversions FROM customer WHERE {bwhere}")
            key = seg.split(".")[1]
            camel = "".join(w.title() if i else w for i, w in enumerate(key.split("_")))
            for r in search(cid, q, token):
                m = r["metrics"]
                bds.append({"date": r["segments"]["date"], "platform": "google", "account_id": cid,
                            "dimension": dim, "label": label, "value": r["segments"].get(camel, ""),
                            "spend": money(m.get("costMicros")), "impressions": m.get("impressions", 0),
                            "clicks": m.get("clicks", 0), "results": m.get("conversions", 0)})
        # 4) Search terms over the whole window
        q = ("SELECT search_term_view.search_term, metrics.cost_micros, metrics.clicks, metrics.conversions "
             f"FROM search_term_view WHERE {where} ORDER BY metrics.cost_micros DESC LIMIT 200")
        agg = {}
        for r in search(cid, q, token):
            t = r["searchTermView"]["searchTerm"]
            m = r["metrics"]
            x = agg.setdefault(t, {"account_id": cid, "term": t, "cost": 0.0, "clicks": 0, "conversions": 0.0})
            x["cost"] += money(m.get("costMicros"))
            x["clicks"] += int(m.get("clicks", 0))
            x["conversions"] += float(m.get("conversions", 0))
        terms.extend(agg.values())
    write_rows("google_rows.csv", ROW_FIELDS, rows)
    write_rows("google_breakdowns.csv", BREAKDOWN_FIELDS, bds)
    write_rows("search_terms.csv", ["account_id", "term", "cost", "clicks", "conversions"], terms)


if __name__ == "__main__":
    main()
