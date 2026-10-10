/** Original consumer layouts built from native layers. No model, DOM or network imports. */
export const SOCIAL_TEMPLATES = Object.freeze([
  { key: 'social-product', name: 'A fresh favourite', category: 'Product post · 1080 × 1080', tags: ['product', 'shop', 'launch', 'photo'], pageCount: 1, width: 1080, height: 1080 },
  { key: 'social-photo', name: 'Sunday, slowly', category: 'Photo post · 1080 × 1350', tags: ['photo', 'memory', 'weekend', 'portrait'], pageCount: 1, width: 1080, height: 1350 },
  { key: 'social-event-story', name: 'After hours', category: 'Event story · 1080 × 1920', tags: ['story', 'event', 'music', 'invitation'], pageCount: 1, width: 1080, height: 1920 },
  { key: 'social-carousel', name: 'A photo walk', category: '5-slide carousel · 1080 × 1350', tags: ['carousel', 'tips', 'photography', 'walk'], pageCount: 5, width: 1080, height: 1350 },
  { key: 'social-quote', name: 'Room for surprises', category: 'Quote post · 1080 × 1080', tags: ['quote', 'note', 'words', 'serif'], pageCount: 1, width: 1080, height: 1080 },
  { key: 'social-announcement', name: 'Open late', category: 'Announcement · 1080 × 1080', tags: ['announcement', 'shop', 'opening', 'photo'], pageCount: 1, width: 1080, height: 1080 },
  { key: 'social-pinterest', name: 'A slow morning', category: 'Tall pin · 1000 × 1500', tags: ['pin', 'pinterest', 'photo', 'lifestyle'], pageCount: 1, width: 1000, height: 1500 },
  { key: 'social-thumbnail', name: 'Make it yours', category: 'Video thumbnail · 1280 × 720', tags: ['thumbnail', 'youtube', 'video', 'craft'], pageCount: 1, width: 1280, height: 720 },
  { key: 'social-editorial', name: 'Look a little closer', category: 'Editorial post · 1080 × 1350', tags: ['editorial', 'portrait', 'photo', 'bold'], pageCount: 1, width: 1080, height: 1350 },
  { key: 'social-cover', name: 'Meet me outside', category: 'Wide cover · 1920 × 640', tags: ['cover', 'banner', 'gathering', 'landscape'], pageCount: 1, width: 1920, height: 640 }
].map(template => Object.freeze({ ...template, group: 'social', tags: Object.freeze(template.tags) })));

/** Factory injection keeps this module independent of the document model. */
export function buildSocialTemplate(key, factories) {
  const template = SOCIAL_TEMPLATES.find(item => item.key === key);
  if (!template) return null;
  const { createDocument, createPage, createElement } = factories ?? {};
  if (![createDocument, createPage, createElement].every(factory => typeof factory === 'function')) throw new TypeError('Social templates need document, page and element factories.');

  const document = createDocument();
  document.title = template.name;
  const text = (words, x, y, width, fontSize, fill, options = {}) => {
    const lineHeight = options.lineHeight ?? 1.16;
    return createElement('text', { text: words, x, y, width, height: fontSize * (words.split('\n').length * lineHeight + .3), fontSize, fontFamily: 'DM Sans', fontWeight: 400, fill, lineHeight, ...options });
  };
  const rect = (x, y, width, height, fill, options = {}) => createElement('rect', { x, y, width, height, fill, ...options });
  const circle = (x, y, width, height, fill, options = {}) => createElement('circle', { x, y, width, height, fill, ...options });
  const frame = (x, y, width, height, fill, options = {}) => createElement('frame', { x, y, width, height, fill, shape: 'rect', src: '', ...options });
  const mono = { fontFamily: 'IBM Plex Mono', letterSpacing: 1.5 };
  const display = { fontFamily: 'Bricolage Grotesque', fontWeight: 700 };
  const serif = { fontFamily: 'Fraunces', fontWeight: 400 };
  const page = (name, background, elements) => ({ ...createPage(template.width, template.height), name, background, elements });
  const finish = (colours, fontFamily, pages) => {
    document.brand = { colours: [...colours], fontFamily };
    document.pages = pages;
    return document;
  };

  if (key === 'social-product') return finish(['#fbf5eb', '#252b23', '#315447', '#ffaf92'], 'Bricolage Grotesque', [page('The new drop', '#fbf5eb', [
    text('THE NEW DROP', 64, 44, 940, 20, '#315447', mono),
    text('Your next\nfavourite.', 60, 94, 960, 92, '#252b23', { ...display, lineHeight: 1 }),
    frame(315, 335, 700, 660, '#d8dfce', { shape: 'rounded', cornerRadius: 28 }),
    text('Made for\neveryday\nmoments.', 64, 390, 205, 32, '#315447', { lineHeight: 1.35 }),
    circle(54, 695, 230, 230, '#ffaf92'),
    text('YOUR\nPRICE', 80, 758, 178, 32, '#252b23', { ...mono, align: 'center', lineHeight: 1.25 }),
    text('YOUR SHOP', 64, 986, 220, 19, '#315447', mono)
  ])]);

  if (key === 'social-photo') return finish(['#f4f1e9', '#203f43', '#186d77', '#d8e4d4'], 'Fraunces', [page('A few good hours', '#f4f1e9', [
    text('Sunday, slowly.', 70, 49, 940, 72, '#203f43', serif),
    frame(70, 170, 940, 920, '#d8e4d4'),
    text('A few good hours, saved here.', 70, 1136, 940, 34, '#203f43'),
    text('YOUR PLACE / YOUR DATE', 70, 1239, 875, 22, '#186d77', mono),
    circle(984, 1238, 24, 24, '#186d77')
  ])]);

  if (key === 'social-event-story') return finish(['#22243c', '#ff836b', '#ecf798', '#fff6e8'], 'Space Grotesk', [page('After hours', '#22243c', [
    text('AN EVENING TO REMEMBER', 80, 91, 920, 24, '#ecf798', mono),
    text('AFTER\nHOURS.', 75, 188, 930, 132, '#fff6e8', { fontFamily: 'Space Grotesk', fontWeight: 700, lineHeight: .95 }),
    text('YOUR DATE / DOORS AT 7PM', 80, 506, 920, 32, '#ecf798', { fontFamily: 'Space Grotesk' }),
    frame(100, 650, 880, 690, '#d4dac4', { shape: 'arch' }),
    rect(0, 1390, 1080, 530, '#ff836b'),
    text('Good music.\nBetter company.', 80, 1494, 920, 68, '#22243c', { ...display, lineHeight: 1.13 }),
    text('YOUR VENUE / YOUR CITY', 80, 1770, 920, 24, '#22243c', mono),
    text('Tickets & details: your link', 80, 1840, 920, 27, '#22243c')
  ])]);

  if (key === 'social-carousel') {
    const counter = (number, fill = '#273632') => text(`${number} / 5`, 64, 1270, 952, 22, fill, { ...mono, align: 'right' });
    return finish(['#f6f3eb', '#273632', '#e5b7bc', '#d0dfc8'], 'Bricolage Grotesque', [
      page('Cover', '#f6f3eb', [
        text('A PHOTO WALK', 64, 66, 952, 22, '#273632', mono),
        text('Three ways to\nfind a good photo.', 60, 155, 960, 76, '#273632', { ...display, lineHeight: 1.08 }),
        frame(170, 405, 740, 720, '#d0dfc8', { shape: 'arch' }),
        text('Try them on your next walk.', 64, 1180, 952, 30, '#273632'), counter(1)
      ]),
      page('Colour', '#d0dfc8', [
        text('01 / LOOK FOR COLOUR', 64, 66, 952, 22, '#273632', mono),
        text('Pick one colour.\nSee where it takes you.', 60, 155, 960, 68, '#273632', { ...display, lineHeight: 1.1 }),
        frame(64, 415, 450, 650, '#f6f3eb'), frame(566, 505, 450, 600, '#e5b7bc'),
        rect(566, 415, 450, 32, '#273632'),
        text('A red door. A green chair. A little surprise.', 64, 1160, 952, 29, '#273632'), counter(2)
      ]),
      page('Details', '#f6f3eb', [
        text('02 / MOVE CLOSER', 64, 66, 952, 22, '#273632', mono),
        text('A small detail\ncan fill the frame.', 64, 155, 952, 76, '#273632', { ...serif, lineHeight: 1.08 }),
        frame(220, 410, 640, 640, '#e5b7bc', { shape: 'circle' }),
        createElement('shape', { kind: 'arrow', x: 92, y: 825, width: 120, height: 70, rotation: -20, fill: '#273632' }),
        text('Move closer. Let the edges disappear.', 64, 1140, 952, 31, '#273632'), counter(3)
      ]),
      page('Light', '#273632', [
        text('03 / FOLLOW THE LIGHT', 64, 66, 952, 22, '#f6f3eb', mono),
        frame(64, 145, 952, 695, '#d0dfc8'),
        text('Wait for\na little light.', 64, 886, 952, 84, '#f6f3eb', { ...serif, lineHeight: 1.08 }),
        text('Try a window, a shadow or the last sun of the day.', 64, 1146, 952, 29, '#f6f3eb'), counter(4, '#f6f3eb')
      ]),
      page('Your turn', '#e5b7bc', [
        text('YOUR TURN', 64, 66, 952, 22, '#273632', mono),
        text('A short walk.\nOne good photo.', 60, 180, 960, 94, '#273632', { ...display, lineHeight: 1.06 }),
        circle(550, 600, 430, 430, '#f6f3eb'), frame(575, 625, 380, 380, '#d0dfc8', { shape: 'circle' }),
        text('Take your time.\nNotice something.\nMake it yours.', 64, 658, 425, 43, '#273632', { lineHeight: 1.32 }),
        text('Your place / your point of view', 64, 1145, 952, 30, '#273632'), counter(5)
      ])
    ]);
  }

  if (key === 'social-quote') return finish(['#fff6e9', '#633a43', '#f3bc85', '#e6ddcc'], 'Libre Baskerville', [page('A small reminder', '#fff6e9', [
    text('A SMALL REMINDER', 86, 78, 908, 21, '#633a43', mono),
    createElement('shape', { kind: 'star', x: 864, y: 130, width: 130, height: 130, rotation: 12, fill: '#f3bc85' }),
    text('Leave room\nfor the good\nsurprises.', 80, 313, 920, 83, '#633a43', { fontFamily: 'Libre Baskerville', lineHeight: 1.24 }),
    rect(86, 823, 150, 3, '#633a43'),
    text('Your words / your name', 86, 898, 908, 30, '#633a43', { fontFamily: 'Georgia' })
  ])]);

  if (key === 'social-announcement') return finish(['#3450ef', '#ffffff', '#e7ee93', '#192442'], 'Space Grotesk', [page('Open late', '#3450ef', [
    text('YOUR NEIGHBOURHOOD SPOT', 64, 64, 536, 20, '#ffffff', mono),
    frame(650, 70, 360, 500, '#d0dfc8', { shape: 'rounded', cornerRadius: 24, borderColour: '#ffffff', borderWidth: 4 }),
    text('OPEN\nLATE.', 59, 238, 535, 128, '#ffffff', { fontFamily: 'Space Grotesk', fontWeight: 700, lineHeight: .98 }),
    text('Friday & Saturday\nUntil 9pm', 64, 630, 690, 39, '#e7ee93', { fontFamily: 'Space Grotesk', lineHeight: 1.25 }),
    createElement('shape', { kind: 'arrow', x: 845, y: 707, width: 150, height: 80, fill: '#e7ee93' }),
    rect(0, 875, 1080, 205, '#ffffff'),
    text('Your place. Your people.', 64, 925, 952, 43, '#192442', { fontFamily: 'Space Grotesk', fontWeight: 700 }),
    text('YOUR ADDRESS', 64, 1014, 952, 21, '#192442', mono)
  ])]);

  if (key === 'social-pinterest') return finish(['#f1d7c6', '#503e34', '#fff7ec', '#c8d6c2'], 'Fraunces', [page('A slow morning', '#f1d7c6', [
    frame(50, 50, 900, 865, '#c8d6c2', { shape: 'arch' }),
    text('LITTLE THINGS / GOOD DAYS', 60, 960, 880, 21, '#503e34', mono),
    text('Make a\nslow morning.', 55, 1032, 890, 84, '#503e34', { ...serif, lineHeight: 1.13 }),
    rect(60, 1328, 880, 2, '#503e34'),
    text('A few ideas for your next day off.', 60, 1387, 880, 28, '#503e34')
  ])]);

  if (key === 'social-thumbnail') return finish(['#f5edbd', '#24423a', '#ed8351', '#d0ddd0'], 'Bricolage Grotesque', [page('Make it yours', '#f5edbd', [
    text('A SECOND LIFE', 55, 61, 460, 22, '#24423a', mono),
    frame(590, 55, 635, 610, '#d0ddd0', { shape: 'rounded', cornerRadius: 20 }),
    text('MAKE IT\nYOURS.', 50, 187, 485, 97, '#24423a', { ...display, lineHeight: 1.02 }),
    createElement('shape', { kind: 'arrow', x: 439, y: 451, width: 120, height: 77, fill: '#ed8351' }),
    text('A simple upcycling idea', 55, 623, 485, 27, '#24423a')
  ])]);

  if (key === 'social-editorial') return finish(['#2b2930', '#f6eedf', '#c77b58', '#d6c9a8'], 'Space Grotesk', [page('Look a little closer', '#2b2930', [
    text('FIELD NOTES / 01', 64, 66, 952, 22, '#d6c9a8', mono),
    text('LOOK\nA LITTLE\nCLOSER.', 60, 166, 960, 112, '#f6eedf', { fontFamily: 'Space Grotesk', fontWeight: 700, lineHeight: .95 }),
    frame(64, 600, 620, 620, '#d6c9a8'),
    circle(790, 629, 200, 200, '#c77b58'),
    text('Good things\nhide in plain\nsight.', 745, 945, 275, 34, '#f6eedf', { lineHeight: 1.35 }),
    text('YOUR PLACE / YOUR PERSPECTIVE', 64, 1271, 952, 20, '#d6c9a8', mono)
  ])]);

  return finish(['#dce6d0', '#234637', '#eeb79e', '#fbf5e8'], 'Fraunces', [page('Meet me outside', '#dce6d0', [
    text('SMALL PLANS / GOOD COMPANY', 80, 64, 1060, 24, '#234637', mono),
    text('Meet me\noutside.', 72, 136, 1120, 130, '#234637', { ...serif, lineHeight: 1.02 }),
    rect(1210, 72, 4, 492, '#234637'),
    circle(1275, 58, 520, 520, '#eeb79e'), frame(1300, 83, 470, 470, '#d4dac4', { shape: 'circle' }),
    text('Your next gathering starts here.', 80, 541, 1060, 31, '#234637')
  ])]);
}
