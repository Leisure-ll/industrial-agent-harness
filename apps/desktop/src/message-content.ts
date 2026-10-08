// Some compatible providers put leading reasoning tags in text rather than
// native think events. This changes display only; persisted messages stay intact.
export function splitLeadingThinking(text: string) {
  const thoughts: Array<{ text: string; incomplete: boolean }> = [];
  let body = text;
  while (body.trimStart().startsWith('<think>')) {
    const start = body.indexOf('<think>') + 7;
    const end = body.indexOf('</think>', start);
    thoughts.push({
      text: body.slice(start, end < 0 ? undefined : end).trim(),
      incomplete: end < 0,
    });
    body = end < 0 ? '' : body.slice(end + 8).trimStart();
  }
  return { thoughts, body };
}
