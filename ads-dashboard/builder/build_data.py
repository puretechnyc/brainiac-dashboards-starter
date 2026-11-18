#!/usr/bin/env python3
"""Build public/data.json for the paid ads dashboard.

Inputs (all plain files, so any tool or AI can produce them):

  config/clients.json        who your clients are, which ad accounts belong to each,
                             and what "good" looks like (cost target, monthly goal)
  data/*rows.csv             one row per ad per day (meta_rows.csv from connectors/fetch_meta.py,
                             google_rows.csv from connectors/fetch_google.py, or any CSV
                             you export with the same columns)
  data/*breakdowns.csv       optional: spend/results split by placement, device, age...
  data/search_terms.csv      optional: Google search terms
  content/plans.json         optional: the written plan per client
  content/learnings.json     optional: what each client's tests taught you
  content/conversion.json    optional: extra conversion-tracking notes per client

Output: public/data.json, which public/index.html reads.

Uses only the Python standard library.

  python3 builder/build_data.py                 # your real data (config/, data/, content/)
  python3 builder/build_data.py --source demo   # the fake demo data in demo/
"""
import csv
import datetime as dt
import glob
import json
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


SOURCE = ROOT  # where config/, data/ and content/ are read from (--source DIR to change)


def path(*p):
    return os.path.join(SOURCE, *p)


def load_json(p, default):
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def load_csv(p):
    if not os.path.exists(p):
        return []
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(v):
    try:
        return float(v) if v not in (None, "") else 0.0
    except ValueError:
        return 0.0


def d(s):
    return dt.date.fromisoformat(s)


def cpr(spend, results):
    return spend / results if results else None


# ----------------------------------------------------------------------------- windows
def make_windows(rows):
    dates = sorted({r["date"] for r in rows})
    if not dates:
        raise SystemExit("No rows found in data/*rows.csv. Run a connector (connectors/) or use --source demo.")
    latest = d(dates[-1])
    first = d(dates[0])
    tw_start = latest - dt.timedelta(days=6)
    lw_end = tw_start - dt.timedelta(days=1)
    lw_start = lw_end - dt.timedelta(days=6)
    return {
        "this_week": {"start": tw_start.isoformat(), "end": latest.isoformat(), "days": 7},
        "last_week": {"start": lw_start.isoformat(), "end": lw_end.isoformat(), "days": 7,
                      "exists": first <= lw_start},
        "all": {"start": first.isoformat(), "end": latest.isoformat(), "days": (latest - first).days + 1},
        "latest": latest.isoformat(),
    }


def in_win(date, win):
    return win["start"] <= date <= win["end"]


def totals(rows):
    t = {"spend": 0.0, "results": 0.0, "impr": 0.0, "clicks": 0.0, "revenue": 0.0}
    for r in rows:
        t["spend"] += num(r.get("spend"))
        t["results"] += num(r.get("results"))
        t["impr"] += num(r.get("impressions"))
        t["clicks"] += num(r.get("clicks"))
        t["revenue"] += num(r.get("revenue"))
    return t


def goal_block(rows, ecom):
    t = totals(rows)
    return {"spend": round(t["spend"], 2), "results": t["results"], "measured": True,
            "cpr": cpr(t["spend"], t["results"]), "revenue": round(t["revenue"], 2) if ecom else None}


# ----------------------------------------------------------------------------- the tree
def ad_tree(rows, platform, acct, win, status_by_ad):
    """Campaign -> ad set -> ad tree for one account over one window."""
    camps = defaultdict(lambda: defaultdict(list))
    for r in rows:
        if in_win(r["date"], win):
            camps[r["campaign"]][r["adset"]].append(r)
    out = []
    for cname, adsets in camps.items():
        c_rows = [r for a in adsets.values() for r in a]
        ct = totals(c_rows)
        budget_val = max((num(r.get("daily_budget")) for r in c_rows), default=0)
        c_status = (c_rows[-1].get("campaign_status") or "ACTIVE").upper()
        aset_out = []
        for aname, a_rows in adsets.items():
            at = totals(a_rows)
            ads = defaultdict(list)
            for r in a_rows:
                ads[(r["ad_id"], r["ad"])].append(r)
            ad_out = []
            for (ad_id, ad_name), rr in ads.items():
                t = totals(rr)
                st = status_by_ad.get(ad_id, "ACTIVE")
                ad_out.append({
                    "ad_id": ad_id, "ad_name": ad_name, "name_id": None, "status": st,
                    "status_date": win["end"], "status_stale": False,
                    "paused_in_window": st != "ACTIVE" and st != "ENABLED", "other_goal": False,
                    "spend": round(t["spend"], 2), "impr": t["impr"], "clicks": t["clicks"],
                    "ctr": t["clicks"] / t["impr"] if t["impr"] else None,
                    "results": t["results"], "measured": True, "cpr": cpr(t["spend"], t["results"]),
                    "freq": round(1.1 + (t["impr"] % 7) / 10, 2) if platform == "meta" else None,
                    "hook": "unparsed", "angle": "unparsed", "format": "unparsed",
                })
            ad_out.sort(key=lambda x: -x["spend"])
            aset_out.append({
                "name": aname, "spend": round(at["spend"], 2), "impr": at["impr"], "clicks": at["clicks"],
                "results": at["results"], "results_measured": True, "other_goal": False,
                "freq": None, "ads": ad_out, "ctr": at["clicks"] / at["impr"] if at["impr"] else None,
                "cpr": cpr(at["spend"], at["results"]), "budget": None, "state": None,
            })
        aset_out.sort(key=lambda x: -x["spend"])
        paused = c_status not in ("ACTIVE", "ENABLED")
        out.append({
            "name": cname, "spend": round(ct["spend"], 2), "impr": ct["impr"], "clicks": ct["clicks"],
            "results": ct["results"], "results_measured": True, "other_goal": False, "freq": None,
            "adsets": aset_out, "ctr": ct["clicks"] / ct["impr"] if ct["impr"] else None,
            "cpr": cpr(ct["spend"], ct["results"]),
            "budget": {"amount": budget_val, "kind": "daily", "currency": acct.get("currency", "USD"),
                       "paused": paused, "shared": False} if budget_val else None,
            "budget_level": "campaign", "state": "paused" if paused else None,
        })
    out.sort(key=lambda x: -x["spend"])
    return out


# ----------------------------------------------------------------------------- flags
def make_flags(name, acct_rows, wins, min_spend):
    flags = []
    tw, lw = wins["this_week"], wins["last_week"]
    for acct_name, rows in acct_rows.items():
        tw_rows = [r for r in rows if in_win(r["date"], tw)]
        lw_rows = [r for r in rows if in_win(r["date"], lw)]
        acc = totals(tw_rows)
        avg = cpr(acc["spend"], acc["results"])
        by_c = defaultdict(list)
        for r in tw_rows:
            by_c[r["campaign"]].append(r)
        for cname, rr in by_c.items():
            t = totals(rr)
            if t["spend"] >= min_spend and t["results"] == 0:
                flags.append({"sev": "red",
                              "text": f"{name} / {cname}: ${t['spend']:,.2f} spent, 0 results in the last 7 days",
                              "action": "Pause or fix tracking on this campaign; confirm the conversion is firing."})
            elif avg and t["results"] and cpr(t["spend"], t["results"]) > 2 * avg and t["spend"] >= min_spend:
                flags.append({"sev": "amber",
                              "text": f"{acct_name} / {cname}: cost/result ${cpr(t['spend'], t['results']):,.2f} "
                                      f"is over 2x the 7-day account average (${avg:,.2f})",
                              "action": "Review targeting and creative; move budget to the efficient campaigns."})
        lt = totals(lw_rows)
        ctr_tw = acc["clicks"] / acc["impr"] if acc["impr"] else None
        ctr_lw = lt["clicks"] / lt["impr"] if lt["impr"] else None
        if ctr_tw and ctr_lw and ctr_tw < 0.7 * ctr_lw:
            flags.append({"sev": "amber",
                          "text": f"{acct_name}: CTR {ctr_tw:.2%} down from {ctr_lw:.2%} the week before (>30% drop)",
                          "action": "Check for creative fatigue or an audience change."})
    return flags


# ----------------------------------------------------------------------------- what changed
def what_changed(rows, wins, key):
    tw, lw = wins["this_week"], wins["last_week"]
    agg = defaultdict(lambda: {"tw": [], "lw": []})
    for r in rows:
        if in_win(r["date"], tw):
            agg[r[key]]["tw"].append(r)
        elif in_win(r["date"], lw):
            agg[r[key]]["lw"].append(r)
    out = []
    for name, v in agg.items():
        a, b = totals(v["tw"]), totals(v["lw"])
        ca, cb = cpr(a["spend"], a["results"]), cpr(b["spend"], b["results"])
        out.append({"name": name, "spend_tw": round(a["spend"], 2), "spend_lw": round(b["spend"], 2),
                    "spend_tw_pd": a["spend"] / 7, "spend_lw_pd": b["spend"] / 7,
                    "spend_delta": round(a["spend"] - b["spend"], 2),
                    "cpr_tw": ca, "cpr_lw": cb, "cpr_delta": (ca - cb) if ca is not None and cb is not None else None})
    out.sort(key=lambda x: -abs(x["spend_delta"]))
    return out[:10]


# ----------------------------------------------------------------------------- conversion
def conversion_for(name, cfg, acct_rows, wins, extra):
    tw = wins["this_week"]
    since30 = (d(wins["latest"]) - dt.timedelta(days=29)).isoformat()
    accounts, convs = [], []
    worst = "ONLINE"
    for a in cfg["accounts"]:
        rows = acct_rows.get(a["account_name"], [])
        t7 = totals([r for r in rows if in_win(r["date"], tw)])
        t30 = totals([r for r in rows if r["date"] >= since30])
        last_seen = max((r["date"] for r in rows if num(r.get("results")) > 0), default=None)
        status = "ONLINE" if t7["results"] > 0 else ("OFFLINE" if t7["spend"] >= 100 else "ONLINE_WITH_GAPS")
        if status == "OFFLINE":
            worst = "OFFLINE"
        elif status == "ONLINE_WITH_GAPS" and worst == "ONLINE":
            worst = "ONLINE_WITH_GAPS"
        event = a.get("conversion_event", a.get("result_type", "result"))
        accounts.append({"platform": a["platform"], "account_id": a["account_id"], "account_name": a["account_name"],
                         "spend_7d": round(t7["spend"], 2), "spend_30d": round(t30["spend"], 2),
                         "clicks_7d": int(t7["clicks"]), "conversions_7d": t7["results"],
                         "campaigns": [], "dashboard_conversion_event": f"{a['platform']} primary: {event}"})
        convs.append({"name": event, "what_counts": a.get("what_counts", "The result this account is optimised for"),
                      "platform": a["platform"], "account_id": a["account_id"],
                      "mechanism": "Meta pixel / Conversions API" if a["platform"] == "meta" else "Google Ads conversion action",
                      "event": event, "used_for_bidding": True, "counted_in_conversions": True,
                      "last_seen": last_seen, "spend_7d": round(t7["spend"], 2), "spend_basis": "whole account",
                      "conversions_7d": t7["results"], "all_conversions_7d": t7["results"],
                      "action_status": "ENABLED", "bidding_campaigns": [], "status": status,
                      "evidence": f"{t7['results']:g} events in the last 7 days", "silence": None})
    out = {"rollup": worst, "red_flag": worst == "OFFLINE", "accounts": accounts,
           "conversions": convs, "secondary_actions": [], "read_errors": []}
    out.update(extra.get(name, {}))
    return out


# ----------------------------------------------------------------------------- main
def build():
    clients_cfg = load_json(path("config", "clients.json"), None)
    if not clients_cfg:
        raise SystemExit("config/clients.json is missing. Copy demo/config/clients.json to config/clients.json and edit it (or use --source demo).")
    # every data/*rows.csv (ad_rows.csv, meta_rows.csv, google_rows.csv ...) and *breakdowns.csv
    rows = [r for f in sorted(glob.glob(path("data", "*rows.csv"))) for r in load_csv(f)]
    bd_rows = [r for f in sorted(glob.glob(path("data", "*breakdowns.csv"))) for r in load_csv(f)]
    st_rows = load_csv(path("data", "search_terms.csv"))
    plans = load_json(path("content", "plans.json"), {})
    learnings = load_json(path("content", "learnings.json"), {})
    conv_extra = load_json(path("content", "conversion.json"), {})
    settings = clients_cfg.get("settings", {})
    min_spend = float(settings.get("flag_min_spend", 50))

    wins = make_windows(rows)
    by_acct = defaultdict(list)
    for r in rows:
        by_acct[(r["platform"], r["account_id"])].append(r)
    status_by_ad = {}
    for r in sorted(rows, key=lambda r: r["date"]):
        status_by_ad[r["ad_id"]] = (r.get("ad_status") or "ACTIVE").upper()

    clients, conversion, order = {}, {}, []
    for c in clients_cfg["clients"]:
        name = c["name"]
        order.append(name)
        goal_cfg = c.get("goal", {})
        ecom = goal_cfg.get("kind") == "ecom"
        accts = c["accounts"]
        acct_rows = {a["account_name"]: by_acct.get((a["platform"], str(a["account_id"])), []) for a in accts}
        all_rows = [r for rr in acct_rows.values() for r in rr]
        tw_rows = [r for r in all_rows if in_win(r["date"], wins["this_week"])]
        lw_rows = [r for r in all_rows if in_win(r["date"], wins["last_week"])]
        platforms_used = sorted({a["platform"] for a in accts})
        multi = len(platforms_used) > 1
        noun = goal_cfg.get("count_noun", "Purchases" if ecom else "Leads")
        cost_label = goal_cfg.get("cost_label", "Cost per purchase" if ecom else "Cost per lead")

        platforms = {}
        for p in platforms_used:
            accs = []
            for a in [a for a in accts if a["platform"] == p]:
                rr = acct_rows[a["account_name"]]
                tree = ad_tree(rr, p, a, wins["this_week"], status_by_ad)
                res_tw = totals([r for r in rr if in_win(r["date"], wins["this_week"])])["results"]
                accs.append({"account_name": a["account_name"], "account_id": str(a["account_id"]),
                             "result_type": a.get("result_type", "lead"), "campaigns": tree,
                             "acct_results_tw": res_tw, "ad_results_tw": res_tw, "attribution_gap": False,
                             "budget_read": True, "budget_as_of": wins["latest"]})
            platforms[p] = {"accounts": accs, "is_meta": p == "meta"}

        creative = []
        for p in [platforms[k] for k in platforms if k == "meta"]:  # the leaderboard is Meta creative
            for a in p["accounts"]:
                for camp in a["campaigns"]:
                    for s in camp["adsets"]:
                        for ad in s["ads"]:
                            item = {k: ad[k] for k in ("ad_name", "name_id", "status", "status_date", "status_stale",
                                                       "other_goal", "paused_in_window", "spend", "ctr", "results",
                                                       "measured", "cpr", "freq", "hook", "angle", "format")}
                            thumb = next((r.get("thumbnail_url") for r in all_rows
                                          if r["ad_id"] == ad["ad_id"] and r.get("thumbnail_url")), None)
                            item["thumb"] = thumb
                            creative.append(item)
        creative.sort(key=lambda x: -x["spend"])

        platform_split = None
        if multi:
            platform_split = {"targets": goal_cfg.get("platform_targets", {}), "note": None}
            for p in platforms_used:
                prow = [r for r in all_rows if r["platform"] == p]
                platform_split[p] = {
                    "tw": goal_block([r for r in prow if in_win(r["date"], wins["this_week"])], False),
                    "lw": goal_block([r for r in prow if in_win(r["date"], wins["last_week"])], False),
                    "all": goal_block(prow, False)}

        tw_b, lw_b = goal_block(tw_rows, ecom), goal_block(lw_rows, ecom)
        volume = None
        if goal_cfg.get("monthly_target"):
            latest = d(wins["latest"])
            mstart = latest.replace(day=1).isoformat()
            mtd = totals([r for r in all_rows if r["date"] >= mstart])["results"]
            nxt = (latest.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
            dim = (nxt - latest.replace(day=1)).days
            volume = {"noun": noun.lower(), "mtd": mtd, "monthly": goal_cfg["monthly_target"],
                      "stretch": goal_cfg.get("monthly_stretch"), "pace": round(mtd / latest.day * dim),
                      "elapsed": latest.day, "days_in_month": dim, "month": latest.strftime("%B"),
                      "as_of": wins["latest"], "note": goal_cfg.get("monthly_note"), "measured": True}

        account_targets = []
        for p, val in (goal_cfg.get("platform_targets") or {}).items():
            prow = [r for r in tw_rows if r["platform"] == p]
            t = totals(prow)
            for a in [a for a in accts if a["platform"] == p][:1]:
                account_targets.append({"account_name": a["account_name"], "platform": p,
                                        "label": f"{p.title()} {cost_label.lower()}", "value": val,
                                        "cpr_tw": cpr(t["spend"], t["results"]), "results_tw": t["results"],
                                        "measured": True})

        goal = {
            "kind": "ecom" if ecom else "leads", "cost_label": cost_label,
            "cost_target": goal_cfg.get("cost_target"),
            "result_platform": "combined" if multi else platforms_used[0], "multi_platform": multi,
            "count_noun": noun, "count_desc": goal_cfg.get("count_desc"),
            "extra_lines": goal_cfg.get("notes", []),
            "this_week": tw_b, "today_so_far": None, "last_week": lw_b, "all": goal_block(all_rows, ecom),
            "avg_days": wins["all"]["days"], "data_start": wins["all"]["start"], "data_end": wins["all"]["end"],
            "account_targets": account_targets, "target_text": goal_cfg.get("target_text"),
            "status_override": None, "app_split": None, "platform_split": platform_split, "volume": volume,
            "actions_both": None,
            "overview": {"a": {"noun": noun, "tw": tw_b["results"], "lw": lw_b["results"],
                               "cost_tw": tw_b["cpr"], "cost_lw": lw_b["cpr"], "cost_label": cost_label.lower(),
                               "note": goal_cfg.get("overview_note", "")}},
        }

        daily = {}
        for a in accts:
            per = defaultdict(lambda: {"spend": 0.0, "results": 0.0, "impr": 0.0, "clicks": 0.0})
            for r in acct_rows[a["account_name"]]:
                x = per[r["date"]]
                x["spend"] += num(r["spend"]); x["results"] += num(r["results"])
                x["impr"] += num(r["impressions"]); x["clicks"] += num(r["clicks"])
            daily[str(a["account_id"])] = [{"date": k, **{kk: round(vv, 2) for kk, vv in v.items()}}
                                          for k, v in sorted(per.items())]

        ids = {str(a["account_id"]) for a in accts}
        breakdowns = []
        groups = defaultdict(lambda: defaultdict(lambda: {"spend": 0.0, "impr": 0.0, "clicks": 0.0, "results": 0.0}))
        labels = {}
        for r in bd_rows:
            if r["account_id"] in ids and in_win(r["date"], wins["this_week"]):
                key = (r["platform"], r["dimension"])
                labels[key] = r.get("label") or f"{r['dimension'].replace('_', ' ').title()} ({r['platform'].title()})"
                g = groups[key][r["value"]]
                g["spend"] += num(r["spend"]); g["impr"] += num(r["impressions"])
                g["clicks"] += num(r["clicks"]); g["results"] += num(r["results"])
        for (p, dim), vals in groups.items():
            rws = [{"value": v, "spend": round(x["spend"], 2), "impr": x["impr"], "clicks": x["clicks"],
                    "results": x["results"], "measured": True} for v, x in vals.items()]
            rws.sort(key=lambda x: -x["spend"])
            breakdowns.append({"label": labels[(p, dim)], "platform": p, "dimension": dim, "rows": rws,
                               "any_measured": True, "coverage_note": None, "results_caveat": False})

        search_terms = None
        st = [r for r in st_rows if r["account_id"] in ids]
        if st:
            tr = sorted(({"term": r["term"], "cost": num(r["cost"]), "clicks": num(r["clicks"]),
                          "conv": num(r["conversions"])} for r in st), key=lambda x: -x["cost"])
            g_spend = totals([r for r in tw_rows if r["platform"] == "google"])["spend"]
            search_terms = {"rows": tr[:25], "covered": round(sum(x["cost"] for x in tr), 2),
                            "google_spend": round(g_spend, 2), "window": f"{wins['all']['start']} to {wins['all']['end']}"}

        clients[name] = {
            "currency": c.get("currency", "USD"),
            "accounts": [{"account_id": str(a["account_id"]), "platform": a["platform"],
                          "account_name": a["account_name"], "result_type": a.get("result_type", "lead"),
                          "tracks_revenue": ecom, "currency": c.get("currency", "USD")} for a in accts],
            "goal": goal, "platforms": platforms, "creative": creative,
            "what_changed": {"per_day": False, "by_campaign": what_changed(all_rows, wins, "campaign"),
                             "by_ad": what_changed(all_rows, wins, "ad"),
                             "enough_history": wins["last_week"]["exists"], "data_start": wins["all"]["start"]},
            "flags": make_flags(name, acct_rows, wins, min_spend),
            "daily": daily, "has_backend": False, "not_launched": not all_rows,
            "breakdowns": breakdowns, "search_terms": search_terms, "locations": None,
            "budget_available": True,
        }
        conversion[name] = conversion_for(name, c, acct_rows, wins, conv_extra)

    now = dt.datetime.now(dt.timezone.utc)
    data = {
        "generated_at": now.strftime("%Y-%m-%d %H:%M UTC"),
        "data_as_of_et": wins["latest"],
        "data_as_of_epoch": int(now.timestamp()),
        "run_id": "build-" + now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "run_note": settings.get("run_note", ""),
        "windows": wins, "clients": clients, "client_order": order,
        "not_launched_clients": [n for n in order if clients[n]["not_launched"]],
        "disapprovals_available": False,
        "notes": settings.get("notes", {
            "budget": "Budgets are the daily budgets in your ad accounts on the latest day.",
            "backend": "Platform numbers only. Compare with your own sales or CRM records.",
            "conversions_dark": "A conversion that stops firing while spend continues is flagged red.",
            "breakdowns": "Breakdowns cover the last 7 days.",
            "thumbnails": "Creative thumbnails come from the ad platform.",
            "last_week_partial": "Week-over-week compares the last 7 days with the 7 days before.",
        }),
        "plans": plans, "pipelines": {}, "learnings": learnings,
        "conversion": {"meta": {"generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                "window": {"since": wins["this_week"]["start"], "until": wins["this_week"]["end"],
                                           "days": 7, "tz": settings.get("timezone", "America/New_York")},
                                "scope": f"{sum(len(c['accounts']) for c in clients_cfg['clients'])} accounts",
                                "thresholds": {"OFFLINE_MIN_SILENT_SPEND": 100.0},
                                "status_note": "Status is the tracking signal, not performance.",
                                "read_errors_global": []},
                       "clients": conversion},
        "lead_quality": {},
    }
    os.makedirs(os.path.join(ROOT, "public"), exist_ok=True)
    with open(os.path.join(ROOT, "public", "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    print(f"wrote public/data.json: {len(clients)} clients, {len(rows)} ad-day rows, "
          f"window {wins['this_week']['start']}..{wins['this_week']['end']}")
    if SOURCE == ROOT:
        print("Reminder: public/data.json now holds your REAL client data. Keep this repo private.")


if __name__ == "__main__":
    if "--source" in sys.argv:
        SOURCE = os.path.abspath(sys.argv[sys.argv.index("--source") + 1])
    sys.exit(build())
