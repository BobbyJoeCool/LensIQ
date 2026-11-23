# Changelog

All notable changes to LensIQ are listed here. Versions follow [Semantic Versioning](https://semver.org/). Work before v1.0.0 is tracked in the [GitHub issues](https://github.com/BobbyJoeCool/LensIQ/issues?q=is%3Aissue+Phase).

## [1.3.0] - 2026-11-22

### Added

- **Color rows by a status or select.** A **Color rows by** setting at the top of a table's **Highlight** menu tints each row with its option's Notion color. Highlight rules still win, so they work as exceptions. A legend of the colored badges in use sits above the table, so the property's column can be hidden to save space. Options with Notion's Default color, and empty values, stay uncolored. ([#64](https://github.com/BobbyJoeCool/LensIQ/issues/64))

### Fixed

- A long **Highlight** menu now scrolls all the way to its last rule and **+ Add rule**. The same fix applies to the Filter, Sort and Properties menus, which now fit in the room below their button. ([#63](https://github.com/BobbyJoeCool/LensIQ/issues/63))

## [1.2.0] - 2026-11-20

### Added

- **Chart values without hovering.** A **Show values** setting writes each value on its bar, segment, slice or point, as the value, its percent of the whole chart, or both. Percent is offered for count and sum on bar and donut charts. Labels that don't fit are hidden, and line and area charts label points when there are 24 or fewer. ([#56](https://github.com/BobbyJoeCool/LensIQ/issues/56))
- **Chart totals.** Count and sum charts can show a total: a **Total** bar at the end of a bar chart (split like the other bars), the total in the middle of a donut, or above a line or area chart. It counts each row on the chart once and follows the view's filters. ([#52](https://github.com/BobbyJoeCool/LensIQ/issues/52))
- **Calendar colors.** A **Color by** setting colors each calendar event with the Notion color of a status or select property. New calendars color by the first status property. ([#55](https://github.com/BobbyJoeCool/LensIQ/issues/55))
- **Conditional highlighting on tables.** A **Highlight** menu holds rules: a color, the whole row or one column's cell, and conditions built like filters (and/or). When several rules match, the first one wins, and rules can be reordered. ([#51](https://github.com/BobbyJoeCool/LensIQ/issues/51))

### Changed

- **Dashboards on top.** Dashboards come before databases in the menu and the phone's top bar, and LensIQ opens on the first dashboard (or the first database when there are none). Up and down buttons beside each dashboard set the order. ([#50](https://github.com/BobbyJoeCool/LensIQ/issues/50))
- README screenshots show the new features.

## [1.1.0] - 2026-11-20

### Added

- Dashboard tiles have a height: **Short (½)**, **Standard** or **Tall (2×)**, next to the width setting. Two short tiles stack beside a standard one, and a later tile that fits moves up into an empty space. On a phone, tiles still size to their content. ([#54](https://github.com/BobbyJoeCool/LensIQ/issues/54))

### Changed

- The row panel holds your edits until you press **Save**, then sends them to Notion together. **Cancel**, ×, Escape or tapping outside with unsaved edits asks whether to save, discard or keep editing. If a property was changed in Notion in the meantime, nothing is saved and you choose whose values to keep. Inline table edits and board drags still save immediately. ([#57](https://github.com/BobbyJoeCool/LensIQ/issues/57))

### Fixed

- In the iPhone home-screen app, the row panel's × sat under the status bar, so the panel couldn't be closed. The panel now stays clear of the status bar and the home indicator. ([#57](https://github.com/BobbyJoeCool/LensIQ/issues/57))
- On a dashboard, a board (or table, chart or calendar) next to a taller tile now fills its tile instead of stopping partway down. ([#54](https://github.com/BobbyJoeCool/LensIQ/issues/54))

## [1.0.0] - 2026-11-18

First release. LensIQ is a self-hosted app that adds tables, boards, charts, calendars and dashboards on top of Notion databases, and writes every edit back to Notion.

### Connect Notion databases

- Paste a Notion database link or ID to connect it. LensIQ reads the database's columns and builds its views from them, with no code per database.
- Works with every common Notion property type, including formulas, rollups, relations, files, people and unique IDs. Types LensIQ can't show are labelled rather than hidden.
- Opening a database shows its cached rows at once, then reloads them from Notion. While it's open, LensIQ checks Notion for changes every 60 seconds, and **Refresh** reloads on demand.

### Edit Notion from LensIQ

- Edit cells inline on a computer, or in a row panel on a phone. Every change is written straight to Notion.
- Add rows, and delete rows to Notion's trash.
- Type a new option into a select or multi-select to create it in Notion.
- Link related pages by title with a searchable picker.
- No silent overwrites: if a cell was changed in Notion since you loaded it, LensIQ shows both values and you choose which to keep.
- Text with formatting or links stays read-only so an edit can't strip it; edit it in Notion instead.

### Views

- Every database has view tabs, like Notion: add, rename, duplicate, reorder and delete views.
- **Table:** filters (all or any), multi-column sorting, and show, hide or reorder columns.
- **Board:** cards grouped by any select or status column. Drag a card to another group to change it in Notion. Choose which fields show on cards.
- **Chart:** bar (vertical, horizontal or stacked), line, area, donut and number tiles. Count, sum, average, minimum or maximum. Group dates by day, week, month or year, and split into series by another column. Colors are colorblind-safe and keep Notion's option colors. Every chart has a legend and a **Show data** table.
- **Calendar:** rows on a month grid by any date column. Drag a row to another day to change its date, or add a row on a day. On a phone it's an agenda list.
- Views keep working when a column is renamed in Notion. A view that uses a deleted column says so instead of breaking.

### Dashboards

- Build any number of named dashboards, each a grid of views from any databases.
- Tiles can be a third, half, two thirds or full width, and stack into one column on a phone.

### Phone, backups and security

- Add LensIQ to the iPhone home screen and it opens like an app. Notion data is never cached offline, so it's always current.
- Export views and dashboards to a JSON file, and import them on a new install.
- Runs as one Docker container behind Cloudflare Access. The Notion token stays on the server, and every request must come through Cloudflare Access.
- Notion requests are spaced to stay under Notion's rate limit.

### Public demo

- A [live demo](https://bobbyjoecool.github.io/LensIQ/) with made-up sample data runs entirely in the browser. Nothing reaches Notion, and a reload resets it.

[1.0.0]: https://github.com/BobbyJoeCool/LensIQ/releases/tag/v1.0.0
