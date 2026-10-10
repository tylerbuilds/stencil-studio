# Saved designs and uploads

Choose **Save design**, give it a name, then open it again from **My designs**. Organise designs in folders, add tags or mark favourites. Your designs stay in this browser; they do not synchronise between devices. Download a library backup before clearing browser data or moving to another machine.

Stencil uses IndexedDB for the open draft, named designs and uploads. This avoids the much smaller localStorage limit shared by other apps on the same website. Existing designs, uploads and recovery copies move into the new store automatically, with their exact original data retained. The earlier localStorage copies are left untouched. A save is confirmed only after the browser commits its transaction.

Deleting a design moves it to Trash. Restore brings back its name, content, folder, tags, favourite and saved versions. Permanent deletion and Empty Trash remove those records from the library. Separate downloaded backups and migration recovery copies are not erased by these actions.

**Keeps the last five saved versions.** Saving changed content or renaming a design retains its previous content and name. Older versions fall outside this fixed retention window. Changes to folders, tags or favourites do not add content versions. Restoring a version keeps the previously current content as a saved version, within the same five-version window. Clear versions removes history while keeping the current design. Undo in the editor is separate from these durable saved versions.

The library holds up to **100 designs including Trash**, **50 folders**, and **18 MiB** of serialised data including saved versions. Each design can have **12 tags**, up to 40 characters each. Browser storage may fill before the application limit. An oversized or failed write leaves the prior stored library intact; it never removes extra history or designs to force a save through. Export a backup, then explicitly clear versions or permanently delete records from Trash to make room.

Uploads is a separate raster shelf for reusable PNG, JPEG, WebP and GIF images. It holds up to **20 uploads and 8 MiB** of serialised shelf data. Uploads stay in this browser and can be exported separately. A placed image becomes embedded in its design; removing its shelf copy does not remove that image from existing designs. Licence details are optional facts supplied with an upload, not a claim that an image is free to redistribute. Only add images you have permission to use.

## Library API

The library functions remain synchronous. Pass a Storage-compatible object as the documented `storage` argument for tests; omitted storage uses the configured browser adapter, or localStorage before one is configured. Browser writes must run inside an awaited `withLibraryLock`. This stages the synchronous changes and resolves only after the IndexedDB commit. Returned records are independent clones. `listDesigns` keeps its original `{ id, name, updatedAt }` result shape. `listDesignSummaries` adds `folderId`, `tags`, `favourite`, `versionCount`, lightweight `versions`, `pageCount` and a cloned `firstPage` preview.

| Function | Result or behaviour |
| --- | --- |
| `saveDesign(document, { id?, name?, expectedUpdatedAt?, folderId?, tags?, favourite? }, storage)` | Creates or updates a named design; returns its record. |
| `loadDesign(id, storage)` | Returns an active design document. |
| `renameDesign(id, name, storage, options?)` | Renames the design and document title; retains prior content. |
| `duplicateDesign(id, storage, options?)` | Copies current content and organisation, with an empty version history. |
| `listFolders(storage)` | Folder records plus active `designCount`, sorted by name. |
| `createFolder(name, storage)` | Returns `{ id, name, updatedAt }`. |
| `renameFolder(id, name, storage, options?)` | Returns the updated folder. |
| `deleteFolder(id, storage, options?)` | Unfiles contained active and trashed designs; does not delete them. |
| `updateDesignMetadata(id, { folderId?, tags?, favourite? }, storage, options?)` | Updates organisation; returns the updated record. Use `folderId: null` for unfiled. |
| `deleteDesign(id, storage, options?)` | Moves an active record into Trash; returns `true`. |
| `listTrash(storage)` | Summaries and previews, including `deletedAt`, newest deletion first. |
| `restoreDesign(id, storage, options?)` | Restores a trashed design and returns its updated record. |
| `permanentlyDeleteDesign(id, storage, options?)` | Removes only a trashed record; returns `true`. |
| `emptyTrash(storage)` | Explicitly removes all Trash records; returns their count. |
| `listDesignVersions(id, storage)` | Newest first: `{ id, name, savedAt, pageCount, documentVersion }`, without full documents. |
| `restoreDesignVersion(id, versionId, storage, options?)` | Restores saved content/name and returns the updated design record. |
| `clearDesignVersions(id, storage, options?)` | Removes an active design's snapshots and returns its updated record. |
| `exportLibrary(storage)` | A complete v2 JSON backup, including folders, Trash and history. |
| `importLibrary(payload, { mode?: 'merge' \| 'replace' }, storage)` | Validates the entire backup before writing. Merge skips identical records and rejects conflicting identities; replacement is explicit. Returns `{ imported, skipped, total }` for active designs. |

Mutation `options` accept `expectedUpdatedAt`. Supply the timestamp shown to the person approving the action. A newer saved revision raises `LibraryError` with `code: 'design-conflict'`. Timestamps strictly increase even when the clock rolls backwards or two actions occur in the same millisecond. After a mutation, refresh an active design's binding with the returned timestamp. Folder deletion also advances timestamps of designs it unfiles; refresh those bindings too.

Wrap browser mutations with `withLibraryLock` so cooperating tabs take the same exclusive Web Lock around the fresh read and write:

```js
const saved = await withLibraryLock(() =>
  updateDesignMetadata(design.id, { favourite: true }, undefined, {
    expectedUpdatedAt: design.updatedAt,
  })
);
```

The lock waits up to five seconds. IndexedDB also serialises writes between tabs, including browsers without Web Locks. Each transaction reads the current stored data before the synchronous callback runs. A failed commit publishes neither the staged cache nor a successful result. The localStorage fallback retains its earlier drift checks, but cannot make writes atomic between separate tabs; use one editing tab in that mode. The UI keeps local edits open when a conflict occurs. Capture the active document and binding before waiting; changed edits must never be saved to another design or discarded by a delayed open action.

### Initialise a browser integration

```js
import { createBrowserStorage, configureBrowserStorage } from './src/durable-storage.js';
import { createBlankDesign } from './src/model.js';
import { withLibraryLock, saveDesign } from './src/library.js';

const storage = await createBrowserStorage();
configureBrowserStorage(storage);
const design = createBlankDesign({ title: 'New poster' });
const saved = await withLibraryLock(() => saveDesign(design, { name: design.title }));
console.log(saved.id); // Returned after the transaction completes.
```

Prepare files and other asynchronous inputs before calling a transaction. The callback must finish synchronously; returning a promise aborts the write. Outside `run`, `storage.getItem(key)` reads the committed cache; inside its callback it reads the fresh transaction snapshot, including staged changes. `storage.run(() => ...)` allows synchronous `setItem`/`removeItem` calls, then commits atomically. Writes outside `run` throw. `storage.refresh()` reloads committed data; `storage.subscribe(({ keys, external }) => ...)` reports changed keys without changing the open canvas. BroadcastChannel refreshes other current-version tabs when available; every write still reads fresh data if that channel is unavailable.

The database is `stencil-studio.local-designs`, version 1, with a `records` object store and `keyPath: 'key'`. Records are `{ key, value }`, with string values. The draft, library and upload keys keep their earlier names. `@legacy:<key>` retains the JSON-encoded exact earlier source; `@legacy-import-complete` prevents a later reload from importing stale localStorage over newer IndexedDB data. Other apps' records are neither copied nor modified. A failed initial transfer leaves its database transaction and all original localStorage records unchanged.

### Keep data changed by an earlier tab

An older Stencil tab can still write localStorage after the transfer. Stencil detects a changed source and pauses writes to that record, keeping your current canvas open. Close the older tab, then choose **File → Earlier tab data**. **Keep both copies** stores an exact recovery file for the earlier tab's data, keeps the current IndexedDB record, and lets you retry your save. Download the earlier design, library or uploads from that window and use the normal JSON or backup import controls if you want its changes. No localStorage records are deleted or overwritten.

The browser adapter exposes the same steps for integrations:

```js
const review = await storage.inspectLegacyChanges();
// Show review.changes (key, kind, bytes and deleted) and ask the person to choose.
const kept = await storage.keepBothLegacyCopies(review.token);
for (const key of kept.recoveryKeys) {
  const exactEarlierJSON = storage.readLegacyRecovery(key);
  // Offer exactEarlierJSON as a downloaded file, then retry the intended save.
}
```

Only the latest review token is accepted. The acknowledgement checks the captured earlier source, current record and previous source baseline again inside the transaction. If any changed while the window was open, review again. `listLegacyRecoveries()` returns `{ key, kind, bytes }` for downloadable recovery files. An immutable `@legacy-original:<key>` also retains the exact first transferred source after later acknowledgements. Recovery holds up to six files and 32 MiB of UTF-8 data; reaching either limit blocks acknowledgement without discarding any copy. Download an earlier recovery before explicitly deleting it to make room. Integrations must ask for confirmation before calling `removeLegacyRecovery(key)`, which deletes only that recovery file after a guarded commit. It cannot remove a draft, library, uploads shelf or original transferred source. A browser quota failure also leaves all earlier records unchanged. If the earlier source was deleted, the current record and original transferred source remain kept.

An older tab may also create a migration or recovery file after the initial transfer. When a transaction reads one of those backup keys, Stencil copies its exact earlier bytes into the transaction and checks that the source stayed unchanged before committing. An existing backup with different bytes makes migration choose another name. This preserves earlier recovery files without leaving an otherwise acknowledged save blocked; it does not acknowledge a changed draft, library or uploads record.

## Format and migration

The record key stays `stencil-studio.library.v1` for compatibility and so existing tabs use the same lock. The canonical library format is now:

```js
{
  schema: 'stencil-studio-library', version: 2,
  folders: [{ id, name, updatedAt }],
  designs: [{ id, name, updatedAt, document, folderId, tags, favourite, versions }],
  trash: [{ id, name, updatedAt, document, folderId, tags, favourite, versions, deletedAt }]
}
```

Versions are `{ id, name, savedAt, document }`, oldest first in storage. Record, folder and snapshot IDs are distinct. Folder references must exist. Version dates must be ordered and precede the current saved timestamp. Imports reject unsupported fields, malformed dates, unsafe document data, duplicate identities, invalid metadata, prototype tricks, hidden properties, accessors and cycles before a storage write.

Existing v1 libraries open without an immediate write. Their records acquire unfiled, empty-tag, unfavourited and empty-history defaults, and documents pass through the model's supported migrations. The first successful mutation preserves the exact v1 source in a separate migration recovery key before updating the active library. Model upgrades also preserve the exact source when an active, trashed or historical document uses an earlier model version. If a backup cannot fit, the active library stays unchanged. Sparse earlier API-produced v2 records can omit organisation fields, folders or Trash; missing fields become empty defaults. Explicit null values are accepted only for `folderId`.

## Upload API

`src/uploads.js` exports `saveUpload(input, options, storage)`, `listUploads(storage)`, `loadUpload(id, storage)`, `renameUpload(id, name, storage, options)`, `deleteUpload(id, storage, options)`, `exportUploads(storage)`, `importUploads(payload, options, storage)` and `withUploadsLock`. Save input contains `name`, embedded raster `src`, `width`, `height` and optional `licence`. Records also contain derived `mime`, decoded `bytes`, `id` and `updatedAt`.

Licence fields are optional `name`, `creator`, `sourceUrl`, `licenceUrl` and `attribution`. Source and licence URLs remain metadata; importing a shelf never fetches them. Raster signature/header checks validate format and dimensions but do not fully decode pixels. Browser intake must decode the image successfully before adding it to the shelf. Upload writes use their own lock and conflict checks. They do not change the design library or open document.

## Checks

`tests/consumer/library-organisation.test.js` uses fictitious in-memory data to check format migration, exact recovery copies, folders and metadata, Trash recovery and count limits, rolling saved versions, quota failures, bounded-history budget failures, stale revisions, malformed imports and concurrent writes during migration. `tests/consumer/durable-storage.test.js` checks transactional publication, quota/security aborts, a large image design with versions and uploads, two-tab writes without Web Locks, stale drafts, older localStorage writers and cancelled saves. Its atomic backend fixture does not emulate IndexedDB request timing; native browser acceptance tests the real driver. Upload tests cover their separate validation boundaries.

IndexedDB still has browser quotas, and private browsing or clearing site data can remove saved work. Keep downloaded backups. See the [IndexedDB transaction specification](https://www.w3.org/TR/IndexedDB/#transaction-construct) for commit and abort behaviour, and [browser storage limits](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) for the distinction between localStorage and IndexedDB quotas.
