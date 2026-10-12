# IMMORTALITY Clip Tracker

[![build](https://github.com/XxSeRyIxX/IMMORTALITY-Clip-Tracker/actions/workflows/build.yml/badge.svg)](https://github.com/XxSeRyIxX/IMMORTALITY-Clip-Tracker/actions/workflows/build.yml)
[![pages](https://github.com/XxSeRyIxX/IMMORTALITY-Clip-Tracker/actions/workflows/pages.yml/badge.svg)](https://github.com/XxSeRyIxX/IMMORTALITY-Clip-Tracker/actions/workflows/pages.yml)

Reads your [IMMORTALITY](https://store.steampowered.com/app/1350200/IMMORTALITY/)
save, or the clips you mark by hand on a console, and tells you exactly which
clips you are still missing, and how to reach each one.

**[Open it in your browser](https://xxseryixx.github.io/IMMORTALITY-Clip-Tracker/)**,
nothing to install. Or [download the app](../../releases) for Windows, macOS or
Linux, which finds your save on its own.

Your save is read on your own machine. It is never uploaded.

> The app is spoiler-free until you ask it for more, and so is this page: how
> the game works underneath is folded away under **Game Internals And Spoilers**.

## Use it

Drop `SaveGame.abr` onto the page, or let the desktop app find it for you.

- Windows `%USERPROFILE%\AppData\LocalLow\Half Mermaid Productions\Immortality\<steam-id>\`
- macOS `~/Library/Application Support/Half Mermaid Productions/Immortality/`
- Linux `~/.config/unity3d/Half Mermaid Productions/Immortality/`
- Steam Deck / Proton `~/.steam/steam/steamapps/compatdata/1350200/pfx/drive_c/users/steamuser/AppData/LocalLow/Half Mermaid Productions/Immortality/`

Can't find it? Steam keeps a copy. There is a
[Steam Cloud](https://store.steampowered.com/account/remotestorageapp/?appid=1350200)
link on the page.

Chromium-based browsers can remember the selected file handle. Later visits can
read it again, sometimes after asking for permission, and **Reload** reads the
same save. Other browsers use file selection or drag and drop. A rejected file
never replaces the last successfully loaded save.

When save reads overlap, the most recently requested save or mode takes priority.
An older read cannot switch you out of manual mode, replace the current source,
or hide the newer operation's loading indicator.

### No save file?

On a console, or anywhere the save cannot be reached, choose **Mark clips by
hand** on the start page. **Mark found** in the header then finds a clip by what
the game writes under it, the film, the take and the date, or by a few words of
what is said in it, and marks it found or missing. Only clips that match what you
type are shown. Each clip's details have the same button.

Marks are kept on the device as you go, in the browser or in the desktop app, and
the next visit opens straight to them. To move them to another device or keep a
backup, copy the progress code under **Mark found** and load it there: one short
line that holds nothing but which clips are marked.

In the browser, **Save as file** and **Open a file** do the same transfer using a
text file. The desktop app uses copy and paste. Importing replaces the existing
marks; the confirmation includes the previous code so that it can be restored.
Loading a game save leaves your manual marks intact for when you switch back.

Closing the marking dialog, switching modes or changing marks cancels a pending
progress-file import. A newer file or pasted-code import takes precedence, so a
slow earlier read cannot replace more recent progress.

Import checks the code's structure, checksum and expected clip count before
changing any marks. Rejected imports leave the current progress alone. Existing
valid `ICT1-` codes keep the same format and remain compatible.

The desktop app runs one instance at a time, keeping its local storage address
stable between visits. A second launch exits; use the existing window. No second
progress store is created.

### Storage And Privacy

Progress belongs to the current browser profile or desktop webview profile. It
is not automatically shared between devices, browsers, the website and the
desktop app. Clearing site data, removing a profile or closing a private browsing
session can remove marks. Keep a progress code as a backup.

If browser storage becomes unavailable or unreadable, marks already held in
memory are preserved and a warning appears. Export the progress code before
closing the page; this cannot recover marks from a profile that was deleted.

The website requests its own scripts, clip data and pictures, and checks for
updates. Saves and marks are processed locally and are never uploaded. The tracker
has no accounts or analytics. Once visited online, it can work offline; pictures
are available offline after they have been loaded at a picture-showing setting.

## Spoiler control

Use **Show me** in the header. It starts at the most guarded setting, and your
choice is remembered for next time.

| Setting | Shows |
| --- | --- |
| **Total only** *(default)* | how many clips you still have to find, and nothing else |
| Per movie | how many are left in each movie |
| Clip numbers | which numbers are missing |
| Clip details | names, dates, the first line spoken in each clip, and a still of it |
| Everything | adds the route: where to start, what to do there and when, and a frame with a ring around what to click |

Stuck on one clip? **Reveal details** and **Reveal this clip** open up that one
entry without changing the setting for everything else.

Everything works from the keyboard: Tab reaches every control, movie and clip,
and the arrow keys move through the clip list. Once you have scrolled a screen
down, a button in the corner takes you back to the top.

### The Secrets switch

Some clips are kept apart from the rest. The **Secrets** switch sits next to
*Show me* and applies at every level. It is off by default, which keeps those
clips out of the list and out of every count, including the totals, so the
numbers never hint at what is being left out.

A red `*` next to a movie means it still hides something you have switched off.

### Pictures

Every clip shows the scene it actually is, and every match-cut shows a frame of
the clip it starts from, at the moment the object is on screen, with a ring
around the place to click. Click any picture to see it larger.

They ship in one [archive](app/pictures.bin), not from the player's game install.
Each one is padded to the same 480x270 box so narrow and wide films sit side by
side without the list jumping.

They are frames from IMMORTALITY and are **not** covered by this project's
licence. See [app/pictures.txt](app/pictures.txt) and the [NOTICE](NOTICE).

The game contains nudity and the point of it is not knowing what is on the tapes,
so they are packed into one archive rather than left as a browsable folder, the
app has disclosure controls, and the archive is fetched only when pictures are
requested. That is packaging and courtesy, not protection: it can be unpacked.

If a picture download fails, the tracker still works without it and retries when
pictures are next requested. A successful download is reused for the visit.

## How it works

`SaveGame.abr` is a .NET `BinaryFormatter` (MS-NRBF) stream and is *not*
encrypted. The tracker reads its records directly as data, without executing
game code or using .NET object deserialization. Files over 32 MiB are rejected,
and truncated streams are reported as damaged saves.

The browser and desktop share the same UI and clip logic. The native shell adds
save discovery and a file picker. Its requests are serialized so overlapping
operations cannot consume each other's replies.

<details>
<summary><b>Game Internals And Spoilers</b></summary>

### Where the clip list comes from

Everything the app knows about the game is in `app/clips.json`, generated by
`tools/make-data.py` from the game's own data: one 32 MB `MonoBehaviour` inside
`sharedassets4.assets` (the game's `MetaData`), plus the English string table in
`resources.assets` for the names it shows.

Neither has a type tree, so they are read field by field in the order the game's
own classes declare them (`MetaData`, `VideoData`, `MaskData`, `KeyData`,
`SubtitleData`, `SecretData`, `VideoLinkData` and `EntryPointData`, in
`Managed/Assembly-CSharp.dll`). Nothing is searched for or skipped, and the read
has to end on the table's last byte, so a change in the layout fails loudly
instead of producing plausible nonsense.

That gives what a spreadsheet cannot:

* Every clip's film, take and date, exactly as the game labels it.
* **Every** clickable thing in a clip, under the name the game shows for it, with
  its outline tracked frame by frame and whether it can be clicked at that moment.
* The game's own table of where a click can land, which decides every match-cut.
* The line actually spoken, which is the clip's first subtitle.

Checked against the community guide, 781 of its 792 match-cuts are confirmed by
the game's table. Of the other 11, 8 do cut in, but on a different object from
the one the guide names, and 3 go through a clip the table has no such cut from.

### Match-cuts

A click does what the game's `Database.DoSearch` does. It takes the outline's
name up to any `-`, adds every name in that outline's list of valid links (so a
chair also searches *director's chair* and *stage chair*), and looks each one up
in the game's table of where a cut on that name can land. It never lands on the
clip it starts from, and picks one of the rest at random, favouring clips you
have not watched as the game goes on.

So each route says how sure it is: *always cuts here* when the target is the only
place that click can land, otherwise how many other clips it might land on
instead. Usually those clips have the same thing, so a wrong cut can be clicked
again from there, and the route says *that have it too*. Where the game also
links it to similar things (a clock also searches watches), it can land on more
clips than hold it, and the route says separately in how many other clips the
same thing can be clicked. Routes are sorted by that. A few clips are held back
until enough of the game has been watched, and say so while they are.

### Drawing where to click

A clip's poster is rarely its first frame, so an outline drawn onto it misses
whatever has moved since. Every match-cut therefore gets its own frame, decoded
at a moment its outline is defined and clickable, so the ring and the picture
describe the same instant. The first half second is avoided, since it is often a
fade or the tail of the slate, and a frame that decodes blank is ruled out. The
game measures from the bottom left of the video; the generator maps that onto
the letterboxed picture once, so the app only places a ring.

Frame numbers count in each video's own rate, and the rates differ: most clips
run at 24 fps, but many at 48 and a few at 16 or 50. Assuming 24 sends every
picture from a 48 fps clip to twice the right time. The generator checks every
keyframe's stored frame number against its time to catch exactly that.

All 702 match-cuts have a ring, routes to the same object share a frame, and
every picture together is 3.3 MB.

### Film, take and date

The game stores these per clip and builds the label under each tile from them:
the film, the scene number and camera letter (*39B*), and the date. The
community guide agrees on every ordinary clip but three, and there the game
wins, since it is what you see on the grid: it labels both 240 and 241 *2OE 37*,
and 249 *2OE 51A* although its slate says 59A.

### Where the pictures come from

`sharedassets4.assets` holds one `Texture2D` per clip, named after its number
(`IMM_001` and on), the very ones the game's tiles use. That is the preferred
source for each clip's still: a clean, deliberately chosen frame. The few that
are missing, black, or one flat colour come from the video instead, as does
every match-cut frame.

Each clip ships as a Bink 2 file in `StreamingAssets`, 26 GB in all. Bink 2 is
RAD Game Tools' proprietary codec, and the game carries RAD's own runtime for it,
`Plugins/x86_64/bink2w64.dll`. The generator loads that and calls `BinkOpen`,
`BinkGoto`, `BinkDoFrame` and `BinkCopyToBuffer`, so every frame is decoded
exactly as the game plays it, straight from where it is, in about a tenth of a
second. That also makes the generator Windows only.

#### What the save holds

| Field | Used for |
| --- | --- |
| `Game.ViewHistory[].ClipID` | which clips you have watched |
| `ViewedSave.IsSupernatural` | how many secrets you have seen, which the ending counts |
| `Game.AssignedSecrets` | which clip each free-floating secret landed in *this* playthrough |
| `Game.TotalThemeA`, `B`, `C` | the three hidden scores that gates and the ending check |

`AssignedSecrets` is randomised per save, so no static guide can know it. That is
why the app can point at the exact clip to revisit instead of offering a vague
hint.

Clips marked by hand stand in for `ViewHistory`. The first view of a clip adds its
normalised theme vector to the three scores. The shipped metadata carries rounded
weights, so manual mode estimates those scores; save mode reads them directly.
Manual mode cannot know where each free-floating secret landed, so all its
possible clips are listed.

#### How many clips there are

288: 202 ordinary clips, 85 secrets and the ending. The game holds 290 videos;
289 is the ending's last shot and 290 the menu's backdrop. Secrets never appear
on the grid, so the game gives them no camera letter, and the free-floating
secrets and the ending belong to no film, so they are listed under *Other*.

#### How secrets open

No match-cut ever lands on a secret. A secret opens while a stretch of another
clip plays backwards at the right speed (`SecretData`). 52 of the 85 need half
speed, which holding <kbd>,</kbd> gives in any clip; the other 33 need 1x to 8x,
which the arrow keys give, though inside a clip that plays reversed they swap
direction. Each step names the clip, the moment and what to press.

* 70 secrets have one fixed entrance, with no luck involved. 19 of them sit inside
  another secret, so the steps walk the whole chain from the ordinary clip it
  starts in.
* 15 free-floating secrets can each turn up in a pool of up to 48 clips. Opening
  one of those clips, if it holds none yet, can place one there by chance, and it
  stays for good. The save records that, so the app shows the exact clip once it
  is placed, and otherwise only the clips still free.
* None opens before a little of the game has been watched (about 3%), and some
  need 10 to 30%. The game measures this with the theme scores every new clip
  adds to, so the app reads your save and says how far you are while one is
  still held back.

A secret is only used as the starting clip of a match-cut when no ordinary clip
holds the object. Two secrets' posters were never painted, so their stills come
from the video.

#### The ending

Clip 288 is the ending, and nothing leads to it. Each time you leave a clip for
the grid, `Game.CheckEndgame` starts it if 116 different clips have been watched
(40% of the game's 290 videos), a quarter of each of three hidden theme scores
is reached, 5 secrets and clips 188, 267 and 269 have been seen, and the clip you
just left is one of 73 key clips. Clip 288 then takes over the grid tile by tile
and plays into the credits. The app checks each condition against your save.

</details>

## Layout

```
app/                  the tracker, plain HTML, CSS and JS, no build step
  index.html          the page and its dialogs
  app.js              UI
  core.js             save reader and clip logic, no DOM
  loading.js          cancellation and loading-state ownership, no DOM
  native.js           serialized native bridge, no DOM
  style.css
  sw.js               offline cache for the installed web app
  clips.json          every clip and every way into it, from the game
  pictures.bin        a still per clip and a frame per match-cut, packed
  pictures.json       where each picture sits inside pictures.bin
shell/                native wrapper around app/
  Program.cs          window, and the bridge that finds and reads the save
  Messages.cs         what the page and the shell send each other
  SiteServer.cs       serves app/ from inside the executable
  SaveLocator.cs      the folders searched on each OS
tools/make-data.py    regenerates clips.json and the pictures from the game
tools/make-icon.ps1   regenerates shell/icon.ico and app/icon.png
tools/requirements.txt  tested generator dependencies
tests/               Node regression tests and headless desktop checks
.github/workflows/   shared checks, desktop builds and Pages deployment
```

There is **one** UI implementation. A desktop release embeds the web files from
the commit it was built from; the website follows `main`.

## Build

Use Node.js 24 for the tests and local web server. The desktop build also needs
the [.NET 10 SDK](https://dotnet.microsoft.com/download). Python and a game
installation are needed only when regenerating data.

### The web app

There is nothing to build. Serve the folder over HTTP (opening the file directly
stops it loading its data), with caching off so edits show on reload:

```bash
npx --yes http-server app -a 127.0.0.1 -p 8099 -c-1
```

GitHub Pages publishes the web folder after the shared checks pass when app or
deployment files change on `main`. Set **Source: GitHub Actions** in the repository
settings. During development, unregister the service worker in browser developer
tools if a cached copy obscures a failed network request.

### The desktop app

Windows uses the WebView2 Runtime, normally already installed. macOS uses its
built-in WebKit. On Linux, install WebKitGTK (`libwebkit2gtk-4.1-0`).

Downloads are unsigned. Only override an unknown-publisher warning for a release
you trust. On macOS, after attempting to open it, use **System Settings > Privacy
& Security > Open Anyway**, following [Apple's guidance](https://support.apple.com/en-us/102445).

```bash
dotnet run --project shell
```

Add `-- --dev` to that to turn on the webview's developer tools.

The shell serves only embedded assets at `http://127.0.0.1:48288`. If that port is
unavailable, it shows an error instead of opening a different progress store.
Close the conflicting process and reopen the tracker. Your marks are not changed.

`app/` is embedded into the assembly, so the published executable carries the
whole tracker. Any `-r` runtime identifier switches on the single-file settings:

```bash
dotnet publish shell -c Release -r win-x64 -o dist
```

CI builds `win-x64`, `osx-arm64`, `osx-x64` and `linux-x64`. Windows and Linux
ship the bare executable; macOS ships a `.dmg`, because a GUI program there has
to be an `.app` *bundle*, a folder, and a folder cannot be a release asset.

#### Why a webview and not a native toolkit

The app reads a file and renders a list. Writing that screen twice, once in XAML
and once in HTML, would mean making and verifying every change in both. The
shell hosts the web build in the operating system's own webview
(WebView2, WKWebView, WebKitGTK), so there is a single UI to maintain and the app
looks exactly like the website.

What the desktop build adds over the browser is `SaveLocator`: it knows the Unity,
Steam, Proton and Flatpak paths and finds the save without being told. That is the
reason it exists.

### Tests

No npm packages or personal save files are needed:

```bash
node --test tests/*.test.cjs
dotnet run --project tests/shell -c Release
dotnet build shell -c Release
```

The Node tests cover progress codes, search, valid synthetic saves, malformed and
oversized saves, generated-data references, packed pictures, overlapping and cancelled loads,
native request ordering and offline caching. Parser fixtures are generated in
memory, including object references and unused history slots; no personal save
is checked in. The headless .NET checks exercise fragmented HTTP requests,
header validation and save-file scanning without opening a webview. The shared
[checks workflow](.github/workflows/checks.yml) runs both on Windows, macOS and
Linux before desktop builds and Pages deployment.

For UI changes, also check keyboard marking, import/export, switching between
save and manual mode during a delayed read, reload persistence, blocked storage,
closing the marking dialog during a delayed import, picture-download recovery
and narrow-screen layouts in a browser.
Test native storage with a temporary `WEBVIEW2_USER_DATA_FOLDER` on Windows so
tests do not overwrite real marks. macOS and Linux still need platform-specific
runtime smoke tests; compilation alone does not verify their webview behavior.

### Regenerating Data

[tools/make-data.py](tools/make-data.py) reads a local Windows game installation
and regenerates the shipped metadata and pictures. No save file is needed.
The current setup is tested with Python 3.13 and the direct dependencies in
[tools/requirements.txt](tools/requirements.txt):

```powershell
python -m venv tools/.venv
.\tools\.venv\Scripts\python -m pip install -r tools/requirements.txt
.\tools\.venv\Scripts\python tools/make-data.py "<game>/Immortality_Data"
node --test tests/*.test.cjs
```

Decoded pictures are cached under `tools/.work`. Clear that generated cache when
changing the game installation or picture-generation logic, then regenerate.
Do not hand-edit the generated data. The app and normal CI tests use the shipped
assets and do not need the game or Python dependencies.

The [icon generator](tools/make-icon.ps1) is also Windows-only. Virtual
environments, decoded-frame caches, build output and personal saves are ignored
by git. The local Steam-guide working folder stays excluded and is not needed
to build or test the app.

### Local Guide Artwork

The optional `steam-guide/` authoring folder is deliberately excluded from git.
When that folder is present, its Windows artwork generator and local checks run
with the project environment:

```powershell
.\tools\.venv\Scripts\python -m pip install -r steam-guide/requirements.txt
.\tools\.venv\Scripts\python steam-guide/make-art.py
.\tools\.venv\Scripts\python steam-guide/make-art.py --check
```

The generator handles banners, the preview and the thank-you animation.
Screenshots are captured separately in a fresh test browser profile, using
synthetic progress. Hide complete totals and progress bars, replace game frames
with opaque placeholders, and redact clip labels and progress codes before
capture. Blurring a frame is not sufficient. Keep these capture-only changes out
of the app source.

The local check verifies image references, file integrity, dimensions, animation
and balanced spoiler tags. A visual spoiler and text-layout review is still
required. These authoring tools and images are not part of the application build.

### Releasing

Commit and push the tested changes to `main` before tagging so the website and
desktop release use the same source. Replace `X.Y.Z` with an unused version:

```bash
git tag -a vX.Y.Z -m "Release X.Y.Z"
git push origin vX.Y.Z
```

The tag runs the checks, builds all four platforms and publishes a GitHub release
with the binaries attached. It also sets the assembly version. Tags do not deploy
Pages, and published tags should not be moved to another commit.

## Credits

This is mostly glue. The work it is built on:

| | |
| --- | --- |
| [The clip list](https://steamcommunity.com/sharedfiles/filedetails/?id=3342793414) | first mapped every clip's film, take and date; used here as a cross-check for the game's own data. Derived in turn from the [completionist guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2860754029) |
| [Reading the save](https://steamcommunity.com/sharedfiles/filedetails/?id=3731545899) | worked out that `SaveGame.abr` holds your view history |
| [The idea](https://steamcommunity.com/sharedfiles/filedetails/?id=3204009205) | the original "which videos have I missed" counter |

The same list is under **About**.

Made by [XxSeRyIxX](https://steamcommunity.com/id/xxseryixx/).

## Licence

[GNU AGPL v3](LICENSE) or later. You are free to use, study, modify and share
it. If you distribute a modified version, or run one as a network service, you
have to publish your source under the same licence.

The pictures are **not** covered by that licence. They are frames from
IMMORTALITY, copyright Half Mermaid Productions, included only as small pictures
and not licensed for redistribution. A fork may take the code, but not those. See
[NOTICE](NOTICE) and [app/pictures.txt](app/pictures.txt).

Not affiliated with, endorsed by, or connected to Half Mermaid or Sam Barlow. If
you hold the rights and want the pictures removed, open an issue and they will go
immediately, no questions asked.
