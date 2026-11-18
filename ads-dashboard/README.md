# Paid Ads Dashboard: technical notes

This file is for you or your AI when you change the code. For plain-English setup, see the README in the folder above this one.

## How it fits together

```
connectors/fetch_meta.py  ─┐
connectors/fetch_google.py ├─> data/*rows.csv, data/*breakdowns.csv, data/search_terms.csv
(or any CSV you export)   ─┘
config/clients.json  ─┐
content/plans.json    ├─> builder/build_data.py ─> public/data.json ─> public/index.html
content/learnings.json┘
```

- `public/index.html` is the whole dashboard: one page with inline CSS and JavaScript, and no build step. It loads `data.json` and routes by URL hash: `#/` shows all clients, `#/c/<name>` one client, `#/c/<name>/notes` the full plan notes, and `#/resources` your links.
- `builder/build_data.py` uses only the Python standard library. It works out the 7-day windows, which end on the latest day in the data. Then it builds, for each client:
  - **Goal status:** the client's cost per result against the target, both blended and per platform.
  - **Monthly pace:** progress towards the monthly goal.
  - **Ad tree:** campaign → ad set → ad.
  - **Creative leaderboard:** Meta ads only.
  - **What changed:** this week against last week.
  - **Breakdowns and search terms.**
  - **Conversion-tracking health:** every account must still record results while it spends.
  - **Flags:**

    | Colour | Flag |
    |---|---|
    | Red | A campaign spent money with 0 results |
    | Amber | A campaign's cost is more than 2x the account average |
    | Amber | CTR dropped by more than 30% |

- `builder/make_demo_data.py` writes the fake dataset into `demo/`. Build from it with `--source demo`.

## Ad rows (the one format everything reads)

`date, platform (meta|google), account_id, campaign_id, campaign, adset_id, adset, ad_id, ad, spend, impressions, clicks, results, revenue, daily_budget, campaign_status, ad_status, thumbnail_url`

Any tool that can write this CSV can feed the dashboard, for example a TikTok or Microsoft Ads export. Add `"platform": "tiktok"` accounts in `config/clients.json`, and adjust the platform colours and labels in `index.html`.

## config/clients.json

```json
{
  "settings": {"timezone": "America/New_York", "flag_min_spend": 50},
  "clients": [
    {"name": "Client A", "currency": "USD",
     "goal": {"kind": "leads", "cost_target": 45, "count_noun": "Leads", "cost_label": "Cost per lead",
              "monthly_target": 60, "platform_targets": {"google": 70, "meta": 25}},
     "accounts": [{"platform": "meta", "account_id": "1234567890", "account_name": "Client A (Meta)",
                   "result_type": "lead", "meta_result_action": "onsite_conversion.lead_grouped"}]}
  ]
}
```

- **`goal.kind`:** use `ecom` for purchases (this also shows ROAS) or `leads`.
- **`cost_target`:** turns the status on. Green means at or under the target, amber means up to 20% over, and red means more than 20% over or spending with no results.
- **`platform_targets`:** for clients that run on both Meta and Google, scores each platform against its own target.

## Deploying

`deploy/deploy_cloudflare.sh <project>` publishes `index.html` and `data.json` to Cloudflare Pages, together with `deploy/_worker.js`. That worker is a password gate (Basic auth): every file needs `DASHBOARD_PASSWORD`, and if the password is not set the site stays locked.

To host it anywhere else, serve the `public/` folder as static files behind a login.

## Not included in this starter

- The original live version also had several extra sections. This starter leaves them out, but the page has slots for them and simply shows "coming" or hides the section:

  | Section | What it showed |
  |---|---|
  | Location | A location tab |
  | Lead quality | Lead quality pulled from a CRM |
  | Creative pipeline | A creative pipeline from a Trello board |
  | Campaign table | A lifetime campaign table |
- `data.json` can carry `lead_quality`, `pipelines` and `locations` if you want to build them.
- The connectors were written against the public Meta Marketing API and the Google Ads REST API. **Test them on your own account first.** API versions change, so set `META_API_VERSION` and `GOOGLE_ADS_API_VERSION` to the current versions.
