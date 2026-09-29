"""Project-bound, scoped stdio gateway using the locked official Python MCP SDK.

No industrial executable runs here. Calls delegate to the declared provider's Runtime.
The MCP client (Kimi) owns approvals; model arguments cannot grant or expand scope.
"""
import asyncio
import hashlib
import importlib.metadata
import json
import os
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
import sys
import uuid

import pydantic_core
from jsonschema import Draft202012Validator
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.fastmcp.exceptions import ToolError

MAX_OUTPUT = 16 * 1024
MAX_CACHE = 4 * 1024 * 1024
MAX_ARGUMENTS = 64 * 1024
CALL_TIMEOUT = 45


def decode_result(result):
    if result.isError:
        raise ToolError("Provider error: " + " ".join(item.text for item in result.content if item.type == "text"))
    if result.structuredContent is not None:
        return result.structuredContent
    texts = [item.text for item in result.content if item.type == "text"]
    return json.loads(texts[0]) if len(texts) == 1 else [json.loads(text) for text in texts]


def create_gateway(policy):
    if policy.get("schemaVersion") != 1 or not policy.get("allowedToolIds"):
        raise ValueError("Invalid gateway policy")
    descriptors = {tool["id"]: tool for tool in policy["tools"]}
    if len(descriptors) != len(policy["tools"]) or not set(policy["allowedToolIds"]) <= descriptors.keys():
        raise ValueError("Invalid gateway Tool Scope")
    allowed = {key: descriptors[key] for key in policy["allowedToolIds"]}
    project = Path(policy["projectDir"]).resolve(strict=True)
    cache = Path(policy["cacheDir"])
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    cache.chmod(0o700)
    # Results are scoped to one live gateway, even when the Kimi share directory persists.
    for stale in cache.glob("*.json"):
        stale.unlink()
    cached = {}
    cache_bytes = 0

    def require_tool(tool_id):
        if tool_id not in allowed:
            raise ToolError("Tool is outside the current Broker scope. Resolve a new task scope.")
        return allowed[tool_id]

    def check_project():
        if Path(policy["projectDir"]).resolve(strict=True) != project or not project.is_dir():
            raise ToolError("Bound project directory changed; reconnect the gateway.")

    def bounded(value):
        nonlocal cache_bytes
        raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        size = len(raw.encode("utf-8"))
        if len(pydantic_core.to_json(value, fallback=str, indent=2)) <= MAX_OUTPUT:
            return value
        # Preserve completed mutation outcomes in full. Never truncate them into apparent success.
        if size > MAX_CACHE:
            raise ToolError("Provider response exceeds the 4 MiB gateway limit. For mutations, inspect existing runs before retrying.")
        while cached and cache_bytes + size > MAX_CACHE:
            key = next(iter(cached))
            old = cached.pop(key)
            cache_bytes -= old[1]
            old[0].unlink(missing_ok=True)
        response_id = str(uuid.uuid4())
        target = cache / (response_id + ".json")
        with target.open("w", encoding="utf-8") as stream:
            target.chmod(0o600)
            stream.write(raw)
        cached[response_id] = (target, size, len(raw), hashlib.sha256(raw.encode()).hexdigest())
        cache_bytes += size
        return {"providerId": policy["providerId"], "projectDir": str(project), "responseId": response_id, "bytes": size, "characters": len(raw), "sha256": cached[response_id][3], "paged": True, "nextStep": "Use domain_tool_result_read; responseId is valid only in this gateway session."}

    @asynccontextmanager
    async def lifespan(_server):
        if importlib.metadata.version("mcp") != policy["mcpVersion"]:
            raise RuntimeError("MCP Python SDK version does not match the registered lock.")
        if importlib.metadata.version(policy["package"]) != policy["version"]:
            raise RuntimeError("Provider package version does not match the registered snapshot.")
        env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "SYSTEMROOT", "WINDIR") if key in os.environ}
        env.update({"PYTHONNOUSERSITE": "1", "PYTHONUNBUFFERED": "1"})
        params = StdioServerParameters(command=policy["python"], args=["-m", policy["module"], "--project", str(project), "mcp"], cwd=policy["sourceDir"], env=env)
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=CALL_TIMEOUT)) as client:
                await client.initialize()
                page = await client.list_tools()
                declared = {tool["name"] for tool in descriptors.values()}
                if page.nextCursor or {tool.name for tool in page.tools} != declared:
                    raise RuntimeError("Live MCP tool surface differs from the registered declaration.")
                upstream = {tool.name: tool for tool in page.tools}
                identity = decode_result(await client.call_tool("get_server_info", {}))
                package_path = Path(identity["process"]["package_path"]).resolve()
                if identity["package"]["version"] != policy["version"] or not package_path.is_relative_to(Path(policy["sourceDir"]).resolve()) or Path(identity["process"]["python_executable"]).resolve() != Path(policy["python"]).resolve():
                    raise RuntimeError("Provider identity does not match the pinned runtime.")
                yield {"client": client, "upstream": upstream}

    server = FastMCP("Industrial Domain Gateway", lifespan=lifespan, instructions="Only this active Project and Broker Tool Scope are available. Discover with domain_tool_list, load a selected schema with domain_tool_describe, then domain_tool_call. Execution success is separate from engineering acceptance. Never automatically retry a timed-out mutation.", log_level="ERROR")

    @server.tool()
    def domain_tool_list() -> dict:
        """List compact canonical tool IDs available in this project and current Broker scope."""
        check_project()
        return {"providerId": policy["providerId"], "version": policy["version"], "projectDir": str(project), "domain": policy["domain"], "tools": [{"toolId": key, "summary": item["summary"], "risk": item["risk"]} for key, item in allowed.items()]}

    @server.tool()
    def domain_tool_describe(toolId: str, ctx: Context) -> dict:
        """Load the upstream description and JSON input schema for one allowed canonical tool."""
        check_project()
        item = require_tool(toolId)
        tool = ctx.request_context.lifespan_context["upstream"][item["name"]]
        schema = json.loads(json.dumps(tool.inputSchema))
        schema.get("properties", {}).pop("project_path", None)
        if "required" in schema:
            schema["required"] = [key for key in schema["required"] if key != "project_path"]
        return bounded({"toolId": toolId, "upstreamName": item["name"], "description": tool.description, "inputSchema": schema, "risk": item["risk"], "projectDir": str(project)})

    @server.tool()
    async def domain_tool_call(toolId: str, arguments: dict, ctx: Context) -> dict:
        """Invoke an allowed tool in the bound project. Mutations use the caller's MCP approval path. A timeout may have submitted work; inspect runs before retrying."""
        check_project()
        item = require_tool(toolId)
        if len(json.dumps(arguments).encode()) > MAX_ARGUMENTS:
            raise ToolError("Arguments exceed 64 KiB.")
        args = dict(arguments)
        if "project_path" in args:
            supplied = args.pop("project_path")
            if not isinstance(supplied, str) or not Path(supplied).is_absolute() or Path(supplied).resolve() != project:
                raise ToolError("Cross-project MCP call rejected.")
        state = ctx.request_context.lifespan_context
        schema = state["upstream"][item["name"]].inputSchema
        if "project_path" in schema.get("properties", {}):
            args["project_path"] = str(project)
        if item["name"] == "get_tool_guide":
            selected = args.get("tool")
            if selected is None:
                return {"gateway": "Use domain_tool_list, domain_tool_describe and domain_tool_call. Only current-scope tools can be described or invoked.", "projectDir": str(project)}
            if selected not in {entry["name"] for entry in allowed.values()}:
                raise ToolError("Requested guide is outside the current Broker scope.")
        try:
            Draft202012Validator(schema).validate(args)
        except Exception as error:
            raise ToolError("Arguments do not match the selected tool schema: " + str(error)) from error
        try:
            result = await asyncio.wait_for(state["client"].call_tool(item["name"], args), timeout=CALL_TIMEOUT)
            value = decode_result(result)
        except (asyncio.TimeoutError, TimeoutError) as error:
            raise ToolError("Provider timeout; mutation outcome may be unknown. Inspect active runs before retrying. No automatic resubmission.") from error
        return bounded({"providerId": policy["providerId"], "toolId": toolId, "projectDir": str(project), "result": value})

    @server.tool()
    def domain_tool_result_read(responseId: str, offset: int = 0, limit: int = 8000) -> dict:
        """Read a bounded character page of a large original provider response in this gateway session."""
        check_project()
        if responseId not in cached or offset < 0 or limit < 1 or limit > 8000:
            raise ToolError("Invalid or expired response page. Request a narrower provider query if needed.")
        target, size, characters, digest = cached[responseId]
        raw = target.read_text(encoding="utf-8")
        if hashlib.sha256(raw.encode()).hexdigest() != digest:
            raise ToolError("Cached response changed.")
        text = raw[offset:offset + limit]
        # Unicode can occupy four UTF-8 bytes. Keep the serialized page below MAX_OUTPUT.
        while len(json.dumps({"text": text}, ensure_ascii=False).encode()) > MAX_OUTPUT - 1024:
            text = text[:len(text) // 2]
        next_offset = offset + len(text)
        return {"responseId": responseId, "offset": offset, "nextOffset": next_offset if next_offset < characters else None, "characters": characters, "bytes": size, "sha256": digest, "text": text}

    return server


if __name__ == "__main__":
    policy_file = Path(sys.argv[1])
    if os.name != "nt" and policy_file.stat().st_mode & 0o077:
        raise RuntimeError("Gateway policy must be private to its owner.")
    policy = json.loads(policy_file.read_text(encoding="utf-8"))
    os.chdir(policy["sourceDir"])
    create_gateway(policy).run(transport="stdio")
