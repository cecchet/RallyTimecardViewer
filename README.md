# Rally Timecard Viewer

A static web app that shows a stage rally time card and live overall / class results, read straight from the event's timing Google Sheet.

- **Time card**: enter a car # and choose SS 1–4, SS 5–8 or SS 9–12 to see that card filled in (ATC IN, actual start, finish, bogey, stage time, start transit, transit, next ATC due). Late/early ATC check-ins, max times and penalties are flagged.
- **Overall / By class**: stage times, totals, gap to leader and to the car ahead, fastest stage times highlighted (overall in green, in-class in blue). Click a row to open that car's time card.
- **Graph view** (Table / Graph switch on Overall and By class): position and time behind the leader after each stage. Overall lines are colored by class; class graphs color each car. Hover or tap a stage to see the whole field; click a line to open that car's time card. The time-behind chart zooms past cars far off the pace unless "Full range" is ticked.

Start transit and ATC due times follow the same rule as the [Rally Timecard Calculator](https://github.com/cecchet/RallyTimecardCalculator): actual start + the longer of bogey or stage-time minutes, + transit.

## Usage

Pick the event from the dropdown (newest first; the newest loads by default), or choose "Other spreadsheet" and paste a link. Each sheet must be shared as "Anyone with the link can view". It reads the `First Entry - TIMING ONLY` and `Summary - TIMING ONLY` tabs.

### Adding an event

Add a line to [`events.js`](events.js) with the spreadsheet's name and link. Name events `YYYY-MM Event Name` so the list sorts newest first; the name is also shown at the top of the time card.

```js
{ name: '2026-10 Next Event Gravel Trial', sheet: 'https://docs.google.com/spreadsheets/d/<id>/edit' },
```

URL parameters make shareable links:

| Parameter | Example | Meaning |
|---|---|---|
| `sheet` | `sheet=1FaOlH_cc78...` | Spreadsheet ID or full link |
| `car` | `car=577` | Car number |
| `card` | `card=3` | Time card 1, 2 or 3 |
| `tab` | `tab=overall` | `card`, `overall` or `class` |
| `class` | `class=R2U` | Class shown on the By class tab |
| `view` | `view=graph` | Show Overall / By class as graphs |
| `title` | `title=My%20Rally` | Event name on the card header |

Run locally:

```
npx http-server . -p 8137 -c-1
```
