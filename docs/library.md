# Saved designs and uploads

My designs keeps your work in this browser. Save a named design, organise it in a folder, add tags or mark it as a favourite. The library does not sign you into an account or synchronise between devices. Download a library backup before clearing browser data or moving to another machine.

Deleting a design moves it to Trash. Restore brings back its name, content, folder, tags, favourite and saved versions. Permanent deletion and Empty Trash remove those records from the library. Separate downloaded backups and migration recovery copies are not erased by these actions.

**Keeps the last five saved versions.** Saving changed content or renaming a design retains its previous content and name. Older versions fall outside this fixed retention window. Changes to folders, tags or favourites do not add content versions. Restoring a version keeps the previously current content as a saved version, within the same five-version window. Clear versions removes history while keeping the current design. Undo in the editor is separate from these durable saved versions.

The library holds up to **100 designs including Trash**, **50 folders**, and **18 MiB** of serialised data including saved versions. Each design can have **12 tags**, up to 40 characters each. Browser storage may fill before the application limit. An oversized or failed write leaves the prior stored library intact; it never removes extra history or designs to force a save through. Export a backup, then explicitly clear versions or permanently delete records from Trash to make room.

Uploads is a separate raster shelf for reusable PNG, JPEG, WebP and GIF images. It holds up to **20 uploads and 8 MiB** of serialised shelf data. Uploads stay in this browser and can be exported separately. A placed image becomes embedded in its design; removing its shelf copy does not remove that image from existing designs. Licence details are optional facts supplied with an upload, not a claim that an image is free to redistribute. Only add images you have permission to use.

## Library API

All storage functions are synchronous. Pass a Storage-compatible object as the documented `storage` argument for tests; omitted storage uses `localStorage`. Returned records are independent clones. `listDesigns` keeps its original `{ id, name, updatedAt }` result shape. `listDesignSummaries` adds `folderId`, `tags`, `favourite`, `versionCount`, lightweight `versions`, `pageCount` and a cloned `firstPage` preview.

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
  updateDesignMetadata(design.id, { favourite: true }, localStorage, {
    expectedUpdatedAt: design.updatedAt,
  })
);
```

The lock waits up to five seconds. If Web Locks are unavailable, a local queue and exact stored-value checks detect many stale writes; they cannot guarantee atomic writes between separate tabs. The UI must keep local edits open when a conflict occurs. Capture the active document and binding before waiting; changed edits must never be saved to another design or discarded by a delayed open action.

## Format and migration

The storage key stays `stencil-studio.library.v1` for compatibility and so existing tabs use the same lock. The canonical library format is now:

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

`tests/consumer/library-organisation.test.js` uses fictitious in-memory data to check legacy migration, exact recovery copies, folders and metadata, Trash recovery and count limits, rolling saved versions, quota failures, bounded-history budget failures, stale revisions, malformed imports and concurrent writes during migration. Upload tests cover their separate persistence and validation boundaries. Real mobile devices, browser storage quotas and cross-tab behaviour require the coordinator's browser checks.
