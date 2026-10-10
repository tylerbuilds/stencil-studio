/** Saved slideshow settings. Audio stays embedded; no external URLs are accepted. */
export const MAX_SAVED_AUDIO_BYTES = 4 * 1024 * 1024;
export const defaultVideoSettings = () => ({ transition: 'cut', audio: null });
const fail = message => { throw new Error(message); };
function record(value, allowed, name) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be a plain object.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !allowed.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')) || allowed.some(key => !Object.hasOwn(value, key))) fail(`${name} contains unsupported or missing fields.`);
}
export function validateVideoSettings(value) {
  record(value, ['transition', 'audio'], 'Video settings');
  if (!['cut', 'fade'].includes(value.transition)) fail('Choose a cut or fade transition.');
  if (value.audio !== null) {
    record(value.audio, ['name', 'src'], 'Saved audio');
    if (typeof value.audio.name !== 'string' || !value.audio.name.trim() || value.audio.name.length > 150 || /[\u0000-\u001f]/.test(value.audio.name)) fail('Give the audio a valid name up to 150 characters.');
    const src = value.audio.src;
    if (typeof src !== 'string' || src.length > Math.ceil(MAX_SAVED_AUDIO_BYTES / 3) * 4 + 80) fail('Use an audio file up to 4 MB.');
    const prefix = /^data:audio\/(?:mpeg|mp3|wav|x-wav|ogg|mp4|webm);base64,/.exec(src);
    const encoded = prefix ? src.slice(prefix[0].length) : '';
    if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail('Use embedded MP3, WAV, Ogg, M4A or WebM audio.');
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    if (bytes.length > MAX_SAVED_AUDIO_BYTES) fail('Use an audio file up to 4 MB.');
    const starts = signature => signature.every((byte, index) => bytes[index] === byte);
    const mime = prefix[0].slice(5, -8);
    const valid = mime === 'audio/mpeg' || mime === 'audio/mp3' ? starts([73,68,51]) || bytes.length > 2 && bytes[0] === 255 && (bytes[1] & 224) === 224
      : mime === 'audio/wav' || mime === 'audio/x-wav' ? starts([82,73,70,70]) && bytes.length >= 12 && [87,65,86,69].every((byte,index) => bytes[index + 8] === byte)
      : mime === 'audio/ogg' ? starts([79,103,103,83])
      : mime === 'audio/mp4' ? bytes.length >= 12 && [102,116,121,112].every((byte,index) => bytes[index + 4] === byte)
      : starts([26,69,223,163]);
    if (!valid) fail('This audio file does not match its format. Choose another file.');
  }
  return value;
}
export function savedAudioBlob(audio) {
  if (audio === null) return null;
  validateVideoSettings({ transition: 'cut', audio });
  const comma = audio.src.indexOf(','), type = audio.src.slice(5, audio.src.indexOf(';'));
  return new Blob([Uint8Array.from(atob(audio.src.slice(comma + 1)), character => character.charCodeAt(0))], { type });
}
