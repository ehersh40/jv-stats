# JV Stats — Basketball Stat Tracker (PWA)

A courtside stat tracker that installs on Android and iPhone from a web link,
works offline in the gym, and shares box scores as a CSV file or a text summary.

No frameworks and no build step. Just HTML, CSS and JavaScript you can edit in VS Code.

---

## 1. Run it on your Windows PC

1. Unzip the `jv-stats` folder somewhere easy, like `Documents\jv-stats`.
2. In VS Code, open the folder with **File → Open Folder…**.
3. Install the **Live Server** extension (by Ritwick Dey) from the Extensions panel (`Ctrl+Shift+X`).
4. Right-click `index.html` and choose **Open with Live Server**. The app opens at `http://127.0.0.1:5500`.
5. To see it phone-sized, press `F12` in Chrome or Edge, then `Ctrl+Shift+M` (device toolbar), and pick a phone.

Live Server reloads the page every time you save a file.

> Tip: while you're editing, the offline cache can hold on to old files. In DevTools, open
> **Application → Service workers** and check **Update on reload**.

## 2. Quick test on your phone (same Wi-Fi)

1. In VS Code's terminal (`` Ctrl+` ``), run `ipconfig` and note the **IPv4 Address**, for example `192.168.1.23`.
2. On your phone, go to `http://192.168.1.23:5500`.
3. If Windows Firewall asks, allow access on **Private networks**.

This is fine for trying out the layout. Installing and offline mode only work over **HTTPS**, so use step 3 for real use.

## 3. Put it online (free, HTTPS)

### Option A: GitHub Pages (recommended; easy updates from VS Code)
1. Create a free account at github.com, then a **new public repository** named `jv-stats`.
2. Upload the files. Either drag the contents of the folder into the repo page, or use VS Code's
   **Source Control** panel → **Publish to GitHub**.
3. In the repo, go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**,
   select `main` and `/ (root)`, and save.
4. After a minute your app is live at `https://YOUR-USERNAME.github.io/jv-stats/`.

### Option B: Netlify Drop (no account needed to start)
Go to `app.netlify.com/drop` and drag the `jv-stats` folder onto the page. You'll get an HTTPS link.
Create a free account if you want to keep the site and update it later.

> The site contains only the app, not your data. Stats stay on each phone.

## 4. Install on phones (you and your assistant coaches)

Text everyone the link.

- **Android (Chrome):** open the link, then tap **⋮ → Add to Home screen** (or **Install app**).
- **iPhone (must use Safari):** open the link, then tap **Share → Add to Home Screen**.

Open it once with internet access. After that it works offline.

## 5. Publishing updates

1. Edit the files and test with Live Server.
2. In `sw.js`, change `CACHE_VERSION = 'v1'` to `'v2'` (then `'v3'`, and so on). **This step is what tells phones there's a new version.**
3. Upload or push the changes (GitHub), or drag the folder again (Netlify).
4. Phones pick up the update the next time the app is opened with internet access. The app reloads itself once.

---

## Using the app

1. **Roster tab:** add each player's number, name and role: **PG** (point guard), **F** (forward) or **U** (utility).
   Tap **Edit** to change a role later.
2. **Games → + New Game:** enter the opponent, date and home/away, and uncheck anyone not dressed.
3. **Plan (optional, before the game):** open the game's **Plan** tab to set a starting five and a
   mid-quarter group for each quarter. The bench for each group is listed under it.
   - **✨ Auto-fill fair rotation** spreads shifts as evenly as possible, rests players who just came off,
     keeps at least one point guard in every group, and gives any extra shifts to whoever has played the fewest
     quarters this season. Tap any group to adjust it.
   - A group with no point guard shows **⚠ No point guard**. It's a warning only; you can still use that lineup.
   - **Playing time** shows each player's planned shifts next to the quarters she actually played.
   - While tracking, each quarter starts with its planned five, and **⇄ Sub** offers the planned change as one button.
4. **Track:**
   - When the game starts, pick your starting five. Only the 5 players on the court are shown.
   - Tap **⇄ Sub**, then tap who's coming out and who's going in. Each quarter remembers its own lineup,
     and a new quarter starts with whoever finished the last one.
   - Tap a player, then tap a stat. Green buttons are makes, red are misses.
   - Use **Lakeview +1/+2/+3** (your opponent's name) to keep their score.
   - Switch quarters with **Q1–Q4 / OT**.
   - **Undo last** or the **✕** in the Recent list fixes mistakes.
   - Players show a yellow bar at 4 fouls and are dimmed at 5. Team fouls per quarter are shown, highlighted at 5.
   - The screen stays awake while tracking, on phones that support it.
5. **End game**, then **Share:**
   - **Share CSV file** opens the phone's share sheet (Messages, email, Drive…).
   - **Share/Copy text summary** gives a readable recap that's good for a group text to parents.
   - **Download CSV** saves the file to the phone.
   - **Share game file** sends the full game to another coach (see below).
6. **Importing an assistant's game:** the assistant opens the game and goes to **Share → Share game file**,
   then texts or emails it to you. Save the attachment to your phone (iPhone: **Save to Files**; Android: **Download**),
   then go to **Games → Import game file…** and pick it. Players are matched to your roster by number and name.
   Importing the same game again asks whether to replace your copy.
7. **Settings:** change the team name, **Back up** all data to a file, and **Restore** it on a new phone.

### About texting the CSV
iMessage, RCS (Android-to-Android), email and Google Drive handle CSV attachments well.
Plain SMS/MMS, especially Android ↔ iPhone, may refuse attachments. For those, send the
**text summary** instead, or email the CSV.

---

## Project files

| File | What it does |
|---|---|
| `index.html` | Page shell and bottom tabs |
| `styles.css` | All styling; light and dark mode follow the phone's setting |
| `app.js` | Everything else: roster, tracking, box score, CSV and sharing |
| `sw.js` | Offline caching. **Bump `CACHE_VERSION` when you publish changes.** |
| `manifest.json` | App name, icon and colors used when installed |
| `icons/` | Home-screen icons |

### Handy places to customize in `app.js`
- `STATS`: the stat buttons, their labels and their order.
- `TEAM_FOUL_BONUS`: the team-foul count that gets highlighted.
- `PERIODS`: switch to halves (`['H1','H2','OT']`) if your league plays halves.

### How the data works
Each game stores a list of events, for example `#12 · 3PT made · Q2`. Every total is
calculated from that list, so Undo and deleting an event always keep the box score correct.
Data is saved instantly to the phone's local storage after every tap.
