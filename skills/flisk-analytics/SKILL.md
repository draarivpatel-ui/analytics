---
name: flisk-analytics
description: Add a website to Flisk Analytics, get the install snippet (Jekyll one-liner, plain script tag, Next.js, Worker) and read its visitor numbers. Use when the user asks to add analytics to a site, install the Flisk tracker, or check traffic, top pages, sources or countries for a site they own.
---

# Flisk Analytics

Privacy-first web analytics at https://analytics.flisk.si. No cookies, no stored IPs.

## Connect

The user makes a key at https://analytics.flisk.si/tokens (GitHub sign-in) and runs:

```bash
claude mcp add --transport http flisk-analytics https://analytics.flisk.si/mcp --header "Authorization: Bearer fa_<key>"
```

Never print or store the key anywhere else. If the tools below are missing, ask the user to do this once.

## Tools

- `list_sites`: the user's sites with 30-day visitors.
- `add_site {domain}`: register a bare domain such as `flisk.sh` (a URL is cleaned to the domain). Safe to repeat.
- `install_snippet {site}`: the script tag plus the Jekyll, Next.js and Worker variants.
- `site_stats {site, range, panels}`: `range` is `today`, `7d`, `30d` or `12m`; `panels` picks the top lists (`channels`, `sources`, `campaigns`, `themes`, `pages`, `countries`, `regions`, `cities`, `browsers`, `os`, `devices`).

## Tag links so social visits are not "Direct"

Social apps strip the referrer. Tag every link you post with `?utm_source=<where>&utm_medium=<kind>&utm_campaign=<name>` (for example `?utm_source=x&utm_medium=social&utm_campaign=launch`). `utm_source` shows in the `sources` panel (`x`, `hn`, `reddit`, `linkedin`, `dev.to`, `toolradar`, `producthunt` get their proper names), `utm_medium` in `channels` (`social`, `cta`, `email`, `cpc`/`paid`, `referral`) and `utm_campaign` in `campaigns`. Use lowercase, no spaces.

## Install a site

1. `add_site` with the domain.
2. `install_snippet` for it.
3. Put the snippet in the site's `<head>`. Jekyll: run the one-line installer from the repo root (it writes `_includes/flisk-analytics.html` and adds the include to the layout). Open a PR for the change; do not push to the default branch.
4. After deploy, visit the page once and call `site_stats` with `range: "today"`. Pages cached by a CDN can take hours to show the tag.

## Rules

- Only sites the key's owner added are readable. Do not try other domains.
- Report numbers with their range. Bots are already filtered; do not add caveats about them.
