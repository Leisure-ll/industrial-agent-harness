cmake_minimum_required(VERSION 3.16)
project(harness_occt_viewer LANGUAGES CXX)
find_package(OpenCASCADE REQUIRED CONFIG)
add_executable(harness-occt Viewer.cpp)
target_include_directories(harness-occt PRIVATE ${OpenCASCADE_INCLUDE_DIR})
target_link_directories(harness-occt PRIVATE ${OpenCASCADE_LIBRARY_DIR})
target_link_libraries(harness-occt PRIVATE TKOpenGles TKV3d TKMesh TKService TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKHLR TKernel)
target_compile_options(harness-occt PRIVATE -fexceptions)
target_link_options(harness-occt PRIVATE --bind --no-entry -fexceptions
  -sDISABLE_EXCEPTION_CATCHING=0 -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createOcctViewer
  -sDYNAMIC_EXECUTION=0
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=536870912 -sINITIAL_MEMORY=33554432
  -sENVIRONMENT=web -sFILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS
  -sINVOKE_RUN=0 -sASSERTIONS=1)
