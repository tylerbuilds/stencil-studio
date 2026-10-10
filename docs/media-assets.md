# Photos and fonts

Stencil includes a small offline photo set and six open font families. Nothing is downloaded from Google, Wikimedia, Unsplash or another provider while you use the editor. The browser requests bundled files from the same place as the app.

## Size and loading

- 12 photographs and photographic backgrounds: 1,721,126 bytes of WebP files.
- Six font families: 421,628 bytes of WOFF2 files, including regular/bold weights and Latin/Latin Extended subsets.
- The photo catalogue opens when Photos is selected. Thumbnails use lazy loading; inserting a photo checks its size, dimensions and SHA-256 before passing an embedded image to the editor.
- Fonts load when a design uses them. SVG export embeds the used families as data URLs, together with their complete SIL Open Font Licence notices. Raster and video exports must use that SVG CSS as well as wait for font loading.

## Font sources

These are official Google Fonts WOFF2 distributions, downloaded on 10 October 2026 without modifying the font files. Copyright and licence notices are kept beside the files in `public/fonts`. The licence texts were fetched from Google Fonts commit `bd8f81ddb5c74d5c8897b36ad88b440266245103`. Each file, source URL and hash is recorded in `public/fonts/provenance.json`.

The [SIL Open Font Licence 1.1](https://openfontlicense.org/open-font-license-official-text/) allows fonts to be bundled and embedded with their notices. The font files keep that licence; the Stencil code is MIT.

| Family | Use | Upstream licence |
| --- | --- | --- |
| DM Sans | Everyday sans | [OFL-1.1](https://github.com/google/fonts/blob/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/dmsans/OFL.txt) |
| Space Grotesk | Geometric sans | [OFL-1.1](https://github.com/google/fonts/blob/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/spacegrotesk/OFL.txt) |
| Fraunces | Expressive serif | [OFL-1.1](https://github.com/google/fonts/blob/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/fraunces/OFL.txt) |
| Libre Baskerville | Reading serif | [OFL-1.1](https://github.com/google/fonts/blob/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/librebaskerville/OFL.txt) |
| Bricolage Grotesque | Display | [OFL-1.1](https://github.com/google/fonts/blob/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/bricolagegrotesque/OFL.txt) |
| IBM Plex Mono | Monospaced | [OFL-1.1](https://github.com/google/fonts/blob/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/ibmplexmono/OFL.txt) |

Arial, Georgia and Courier New remain available as system fonts. The new files cover Latin and Latin Extended text; other scripts use the browser’s fallback fonts. Dedicated italic font files and user-uploaded fonts are not included. The text controls can synthesise an italic style where the browser supports it.

## Photo sources

The photographs below are listed as CC0 on their Wikimedia Commons file descriptions. Commons identifies Unsplash-origin files as published before its 5 June 2017 licence change. The coffee photograph also has a recorded Commons Flickr licence review. The acquisition record preserves the exact Commons revision, original image SHA-1, downloaded thumbnail SHA-256 and resulting bundled-file SHA-256. It records the file licence, rather than treating Commons’ separate metadata licence as a licence for the image.

Bundled images are RGB WebP files with a longest edge of at most 1,280 pixels, encoded at quality 82. They retain their full composition; EXIF orientation is applied and EXIF data is removed. These files are useful for screen designs. Use a higher-resolution image of your own when you need a large print.

| Photo | Photographer | File licence and source |
| --- | --- | --- |
| Mountain lake | Tony Reid togna_bologna | [CC0](https://commons.wikimedia.org/wiki/File:Clear_lake_in_the_mountains_(Unsplash).jpg) |
| Woodland light | Mr. Marco mrmarcojorger | [CC0](https://commons.wikimedia.org/wiki/File:Wald_(Unsplash).jpg) |
| Flower bouquet | Alexandra Gorn alexagorn | [CC0](https://commons.wikimedia.org/wiki/File:Flowers_1_(Unsplash).jpg) |
| Morning coffee | www.Pixel.la Free Stock Photos | [CC0](https://commons.wikimedia.org/wiki/File:Coffee_cup_seen_from_above.jpg) |
| Patterned leaves | Annie Spratt anniespratt | [CC0](https://commons.wikimedia.org/wiki/File:Leaves_(Unsplash).jpg) |
| Red leaves | Grant McCurdy gmccurdy | [CC0](https://commons.wikimedia.org/wiki/File:Minimal_red_leaves_on_white_(Unsplash).jpg) |
| Headphones | Corey Blaz blazphoto | [CC0](https://commons.wikimedia.org/wiki/File:Headphones_on_wood_in_black_and_white_(Unsplash).jpg) |
| Above the clouds | Anton Gudkov apgudkov | [CC0](https://commons.wikimedia.org/wiki/File:Sun_above_clouds_(Unsplash).jpg) |
| Night sky | Teddy Kelley | [CC0](https://commons.wikimedia.org/wiki/File:Galaxy_unsplash_2.jpg) |
| Stormy sea | JOHN TOWNER heytowner | [CC0](https://commons.wikimedia.org/wiki/File:Storms_At_Sea_(Unsplash).jpg) |
| Frothy coffee | Bryan Burgos bryannuke | [CC0](https://commons.wikimedia.org/wiki/File:Frothy_coffee_(Unsplash).jpg) |
| Spring flowers | Rodion Kutsaev frostroomhead | [CC0](https://commons.wikimedia.org/wiki/File:Colorful_flowers_in_bloom_(Unsplash).jpg) |

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) permits copying and changing these images, including commercial use. Photo copyright permission does not grant trademark rights or imply endorsement by the photographer. Stencil keeps the source links and names available in the photo browser. Full source records live in `public/assets/media-provenance.json`.

## Module integration

`src/font-catalogue.js` exports `FONT_FAMILIES` and `BUNDLED_FONTS`. `fontStyleText(document)` returns same-origin CSS; omitting the document returns all bundled families. `await loadDocumentFonts(document)` loads the used faces through `FontFace`. `await documentFontCSS(document)` returns self-contained CSS for SVG exports. It accepts an optional abort signal.

`initMediaLibrary(container, { onInsert })` opens the photo browser and returns `open()` and `destroy()`. `onInsert` receives the embedded `src`, dimensions, name, `kind`, `licence`, `license`, author and source, plus the pinned catalogue fields. The editor decides where to place the image. `fetchMediaCatalogue`, `validateMediaCatalogue`, `searchMedia` and `fetchMediaAsset` can also be used independently.

The module validates local paths, refuses redirects and external fetch addresses, caps catalogue and image bytes, checks WebP dimensions and verifies SHA-256 before insertion. The source link is opened only when the consumer chooses it.

## Updating the set

1. Confirm the actual image/font licence on the upstream file page and preserve the relevant licence notice.
2. Download a pinned file; record the source revision, download hash and any conversion.
3. Keep font bytes below 1 MiB and photo bytes below 2 MiB in total. The present photo schema also caps each image at 256 KiB and 1,280 pixels on either edge.
4. Update the catalogue/provenance and run `node --test tests/consumer/media-library.test.js`.
5. Check insertion, font rendering and a downloaded design in a real browser before release.

Reusable uploads preserve supplied licence facts. A missing creator, source or licence link stays unknown; inserting an upload never assigns it a CC0 licence. Partial supplied facts remain in design JSON, SVG metadata and downloaded asset credits. Video credits include them too.
