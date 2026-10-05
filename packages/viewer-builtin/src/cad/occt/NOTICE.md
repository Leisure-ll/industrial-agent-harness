# Open CASCADE Technology in the CAD Viewer

The CAD Viewer uses official **OCCT 7.9.2** AIS, V3d and TKOpenGles visualization,
compiled to WebAssembly with Emscripten 6.0.10. OCCT is Copyright Open CASCADE
SAS and its contributors and licensed under LGPL 2.1 with the accompanying
OCCT exception. This is the open-source OCCT visualization module.

Official source: https://github.com/Open-Cascade-SAS/OCCT/tree/c5f20409c52bf8f658314d205a0e5d6f0be0969c
The complete, unmodified corresponding source archive is distributed in
`source/OCCT-7.9.2.tar.gz`. The original Harness bridge sources and CMake project
are distributed in `native/`; rebuild/relink instructions are in README.md.
Users may modify and replace the OCCT viewer, including for debugging changes.

Viewer initialization is adapted from the official `samples/webgl` example:
Copyright (c) 2019 OPEN CASCADE SAS.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Emscripten runtime glue is Copyright the Emscripten authors, distributed under
MIT or University of Illinois/NCSA licenses; see EMSCRIPTEN-LICENSE.txt.
