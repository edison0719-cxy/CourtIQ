// Serve seekable MP4 ranges even when the static asset origin ignores Range.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.endsWith('.mp4')) return env.ASSETS.fetch(request);
    const headers = new Headers(request.headers);
    headers.delete('range'); headers.delete('if-range');
    const response = await env.ASSETS.fetch(new Request(request, {headers}));
    if (response.status !== 200) return response;
    const output = new Headers(response.headers);
    output.set('Accept-Ranges', 'bytes');
    const range = request.headers.get('range');
    const size = Number(response.headers.get('content-length'));
    const ifRange = request.headers.get('if-range');
    if (!range || !Number.isSafeInteger(size) || size <= 0 || (ifRange && ifRange !== response.headers.get('etag') && ifRange !== response.headers.get('last-modified'))) return new Response(response.body, {status:200, headers:output});
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    // Ignore unsupported/multipart ranges, as HTTP permits.
    if (!match || (!match[1] && !match[2])) return new Response(response.body, {headers:output});
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      await response.body.cancel();
      output.set('Content-Range', `bytes */${size}`); output.set('Content-Length','0');
      return new Response(null, {status:416, headers:output});
    }
    const reader = response.body.getReader();
    let offset = 0;
    const body = new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            const {done,value} = await reader.read();
            if (done) { controller.close(); return; }
            const previous = offset; offset += value.byteLength;
            if (offset <= start) continue;
            const slice = value.subarray(Math.max(0,start-previous), Math.min(value.byteLength,end+1-previous));
            if (slice.byteLength) controller.enqueue(slice);
            if (offset > end) { controller.close(); await reader.cancel(); }
            return;
          }
        } catch (error) { controller.error(error); }
      },
      cancel(reason) { return reader.cancel(reason); }
    });
    output.set('Content-Range', `bytes ${start}-${end}/${size}`);
    output.set('Content-Length', String(end-start+1));
    return new Response(body, {status:206, headers:output});
  }
};
