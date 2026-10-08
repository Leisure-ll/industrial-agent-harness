function displayInputs(value, depth = 0) {
  if (depth > 12) return '[nested value omitted]';
  if (Array.isArray(value)) return value.map(item => displayInputs(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /password|secret|authorization|api.?key|credential|(^|_)token($|_)/i.test(key)
          ? '[REDACTED]'
          : displayInputs(item, depth + 1),
      ]),
    );
  return value;
}
function boundedPreview(text, maximum = 32768) {
  const bytes = Buffer.from(text);
  return bytes.length <= maximum
    ? { text, truncated: false }
    : {
        text:
          bytes.subarray(0, maximum).toString('utf8') +
          '\n[Preview truncated; review the full request before approval.]',
        truncated: true,
      };
}
module.exports = { displayInputs, boundedPreview };
