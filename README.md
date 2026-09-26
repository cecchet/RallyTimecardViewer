# Rally Timecard Viewer

A static web app that shows a stage rally time card and live overall / class results, read straight from the event's timing Google Sheet.

- **Time card**: enter a car # and choose SS 1–4, SS 5–8 or SS 9–12 to see that card filled in (ATC IN, actual start, finish, bogey, stage time, start transit, transit, next ATC due). Late/early ATC check-ins, max times and penalties are flagged.
- **Overall / By class**: stage times, totals, gap to leader and to the car ahead, fastest stage times highlighted. Click a row to open that car's time card.

Start transit and ATC due times follow the same rule as the [Rally Timecard Calculator](https://github.com/cecchet/RallyTimecardCalculator): actual start + the longer of bogey or stage-time minutes, + transit.

## Usage

Open `index.html` from any static web host and paste the event spreadsheet link. The sheet must be shared as "Anyone with the link can view". It reads the `First Entry - TIMING ONLY` and `Summary - TIMING ONLY` tabs.

URL parameters make shareable links:

| Parameter | Example | Meaning |
|---|---|---|
| `sheet` | `sheet=1FaOlH_cc78...` | Spreadsheet ID or full link |
| `car` | `car=577` | Car number |
| `card` | `card=3` | Time card 1, 2 or 3 |
| `tab` | `tab=overall` | `card`, `overall` or `class` |
| `class` | `class=R2U` | Class shown on the By class tab |
| `title` | `title=My%20Rally` | Event name on the card header |

Run locally:

```
npx http-server . -p 8137 -c-1
```
