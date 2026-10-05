import type { AgentEvent } from '@industrial-agent-harness/viewer-builtin/api';

export function latestEvent<Type extends AgentEvent['type']>(
  events: AgentEvent[],
  type: Type,
): Extract<AgentEvent, { type: Type }> | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type === type) return event as Extract<AgentEvent, { type: Type }>;
  }
}

export function appendDisplayEvents(current: AgentEvent[], events: AgentEvent[]): AgentEvent[] {
  if (!events.length) return current;
  const updated = [...current];
  let contentIndex = updated.length - 1;
  while (
    contentIndex >= 0 &&
    (updated[contentIndex].type === 'status' || updated[contentIndex].type === 'step')
  )
    contentIndex--;
  for (const event of events) {
    if (event.type === 'subagent-state') {
      let index = updated.length - 1;
      while (
        index >= 0 &&
        !(
          updated[index].type === 'subagent-state' &&
          (updated[index] as Extract<AgentEvent, { type: 'subagent-state' }>).id === event.id
        )
      )
        index--;
      if (index >= 0) {
        updated[index] = event;
        continue;
      }
    }
    const previous = updated[contentIndex];
    if (
      event.type === 'subagent-event' &&
      previous?.type === 'subagent-event' &&
      event.id === previous.id &&
      (event.event.type === 'text' || event.event.type === 'thinking') &&
      previous.event.type === event.event.type &&
      previous.event.segment === event.event.segment
    ) {
      updated[contentIndex] = {
        ...previous,
        event: { ...event.event, text: previous.event.text + event.event.text },
      };
      continue;
    }
    if (
      (previous?.type === 'text' && event.type === 'text') ||
      (previous?.type === 'thinking' && event.type === 'thinking')
    ) {
      updated[contentIndex] = { ...previous, text: previous.text + event.text };
    } else {
      updated.push(event);
      if (event.type !== 'status' && event.type !== 'step') contentIndex = updated.length - 1;
    }
  }
  return updated;
}
