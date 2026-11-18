#!/usr/bin/env python3
"""Write the FAKE demo dataset into demo/ (config, ad rows, breakdowns, search terms,
plans, learnings). Every business, account id and number here is made up.

  python3 builder/make_demo_data.py                 # writes demo/...
  python3 builder/build_data.py --source demo       # turns it into public/data.json
"""
import csv
import datetime as dt
import json
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "demo")
DAYS = 42
rnd = random.Random(7)

CLIENTS = {
    "settings": {"timezone": "America/New_York", "flag_min_spend": 50,
                 "run_note": "Demo data: every number on this page is made up."},
    "clients": [
        {"name": "Corner Cafe", "currency": "USD",
         "goal": {"kind": "ecom", "cost_target": 18, "count_noun": "Online orders",
                  "cost_label": "Cost per online order",
                  "notes": ["$18 max per online order (average order is about $32)"]},
         "accounts": [{"platform": "meta", "account_id": "100000000000001", "account_name": "Corner Cafe (Meta)",
                       "result_type": "purchase", "conversion_event": "Purchase"}]},
        {"name": "Bright Dental", "currency": "USD",
         "goal": {"kind": "leads", "cost_target": None, "count_noun": "Leads (Google + Meta)",
                  "cost_label": "Blended cost per lead", "platform_targets": {"google": 70, "meta": 25},
                  "monthly_target": 60, "monthly_stretch": 75, "monthly_note": "60+ new-patient leads a month",
                  "target_text": "Per platform: Google $70/lead, Meta $25/lead",
                  "notes": ["New-patient leads: calls and form fills"]},
         "accounts": [{"platform": "google", "account_id": "1234567890", "account_name": "Bright Dental (Google)",
                       "result_type": "call", "conversion_event": "Calls from ads"},
                      {"platform": "meta", "account_id": "100000000000002", "account_name": "Bright Dental (Meta)",
                       "result_type": "lead", "conversion_event": "Lead form"}]},
        {"name": "Green Thumb Landscaping", "currency": "USD",
         "goal": {"kind": "leads", "cost_target": 45, "count_noun": "Quote requests",
                  "cost_label": "Cost per quote request",
                  "notes": ["$45 max per quote request in the service area"]},
         "accounts": [{"platform": "google", "account_id": "2345678901",
                       "account_name": "Green Thumb Landscaping (Google)", "result_type": "lead",
                       "conversion_event": "Quote form submit"}]},
    ],
}

# account_id -> list of (campaign, adset, [ads], daily budget, cost per result, revenue per result)
STRUCTURE = {
    "100000000000001": [
        ("Cafe | Online orders | Local 5mi", "Broad 18-65", ["Latte art video", "Breakfast combo carousel", "Weekend brunch photo"], 35, 15, 31),
        ("Cafe | Retargeting | Site visitors 30d", "Visitors 30d", ["Come back offer", "Menu highlight"], 12, 9, 28),
        ("Cafe | Test | Catering lunch boxes", "Office workers", ["Lunch box hero", "Team lunch UGC"], 15, 55, 120),
    ],
    "1234567890": [
        ("Search | Emergency dentist", "Emergency terms", ["Emergency RSA 1", "Emergency RSA 2"], 40, 42, 0),
        ("Search | Teeth whitening", "Whitening terms", ["Whitening RSA"], 20, 55, 0),
        ("Performance Max | New patients", "Asset group 1", ["PMax assets"], 30, 60, 0),
    ],
    "100000000000002": [
        ("Leads | New patient offer | Form", "Parents 28-55", ["Free exam video", "Smile gallery carousel"], 25, 22, 0),
        ("Leads | Invisalign | Form", "Adults 25-45", ["Invisalign before/after", "Doctor intro video"], 18, 34, 0),
    ],
    "2345678901": [
        ("Search | Lawn care", "Lawn care terms", ["Lawn RSA 1", "Lawn RSA 2"], 30, 32, 0),
        ("Search | Landscape design", "Design terms", ["Design RSA"], 25, 70, 0),
    ],
}

ACCT_PLATFORM = {a["account_id"]: a["platform"] for c in CLIENTS["clients"] for a in c["accounts"]}


def write_csv(path, fields, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def main():
    end = dt.date.today() - dt.timedelta(days=1)
    start = end - dt.timedelta(days=DAYS - 1)
    rows, bds = [], []
    ad_seq = 0
    for acct, camps in STRUCTURE.items():
        platform = ACCT_PLATFORM[acct]
        for ci, (camp, adset, ads, budget, cpr, rev) in enumerate(camps):
            # the catering test starts late and goes badly; the whitening campaign gets worse
            for ai, ad in enumerate(ads):
                ad_seq += 1
                ad_id = f"9{ad_seq:05d}"
                share = [0.5, 0.3, 0.2][ai] if len(ads) == 3 else [0.6, 0.4][ai] if len(ads) == 2 else 1.0
                for i in range(DAYS):
                    day = start + dt.timedelta(days=i)
                    if "Test" in camp and i < DAYS - 12:
                        continue
                    trend = 1.0 + (0.6 if "whitening" in camp and i > DAYS - 8 else 0)
                    spend = round(budget * share * rnd.uniform(0.75, 1.15), 2)
                    eff = cpr * trend * rnd.uniform(0.7, 1.4)
                    expected = spend / eff
                    results = int(expected) + (1 if rnd.random() < expected - int(expected) else 0)
                    if "Test" in camp and i > DAYS - 8:
                        results = 0
                    impr = int(spend * rnd.uniform(60, 110) if platform == "meta" else spend * rnd.uniform(8, 20))
                    clicks = int(impr * (rnd.uniform(0.008, 0.02) if platform == "meta" else rnd.uniform(0.05, 0.11)))
                    rows.append({
                        "date": day.isoformat(), "platform": platform, "account_id": acct,
                        "campaign_id": f"{acct}-{ci}", "campaign": camp, "adset_id": f"{acct}-{ci}-0", "adset": adset,
                        "ad_id": ad_id, "ad": ad, "spend": spend, "impressions": impr, "clicks": clicks,
                        "results": results, "revenue": round(results * rev * rnd.uniform(0.8, 1.2), 2) if rev else 0,
                        "daily_budget": budget, "campaign_status": "ACTIVE",
                        "ad_status": "PAUSED" if ("Test" in camp and ai == 1) else "ACTIVE", "thumbnail_url": "",
                    })
        # 7-day breakdowns
        dims = {"meta": [("placement", ["facebook|feed", "instagram|feed", "instagram|reels", "audience_network|classic"]),
                         ("age_gender", ["25-34|female", "25-34|male", "35-44|female", "35-44|male", "45-54|female"]),
                         ("impression_device", ["iphone", "android_smartphone", "desktop"])],
                "google": [("device", ["MOBILE", "DESKTOP", "TABLET"]),
                           ("network_type", ["SEARCH", "SEARCH_PARTNERS", "CONTENT"])]}[platform]
        for i in range(7):
            day = end - dt.timedelta(days=i)
            day_spend = sum(r["spend"] for r in rows if r["date"] == day.isoformat() and r["account_id"] == acct)
            day_res = sum(r["results"] for r in rows if r["date"] == day.isoformat() and r["account_id"] == acct)
            for dim, values in dims:
                weights = [rnd.uniform(0.2, 1.0) for _ in values]
                tot = sum(weights)
                for v, wgt in zip(values, weights):
                    s = day_spend * wgt / tot
                    bds.append({"date": day.isoformat(), "platform": platform, "account_id": acct, "dimension": dim,
                                "label": "", "value": v, "spend": round(s, 2), "impressions": int(s * 40),
                                "clicks": int(s * 0.8), "results": round(day_res * wgt / tot, 1)})
    fields = ["date", "platform", "account_id", "campaign_id", "campaign", "adset_id", "adset", "ad_id", "ad",
              "spend", "impressions", "clicks", "results", "revenue", "daily_budget", "campaign_status",
              "ad_status", "thumbnail_url"]
    write_csv(os.path.join(OUT, "data", "ad_rows.csv"), fields, rows)
    write_csv(os.path.join(OUT, "data", "breakdowns.csv"),
              ["date", "platform", "account_id", "dimension", "label", "value", "spend", "impressions", "clicks", "results"], bds)
    terms = [("1234567890", "emergency dentist near me", 412.5, 61, 8), ("1234567890", "teeth whitening cost", 288.1, 40, 2),
             ("1234567890", "dentist open saturday", 154.2, 22, 3), ("1234567890", "free dental exam", 98.4, 19, 0),
             ("2345678901", "lawn care service", 366.0, 58, 9), ("2345678901", "landscape designer", 251.7, 31, 3),
             ("2345678901", "how to mow a lawn", 61.2, 14, 0), ("2345678901", "weekly lawn mowing", 120.9, 20, 4)]
    write_csv(os.path.join(OUT, "data", "search_terms.csv"), ["account_id", "term", "cost", "clicks", "conversions"],
              [{"account_id": a, "term": t, "cost": c, "clicks": k, "conversions": v} for a, t, c, k, v in terms])

    os.makedirs(os.path.join(OUT, "config"), exist_ok=True)
    with open(os.path.join(OUT, "config", "clients.json"), "w") as f:
        json.dump(CLIENTS, f, indent=2)

    today = end.isoformat()
    review = (end + dt.timedelta(days=3)).isoformat()
    plans = {
        "Corner Cafe": {
            "status_at_plan": "on_track", "mode": "scale", "owner": "Sam (ads)",
            "goal": "Online orders at $18 or less each, 60+ a month.",
            "diagnosis": "The local campaign is profitable. The catering test spent without orders in its last week.",
            "today": f"Review {today}: orders steady; catering test has had 0 orders for 7 days.",
            "tracking": "ONLINE. Purchase event fires on the order confirmation page.",
            "leak": "Catering test: spend with no orders.",
            "updated_on": today, "last_reviewed": today, "reviewed_at": today, "next_review": review,
            "note_asof": "as of " + end.strftime("%d %b"),
            "triggers": [{"rule": "Cost per order above $25 for 3 days", "action": "Cut the weakest ad set budget by 20%"}],
            "tests": [{"name": "Catering lunch boxes for offices", "status": "running", "owner": "Sam",
                       "hypothesis": "Office managers will order catering from a lunch-box ad.",
                       "metric": "Catering orders", "budget": "$15 a day", "started": (end - dt.timedelta(days=11)).isoformat(),
                       "read_on": review, "result": "Early orders, then none for 7 days.",
                       "decision_rule": "No order by the read date: stop the test."}],
            "closed_tests": [], "next_actions": [
                {"action": "Pause the catering test if no order by the read date", "owner": "Sam", "due": review,
                 "metric": "Catering orders", "read_on": review, "within_limits": "Yes", "stop_if": "0 orders"},
                {"action": "Add two new brunch photos to the local campaign", "owner": "Jo (design)", "due": review,
                 "metric": "CTR", "read_on": review, "within_limits": "Yes", "stop_if": "CTR below 1%"}],
            "open_decisions": ["Raise the local budget from $35 to $45 a day?"],
            "client_asks": ["Send 5 new photos of the weekend menu."], "cannot_measure": ["Walk-in visits from ads."],
            "summary": {"asof": today, "today": "On track overall; the catering test is the leak.",
                        "goal": "$18 per online order.", "diagnosis": "Local campaign profitable; test is not.",
                        "tracking": "Online.", "leak": "Catering test.", "tests": "1 test running, read on " + review},
        },
        "Bright Dental": {
            "status_at_plan": "watch", "mode": "steady", "owner": "Sam (ads)",
            "goal": "60+ new-patient leads a month; Google under $70 a lead, Meta under $25.",
            "diagnosis": "Meta form leads are cheap and steady. Google whitening costs rose this week.",
            "today": f"Review {today}: whitening cost per lead up; moving $5/day from whitening to emergency.",
            "tracking": "ONLINE. Google call conversions and Meta lead forms both firing.",
            "leak": "Teeth whitening search campaign.", "updated_on": today, "last_reviewed": today,
            "reviewed_at": today, "next_review": review, "note_asof": "as of " + end.strftime("%d %b"),
            "triggers": [{"rule": "Google cost per lead over $90 for a week", "action": "Pause the costliest campaign"}],
            "tests": [], "closed_tests": [],
            "next_actions": [{"action": "Add 'free exam' as a negative keyword", "owner": "Sam", "due": review,
                              "metric": "Wasted spend", "read_on": review, "within_limits": "Yes", "stop_if": ""}],
            "open_decisions": [], "client_asks": ["Confirm which leads booked an appointment."],
            "cannot_measure": ["Which leads became patients (no CRM link yet)."],
            "summary": {"asof": today, "today": "Watch: whitening cost per lead rising.", "goal": "60+ leads a month.",
                        "diagnosis": "Meta cheap, Google mixed.", "tracking": "Online.", "leak": "Whitening search.",
                        "tests": "No test running."},
        },
        "Green Thumb Landscaping": {
            "status_at_plan": "on_track", "mode": "steady", "owner": "Alex (ads)",
            "goal": "Quote requests at $45 or less.", "diagnosis": "Lawn care converts well; design is pricier but bigger jobs.",
            "today": f"Review {today}: steady. Adding negatives for DIY searches.",
            "tracking": "ONLINE. Quote form fires on the thank-you page.", "leak": "DIY searches ('how to ...').",
            "updated_on": today, "last_reviewed": today, "reviewed_at": today, "next_review": review,
            "note_asof": "as of " + end.strftime("%d %b"), "triggers": [], "tests": [], "closed_tests": [],
            "next_actions": [{"action": "Add 'how to' as a negative phrase", "owner": "Alex", "due": review,
                              "metric": "Wasted spend", "read_on": review, "within_limits": "Yes", "stop_if": ""}],
            "open_decisions": [], "client_asks": [], "cannot_measure": [],
            "summary": {"asof": today, "today": "On track.", "goal": "$45 per quote request.",
                        "diagnosis": "Lawn care strong.", "tracking": "Online.", "leak": "DIY searches.",
                        "tests": "No test running."},
        },
    }
    learnings = {
        "Corner Cafe": [{"date": (end - dt.timedelta(days=10)).isoformat(),
                         "learning": "Short latte-art videos get twice the click rate of menu photos.",
                         "evidence": "Meta-reported CTR, 14 days, similar spend.", "applied": "Video moved to the top ad set.",
                         "status": "confirmed", "source": "Weekly review"}],
        "Bright Dental": [{"date": (end - dt.timedelta(days=5)).isoformat(),
                           "learning": "Emergency searches convert best on weekends.",
                           "evidence": "Google-reported calls by day of week, 6 weeks.",
                           "applied": "Weekend bid increase of 15%.", "status": "provisional", "source": "Weekly review"}],
    }
    os.makedirs(os.path.join(OUT, "content"), exist_ok=True)
    with open(os.path.join(OUT, "content", "plans.json"), "w") as f:
        json.dump(plans, f, indent=2)
    with open(os.path.join(OUT, "content", "learnings.json"), "w") as f:
        json.dump(learnings, f, indent=2)
    print(f"wrote demo/ : {len(rows)} ad-day rows, {len(bds)} breakdown rows, {len(CLIENTS['clients'])} clients")


if __name__ == "__main__":
    main()
