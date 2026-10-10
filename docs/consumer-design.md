# Make a design from scratch

Choose **New design** in the header, give your design a name and pick a canvas size. You can use a preset or enter a custom width and height. Choose **Create design** to start with an empty canvas.

Your current design is kept in **My designs** before you switch. If the browser cannot keep that copy, your current canvas stays open. Choose **Download current design** to keep a JSON copy. This does not unlock New design: make room in **My designs** or restore browser saving, then try again. You can also start from an original design in **Templates**.

## Add shapes and text

Open **Elements** to add text, a rectangle, circle, triangle, diamond, star, line or arrow. Select it on the canvas to change its size, position, rotation and colour. Filled shapes have separate fill and outline colours. A line has a line colour and width. Resize a circle to make an oval.

For text, choose a font, size and alignment in the inspector. Changes apply when you finish editing a field. Drag a selected object to move it, or use the arrow keys for small adjustments. Hold **Shift** with the arrow keys to move ten pixels at a time.

## Draw with a brush

Choose **Draw** or press **B**, pick a colour and brush width, then drag on the canvas. A click makes a dot. Each stroke becomes its own **Brush stroke** layer, and **Undo** removes the last stroke.

Choose **Select**, press **V** or press **Escape** to stop drawing. Select a stroke to move, resize, rotate or recolour it. You can also copy, duplicate or group it with other layers. Switching pages or cancelling a stroke leaves it out of the saved design.

The brush is round, with widths from 1 to 80 pixels. It has no pressure sensitivity or partial eraser. Long strokes are simplified to keep files manageable, with up to 2,000 stored points. Their first and last points are kept.

## Put layers in order

The top row in **Layers** sits in front of the others. Drag a row above or below another, use its arrows, or select a layer and choose **Bring to front** or **Send to back**. **Cmd/Ctrl + ]** and **Cmd/Ctrl + [** do the same.

Shift-click to select several layers, then choose **Group** to keep them together. Groups move and change order as a whole. **Alt-click** selects one object inside a group.

Lock a layer to stop it moving or changing. A locked layer also protects the rest of its group; unlock it before editing that group. Hidden layers stay in the design but do not appear on the canvas or in downloads. Locked layers still appear.

## Change pages and line things up

Use **＋** beside the page tabs to add a blank page. **Duplicate page** makes a copy. **Page order** moves the current page earlier, later or to a numbered position. Undo brings it back.

Open **Guides & rulers** to show rulers and add guides. Click a ruler, drag a guide into place or enter an exact position. Choose what layers snap to and how close they need to be. Hold **Alt** while dragging to ignore snapping. Guides do not appear in downloads.

With nothing selected, the inspector shows the canvas size and background. **Scale the layout when resizing** resizes unlocked layers along with the page. Guides scale too; without that option, they stay at their current position where possible.

## Add a table or chart

Choose **Table** or **Chart** in **Elements**, fill in the grid and save. Select it later and choose **Edit data** to change its values without starting again.

Tables have up to 8 columns and 50 rows. You can change their header, text, fill and borders in the inspector. Charts have up to 30 labels, with values of zero or more. Bar, line and pie charts use the same values; a pie chart needs at least one positive value.

To paste CSV, open **Paste or copy CSV**, paste your data and choose **Load CSV into the grid**. Quoted commas, quotes and line breaks are kept. Cells are text, not spreadsheet formulas. Tables and charts from older designs may be groups of ordinary layers; those do not have a data grid to reopen.

## Make several versions from CSV

Put a placeholder such as `{{name}}` in a text layer or page name. Open **Create pages from CSV** and add a matching `name` column. Each row makes a separate copy of the current page, up to 30 rows. For example, `Hello {{name}}` can become a different greeting on every card.

## Save a copy and download

**My designs** in the header opens your library. Each card shows its first page, size and saved date. Search for a name or change the sort order, then choose **Open design** to carry on editing. Your current changes are saved before switching; if that fails, the current canvas stays open. **Open a file** lets you continue a Stencil JSON design from your device.

**Save design** asks for a name. **Save changes** updates the named design you opened, while **Save a copy** keeps a separate version. Rename or duplicate from a card. Delete asks before removing the saved design; the current canvas stays open. **Library backups** downloads all your saved designs together or adds designs from a backup.

When another tab changes a saved design, your edits stay on the canvas. Save a copy or reopen the newer version. A stale tab cannot silently replace the latest autosaved draft. Named saves use Web Locks where available; without that browser feature, work in one editing tab at a time because simultaneous saves cannot be made atomic across tabs.

**File → Save JSON** downloads every page as an editable Stencil file. Use **Open JSON** to continue it later. A JSON file dropped onto the canvas asks before replacing your current design. Undo brings the previous design back while the tab remains open.

Choose **Download** for PNG, JPG, SVG or an all-page PDF. For a transparent PNG or SVG, click empty canvas space and enable **Transparent background**. JPG and PDF use the chosen background colour. PDF keeps the layout as images and adds positioned searchable, selectable native text. It is not a fully vector or tagged PDF. **Print / Save PDF** uses your browser's print dialog.

## File limits and older designs

A design can have 30 pages, 300 layers per page and 1,000 layers in total. Canvas sizes run from 64 to 4,096 pixels per side. Images are limited to 16,384 pixels on either side and 40 million pixels in total, including images embedded in imported designs or library backups. JSON files can be up to 12 MiB, and the library holds up to 100 designs, including Trash, within an 18 MiB limit. Your browser can run out of storage sooner.

Stencil updates older designs when you open them and keeps their original JSON before overwriting a saved copy. If that backup cannot be saved, autosave and New design pause to keep the original. **Recovery data** in File downloads the original when available; **Save JSON** downloads your new work. Downloading alone does not resume saving or unlock New design. Once browser saving works again, download your new work and the original file (if offered) before reloading to retry the original backup. Then open your new JSON file to continue. Clearing browser data removes local copies, so keep the downloads somewhere safe.

New files use version 5 and cannot be opened in the older version 4 app. Use the original backup if you need to go back. Existing data, pages, guides, crops, groups and image settings are kept when updating an older design. [File and clipboard details](research/core-workflows.md) and [release checks](verification.md) cover the technical limits and checks.

## Organise and reuse

In **My designs**, create folders, add tags under **Details**, or star a favourite. Search covers names and tags. Twelve previews appear at a time; use Previous and Next to browse a larger library. Deleted designs stay in **Trash** until restored or permanently removed. Library backups include folders, Trash and saved versions.

**Versions** keeps the previous five named saves. Restore one to open it for editing. Large images or audio can fill the library byte limit before those five versions fit; remove saved versions or download a backup to free space. No version is silently discarded to bypass a storage failure.

Use **Your uploads** in Assets to keep reusable images. An uploaded image becomes embedded when placed in a design. Removing the shelf copy leaves existing designs intact. Upload backups are separate from design-library backups.

## Fonts and photo frames

Select text to change its font, italic, underline, shadow or outline. Effects apply to the whole text layer. Six open font families are bundled, with synthetic italic for upright faces. Gradient controls apply to text, filled shapes and the page background.

Add a frame or collage in **Elements**. Collage frames are individually selectable. Choose one image per selected frame, then use **Crop & position** to drag or zoom it inside the shape. Ordinary images can be turned into frames or cropped to common aspect ratios. SVG exports embed the chosen bundled fonts; image, video and PDF exports use them too.
