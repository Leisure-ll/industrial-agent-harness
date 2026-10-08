// Bound connection and idle time independently of total transfer time. A large
// native toolchain can take minutes while still making steady progress.
class Transfer {
  constructor({ signal, stallMs = 60000, timeoutMs = 20 * 60 * 1000 } = {}) {
    this.controller = new AbortController();
    this.signal = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
    this.stallMs = stallMs;
    this.total = setTimeout(
      () => this.controller.abort(Error('Download timed out. Please retry.')),
      timeoutMs,
    );
    this.total.unref?.();
    this.touch();
  }
  touch() {
    clearTimeout(this.idle);
    this.idle = setTimeout(
      () => this.controller.abort(Error('Download stalled. Please retry.')),
      this.stallMs,
    );
    this.idle.unref?.();
  }
  async response(url) {
    for (let redirects = 0; redirects <= 5; redirects++) {
      this.signal.throwIfAborted();
      if (new URL(url).protocol !== 'https:') throw Error('Downloads require HTTPS.');
      const response = await fetch(url, { redirect: 'manual', signal: this.signal });
      this.touch();
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw Error(`Download failed: HTTP ${response.status}`);
        }
        return response;
      }
      await response.body?.cancel();
      if (redirects === 5 || !response.headers.get('location'))
        throw Error('Download has too many redirects.');
      url = new URL(response.headers.get('location'), url).toString();
    }
  }
  async run(action) {
    try {
      return await action(this);
    } catch (error) {
      if (this.signal.aborted) throw this.signal.reason;
      throw error;
    } finally {
      clearTimeout(this.idle);
      clearTimeout(this.total);
    }
  }
}
module.exports = { Transfer };
