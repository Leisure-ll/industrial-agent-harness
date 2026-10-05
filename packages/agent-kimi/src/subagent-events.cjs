const MAX_TEXT = 128 * 1024;
const MAX_EVENTS = 2048;
const states = {
  running_foreground: 'running',
  running_background: 'running',
  awaiting_approval: 'awaiting_approval',
  completed: 'completed',
  failed: 'failed',
  killed: 'cancelled',
  lost: 'lost',
};
const active = new Set(['running', 'awaiting_approval']);
const outputText = output =>
  typeof output === 'string'
    ? output
    : Array.isArray(output)
      ? output
          .filter(v => v.type === 'text')
          .map(v => v.text)
          .join('\n')
      : '';

class SubagentEvents {
  constructor({ emit, sessionId, parentArguments, originTurnId, resolveOrigin }) {
    this.emit = emit;
    this.sessionId = sessionId;
    this.parentArguments = parentArguments;
    this.originTurnId = originTurnId;
    this.resolveOrigin = resolveOrigin;
    this.calls = new Map();
    this.agents = new Map();
  }
  record(
    parentToolCallId,
    agentId,
    subagentType,
    background = false,
    description = '',
    originTurnId = this.originTurnId,
  ) {
    const key = `${originTurnId}:${parentToolCallId}:${agentId}`;
    let record = this.calls.get(key);
    if (!record) {
      if (this.calls.size >= 256) {
        const oldest = [...this.calls.entries()].find(([, r]) => !active.has(r.status));
        if (!oldest) return null;
        this.calls.delete(oldest[0]);
        if (this.agents.get(oldest[1].agentId) === oldest[1]) this.agents.delete(oldest[1].agentId);
      }
      let args = {};
      try {
        args = JSON.parse(this.parentArguments?.(parentToolCallId) || '{}');
      } catch {}
      record = {
        id: `${this.sessionId}:${key}`,
        originTurnId,
        agentId,
        parentToolCallId,
        subagentType: subagentType || args.subagent_type || 'coder',
        description: (description || args.description || '子任务').slice(0, 200),
        background: background || args.run_in_background === true,
        status: 'running',
        tools: new Map(),
        lastTool: null,
        bytes: 0,
        events: 0,
      };
      this.calls.set(key, record);
    }
    if (agentId) {
      record.agentId = agentId;
      this.agents.set(agentId, record);
    }
    return record;
  }
  state(record, update = {}) {
    if (!record) return;
    Object.assign(record, update);
    const view = {
      type: 'subagent-state',
      id: record.id,
      agentId: record.agentId,
      parentToolCallId: record.parentToolCallId,
      subagentType: record.subagentType,
      description: record.description,
      background: record.background,
      ...(record.originTurnId ? { turnId: record.originTurnId } : {}),
      status: record.status,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      ...(record.summary ? { summary: record.summary.slice(0, 12000) } : {}),
      ...(record.truncated ? { truncated: true } : {}),
    };
    const key = JSON.stringify(view);
    if (key !== record.lastState) {
      record.lastState = key;
      this.emit(view);
    }
  }
  wire(payload) {
    if (!payload.parent_tool_call_id || !payload.agent_id) return;
    const existing = this.agents.get(payload.agent_id);
    const record =
      existing?.background && existing.parentToolCallId === payload.parent_tool_call_id
        ? existing
        : this.record(payload.parent_tool_call_id, payload.agent_id, payload.subagent_type);
    if (!record) return;
    this.state(record);
    const event = payload.event,
      p = event?.payload;
    if (!p) return;
    if (event.type === 'TurnBegin' || event.type === 'StepBegin') {
      record.segment = (record.segment || 0) + 1;
    } else if (event.type === 'ContentPart' && ['text', 'think'].includes(p.type)) {
      this.child(record, {
        type: p.type === 'text' ? 'text' : 'thinking',
        text: p.type === 'text' ? p.text : p.think,
        segment: record.segment || 0,
      });
    } else if (event.type === 'ToolCall') {
      record.lastTool = p.id;
      record.tools.set(p.id, { name: p.function.name, arguments: p.function.arguments || '' });
      this.child(record, {
        type: 'tool',
        id: p.id,
        name: p.function.name,
        arguments: p.function.arguments || '',
      });
    } else if (event.type === 'ToolCallPart' && record.lastTool) {
      const tool = record.tools.get(record.lastTool);
      if (tool) tool.arguments = (tool.arguments + (p.arguments_part || '')).slice(0, 64000);
    } else if (event.type === 'ToolResult') {
      const tool = record.tools.get(p.tool_call_id);
      if (tool) this.child(record, { type: 'tool', id: p.tool_call_id, ...tool });
      record.tools.delete(p.tool_call_id);
      if (record.lastTool === p.tool_call_id) record.lastTool = null;
      const value = p.return_value;
      const output = outputText(value.output);
      this.child(record, {
        type: 'tool-result',
        id: p.tool_call_id,
        error: value.is_error,
        message: value.message,
        output: output.slice(0, 12000),
        outputTruncated: output.length > 12000,
      });
    } else if (event.type === 'CompactionBegin' || event.type === 'CompactionEnd')
      this.child(record, {
        type: 'compaction',
        state: event.type === 'CompactionBegin' ? 'begin' : 'end',
      });
  }
  child(record, event) {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (record.bytes + bytes > MAX_TEXT || record.events >= MAX_EVENTS) {
      this.state(record, { truncated: true });
      return;
    }
    record.bytes += bytes;
    record.events++;
    this.emit({
      type: 'subagent-event',
      id: record.id,
      agentId: record.agentId,
      parentToolCallId: record.parentToolCallId,
      event,
      ...(record.originTurnId ? { turnId: record.originTurnId } : {}),
    });
  }
  finish(parentToolCallId, value) {
    const output = outputText(value.output);
    const agentId = output.match(/^agent_id: (\S+)/m)?.[1];
    const record =
      [...this.calls.values()].find(
        r => r.parentToolCallId === parentToolCallId && r.originTurnId === this.originTurnId,
      ) ||
      (agentId
        ? this.record(
            parentToolCallId,
            agentId,
            output.match(/^actual_subagent_type: (\S+)/m)?.[1],
            /^task_id:/m.test(output),
          )
        : null);
    if (!record) return;
    if (/^task_id:/m.test(output)) {
      this.state(record, {
        background: true,
        taskId: output.match(/^task_id: (\S+)/m)?.[1],
        status: 'running',
      });
      return;
    }
    this.state(record, {
      status: value.is_error ? 'failed' : 'completed',
      summary: output.split('[summary]\n')[1] || (value.is_error ? output || value.message : ''),
    });
  }
  task(spec, runtime, summary) {
    if (spec.kind !== 'agent' || !spec.kind_payload?.agent_id || !spec.tool_call_id) return null;
    const existing = [...this.calls.values()].find(r => r.taskId === spec.id);
    const record =
      existing ||
      this.record(
        spec.tool_call_id,
        spec.kind_payload.agent_id,
        spec.kind_payload.subagent_type,
        true,
        spec.description,
        this.resolveOrigin?.(spec.tool_call_id, spec.created_at) || this.originTurnId,
      );
    this.state(record, {
      taskId: spec.id,
      background: true,
      status: states[runtime.status] || 'running',
      ...(summary ? { summary } : {}),
    });
    return record;
  }
  approval(payload) {
    const record = this.agents.get(payload.agent_id);
    if (record) this.state(record, { status: 'awaiting_approval' });
    return record?.parentToolCallId;
  }
  approvalResolved(agentId) {
    const record = this.agents.get(agentId);
    if (record && record.status === 'awaiting_approval') this.state(record, { status: 'running' });
  }
  cancelForeground() {
    for (const r of this.calls.values())
      if (!r.background && active.has(r.status)) this.state(r, { status: 'cancelled' });
  }
  disconnected() {
    for (const r of this.calls.values())
      if (active.has(r.status)) this.state(r, { status: 'lost' });
  }
  backgroundBusy() {
    return [...this.calls.values()].some(r => r.background && active.has(r.status));
  }
}
module.exports = { SubagentEvents };
