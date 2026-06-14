#!/usr/bin/env python3
# Munin "contact" script. Munin pipes alert text to this on stdin (see munin.conf:
#   contact.webhook.command /usr/local/bin/munin-webhook.py
#   contact.webhook.always_send warning critical).
# We parse it into JSON and POST it to the InfraWatch webhook, which runs it
# through the AI layer and shows it on the dashboard.
import sys, os, json, re, urllib.request, datetime

WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "http://localhost:3000/api/munin-alert")
DEBUG_LOG = "/tmp/munin-webhook-debug.log"

raw = sys.stdin.read().strip()

# 1) ALWAYS save exactly what Munin sent — so we can see the real format.
with open(DEBUG_LOG, "a") as f:
    f.write(f"\n===== {datetime.datetime.now().isoformat()} =====\n{raw}\n")

# 2) Severity from the words Munin uses.
up = raw.upper()
severity = ("critical" if "CRITICAL" in up else
            "warning"  if "WARNING"  in up else
            "unknown"  if "UNKNOWN"  in up else "info")

# 3) Host + title from the header line: "group :: host :: title" or "host :: title".
host = title = None
first = next((l for l in raw.splitlines() if l.strip()), "")
parts = [p.strip() for p in first.split("::")]
if   len(parts) >= 3: host, title = parts[1], parts[2]
elif len(parts) == 2: host, title = parts[0], parts[1]
else:                 title = first.strip() or None

# 4) The lines describing what's actually wrong — only the CRITICAL/WARNING/UNKNOWN
#    lines, NOT the "OKs:" lines (which list healthy readings we don't want the AI
#    to treat as problems).
problems = [l.strip() for l in raw.splitlines()
            if re.search(r"\b(CRITICAL|WARNING|UNKNOWN)s?\b", l, re.I)
            and "::" not in l]

payload = {
    "source": "munin",
    "received_at": datetime.datetime.now().isoformat(),
    "severity": severity,
    "host": host,
    "title": title,
    "problems": problems,
    "raw": raw,            # full original text — always present, never null
}

req = urllib.request.Request(WEBHOOK_URL, data=json.dumps(payload).encode(),
                             headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        r.read()
except Exception as e:
    with open(DEBUG_LOG, "a") as f:
        f.write(f"POST FAILED: {e}\n")
