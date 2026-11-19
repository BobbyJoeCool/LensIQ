# Changelog

All notable changes to LensIQ are listed here. Versions follow [Semantic Versioning](https://semver.org/). Work before v1.0.0 is tracked in the [GitHub issues](https://github.com/BobbyJoeCool/LensIQ/issues?q=is%3Aissue+Phase).

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
