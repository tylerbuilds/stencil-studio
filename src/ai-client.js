const MAX_RESPONSE_BYTES = 128_000;
const RESPONSE_ERROR = 'The AI service didn’t respond. Check your server connection and try again. Your design text hasn’t changed.';
const TEXT_ERROR = 'The AI service didn’t return text we could use. Try again. Your design text hasn’t changed.';
function cancelReader(reader, reason) { try { void Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch { /* Cleanup cannot replace or delay the original failure. */ } }
async function readResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(RESPONSE_ERROR);
  const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { throw new Error('The AI service response is too large. Your design text hasn’t changed.'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch { throw new Error(RESPONSE_ERROR); }
  } catch (error) {
    cancelReader(reader, error);
    throw error;
  } finally { try { reader.releaseLock(); } catch { /* Preserve the original failure. */ } }
}
export async function getAiStatus() {
  if (globalThis.location?.hostname?.endsWith('.github.io')) return {enabled:false};
  try {
    const response=await fetch('./api/ai/status',{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});
    if(!response.ok) return {enabled:false};
    const status=await readResponse(response);
    if (!status || Array.isArray(status) || typeof status !== 'object') return {enabled:false};
    return {enabled:status.enabled===true,...(typeof status.model==='string' && status.model.length<=300 ? {model:status.model} : {})};
  } catch { return {enabled:false}; }
}
export async function generateWriting(request, {signal}={}) {
  const response=await fetch('./api/ai',{
    method:'POST',cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json','X-Local-Workspace':'1'},body:JSON.stringify(request),signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(100000)]) : AbortSignal.timeout(100000)
  });
  let result;
  try { result=await readResponse(response); }
  catch (error) { if (error.name === 'AbortError' || error.message?.includes('too large')) throw error; throw new Error(RESPONSE_ERROR); }
  if(!result || Array.isArray(result) || typeof result!=='object' || !response.ok || typeof result.text!=='string' || !result.text.trim() || result.text.length>24_000) throw new Error(typeof result?.error === 'string' && result.error.length<=500 ? result.error : TEXT_ERROR);
  return {text:result.text,...(typeof result.model==='string' && result.model.length<=300 ? {model:result.model} : {})};
}
