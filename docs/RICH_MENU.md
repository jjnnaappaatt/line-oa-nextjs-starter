# Rich menu

A **rich menu** is the tappable panel pinned to the bottom of a LINE chat. It is the main navigation for
most OA bots. This starter doesn't manage it in code (many teams set it up once in the console), but the
Messaging API can create it programmatically — this doc shows both, plus a generic template image.

> `public/rich-menu/example-rich-menu.svg` is a **neutral 6-zone template** (2500 × 1686). Replace it
> with your own brand art — don't ship someone else's logo. Export your final art to **PNG or JPEG**
> (LINE does not accept SVG for the rich-menu image).

## Image spec

- Size: **2500 × 1686** (full) or 2500 × 843 (compact). Max 1 MB, PNG/JPEG.
- Tap areas are rectangles in **image pixel coordinates**. For the 6-zone grid in the template
  (3 columns × 2 rows), the areas are:

| Zone | x | y | width | height |
|---|---|---|---|---|
| Home       | 0    | 0   | 833 | 843 |
| My Projects| 833  | 0   | 834 | 843 |
| Submit     | 1667 | 0   | 833 | 843 |
| Status     | 0    | 843 | 833 | 843 |
| Events     | 833  | 843 | 834 | 843 |
| Help       | 1667 | 843 | 833 | 843 |

## Option A — set it up in the console (simplest)

Messaging API channel → **Rich menus** → create one, upload your PNG, drag the tap areas, and give each
a **text** action (e.g. `help`, `status`) or a **URI** action (e.g. your LIFF link). Text actions are
handled by `lib/line/webhook.ts`; the fuzzy matcher means small variations still resolve.

## Option B — create it via the Messaging API

Each area's `action` can be `{"type":"message","text":"status"}` (routes into your bot) or
`{"type":"uri","uri":"https://liff.line.me/<LIFF_ID>/"}`.

A zone can also open the **human handoff** — give it `{"type":"message","text":"talk to a human"}` and the
bot steps aside so a staff member can reply from the LINE OA Manager console (see `docs/ARCHITECTURE.md` §2).

```bash
TOKEN="$LINE_CHANNEL_ACCESS_TOKEN"

# 1) Create the menu definition → returns a richMenuId
RICH_MENU_ID=$(curl -s -X POST https://api.line.me/v2/bot/richmenu \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "size": { "width": 2500, "height": 1686 },
    "selected": true,
    "name": "Main menu",
    "chatBarText": "Menu",
    "areas": [
      { "bounds": {"x":0,"y":0,"width":833,"height":843},      "action": {"type":"message","text":"help"} },
      { "bounds": {"x":833,"y":0,"width":834,"height":843},    "action": {"type":"message","text":"my projects"} },
      { "bounds": {"x":1667,"y":0,"width":833,"height":843},   "action": {"type":"uri","uri":"https://liff.line.me/<LIFF_ID>/submit"} },
      { "bounds": {"x":0,"y":843,"width":833,"height":843},    "action": {"type":"message","text":"status"} },
      { "bounds": {"x":833,"y":843,"width":834,"height":843},  "action": {"type":"message","text":"manage"} },
      { "bounds": {"x":1667,"y":843,"width":833,"height":843}, "action": {"type":"message","text":"report"} }
    ]
  }' | sed -E 's/.*"richMenuId":"([^"]+)".*/\1/')

# 2) Upload the image (PNG/JPEG, ≤ 1 MB)
curl -X POST "https://api-data.line.me/v2/bot/richmenu/$RICH_MENU_ID/content" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: image/png" \
  --data-binary @my-rich-menu.png

# 3) Make it the default for all users
curl -X POST "https://api.line.me/v2/bot/user/all/richmenu/$RICH_MENU_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Docs: <https://developers.line.biz/en/docs/messaging-api/using-rich-menus/>
