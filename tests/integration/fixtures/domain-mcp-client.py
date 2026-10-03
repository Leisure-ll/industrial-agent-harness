import asyncio
import hashlib
import json
from pathlib import Path
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def data(result):
    assert not result.isError, result
    return result.structuredContent or json.loads(next(item.text for item in result.content if item.type == 'text'))


async def main():
    config = json.loads(Path(sys.argv[1]).read_text())['mcpServers']['chip-pack.eda']
    async with stdio_client(StdioServerParameters(**config)) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            names = {tool.name for tool in (await session.list_tools()).tools}
            assert names == {'domain_tool_list', 'domain_tool_describe', 'domain_tool_call', 'domain_tool_result_read'}, names
            available = data(await session.call_tool('domain_tool_list', {}))
            ids = {tool['toolId'] for tool in available['tools']}
            assert 'eda.harness.get_operational_context' in ids
            assert 'eda.harness.run_action' not in ids
            for name, arguments in [
                ('domain_tool_describe', {'toolId': 'eda.harness.run_action'}),
                ('domain_tool_call', {'toolId': 'eda.harness.run_action', 'arguments': {'action': 'rtl.lint'}}),
                ('domain_tool_call', {'toolId': 'eda.harness.inspect_project', 'arguments': {'project_path': str(Path(available['projectDir']).parent)}}),
                ('domain_tool_call', {'toolId': 'eda.harness.get_run', 'arguments': {'run_id': 'x', 'approval': True}}),
                ('domain_tool_call', {'toolId': 'eda.harness.get_tool_guide', 'arguments': {'tool': 'run_action'}}),
                ('domain_tool_result_read', {'responseId': '../escape', 'offset': 0}),
            ]:
                result = await session.call_tool(name, arguments)
                assert result.isError, (name, result)
            context = data(await session.call_tool('domain_tool_call', {'toolId': 'eda.harness.get_operational_context', 'arguments': {}}))
            assert context['projectDir'] == available['projectDir']
            info = data(await session.call_tool('domain_tool_call', {'toolId': 'eda.harness.get_server_info', 'arguments': {}}))
            assert info['result']['package']['version'] == '0.6.1'
            descriptor = data(await session.call_tool('domain_tool_describe', {'toolId': 'eda.harness.get_run'}))
            assert 'project_path' not in descriptor['inputSchema']['properties']
            guide = data(await session.call_tool('domain_tool_call', {'toolId': 'eda.harness.get_tool_guide', 'arguments': {'tool': 'get_operational_context'}}))
            if guide.get('paged'):
                response = data(await session.call_tool('domain_tool_result_read', {'responseId': guide['responseId'], 'offset': 0, 'limit': 8000}))
                assert response['text'] and len(json.dumps(response, ensure_ascii=False).encode()) <= 16 * 1024
            large = data(await session.call_tool('domain_tool_call', {'toolId': 'eda.harness.tool_capabilities', 'arguments': {}}))
            assert large.get('paged'), large
            raw, offset = '', 0
            while offset is not None:
                page = data(await session.call_tool('domain_tool_result_read', {'responseId': large['responseId'], 'offset': offset, 'limit': 8000}))
                assert len(json.dumps(page, ensure_ascii=False).encode()) <= 16 * 1024
                raw += page['text']
                offset = page['nextOffset']
            assert hashlib.sha256(raw.encode()).hexdigest() == large['sha256']
            assert json.loads(raw)['toolId'] == 'eda.harness.tool_capabilities'
            print(json.dumps({'ok': True, 'tools': len(ids), 'surface': len(names), 'projectDir': available['projectDir'], 'context': True, 'rejections': 6}))


asyncio.run(main())
