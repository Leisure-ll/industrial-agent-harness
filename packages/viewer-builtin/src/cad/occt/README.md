# Official OCCT AIS/V3d renderer

Pinned OCCT 7.9.2, Emscripten 6.0.10, single-thread WebAssembly, WebGL2.
No server, network downloads, FreeCAD process or Three.js renderer runs in the
Viewer. New Pack artifacts render exact BREP faces with shaded surfaces,
CAD face boundaries, a depth buffer and 4x MSAA. Direct STL and older generated
companions render using OCCT AIS_Triangulation.

The MIT bridge also exposes capped X/Y/Z clip planes, AIS face/edge selection,
BRepGProp length/area, analytic circle/cylinder radii and BRepExtrema minimum
distance between at most two selected subshapes. Endpoint projection supplies
read-only SVG dimension annotations. These are nominal geometry measurements,
not tolerance, assembly or engineering acceptance. STL has no precise topology
picking. The host owns CSS and device-pixel canvas sizing; Wasm_Window automatic
CSS scaling is disabled so resizing, inspectors and fullscreen stay aligned.

Memory is bounded to 512 MiB; input to 16 MiB, 100000 triangles and 5000 BREP
faces. A model is temporary read-only display data. A GPU/parse failure is
explicit and disables shared navigation. Zoom, pan and rotation are display
state and remain mounted during fullscreen changes.

To rebuild/relink, extract source/OCCT-7.9.2.tar.gz, or clone the official repo
at the revision in manifest.json, and install the pinned Emscripten toolchain,
CMake and Ninja. `node scripts/build-occt-viewer.cjs /absolute/OCCT /absolute/build`
builds the libraries and the complete MIT bridge from native/. It accepts both
the unmodified Git checkout and the included extracted archive. On Homebrew,
set `EMSDK_PYTHON=/opt/homebrew/opt/python@3.14/bin/python3.14` for build subprocesses;
other toolchains should use their bundled Python. No source changes or proprietary libraries are
required. Then run desktop build and the actual CAD Electron selftest. The
repository and desktop license resources include corresponding source, bridge
and notices. Desktop Vite builds ship the local JS/WASM assets.

For the standalone license bundle, extract `source/OCCT-7.9.2.tar.gz` into an
empty directory and run `node build-occt-viewer.cjs /absolute/extracted /absolute/build`.
Assets and refreshed hashes are written beside `native/`. You may modify OCCT
and the bridge and relink; for a modified Git checkout set
`HARNESS_OCCT_ALLOW_MODIFIED=1`. Copy the rebuilt JS/WASM back into the repository
renderer directory and rebuild the desktop. The optional third argument selects
the renderer directory containing native/ and manifest.json. Distributed assets
are pinned; user-relinked assets require their own acceptance testing.
