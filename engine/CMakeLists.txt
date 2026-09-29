cmake_minimum_required(VERSION 3.20)

project(CircuitPlatformEngine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# 单配置和 Visual Studio 等多配置生成器均输出到 build 根目录，供桌面开发和发布共享。
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
foreach(config DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${config} "${CMAKE_BINARY_DIR}")
endforeach()

# 发布引擎不依赖用户安装 MinGW 或 Visual C++ 运行库。
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
if (MINGW)
    add_link_options(-static -static-libgcc -static-libstdc++)
endif()

add_library(circuit_engine_core STATIC
    src/circuit.cpp
    src/engine.cpp
    src/protocol.cpp
    src/request_handler.cpp
    src/simulation.cpp
)

target_include_directories(circuit_engine_core PUBLIC include)
target_compile_definitions(circuit_engine_core PUBLIC CIRCUIT_ENGINE_VERSION="${PROJECT_VERSION}")

if (MSVC)
    target_compile_options(circuit_engine_core PRIVATE /W4 /WX)
else()
    target_compile_options(circuit_engine_core PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

add_executable(circuit-engine
    src/main.cpp
)

target_link_libraries(circuit-engine PRIVATE circuit_engine_core)

enable_testing()

add_executable(circuit_engine_tests
    tests/engine_tests.cpp
)

target_link_libraries(circuit_engine_tests PRIVATE circuit_engine_core)

add_test(NAME circuit_engine_tests COMMAND circuit_engine_tests)

add_executable(circuit_model_tests
    tests/circuit_tests.cpp
)

target_link_libraries(circuit_model_tests PRIVATE circuit_engine_core)

add_test(NAME circuit_model_tests COMMAND circuit_model_tests)

add_executable(circuit_simulation_tests
    tests/simulation_tests.cpp
)

target_link_libraries(circuit_simulation_tests PRIVATE circuit_engine_core)

add_test(NAME circuit_simulation_tests COMMAND circuit_simulation_tests)

add_executable(circuit_protocol_tests
    tests/protocol_tests.cpp
)

target_link_libraries(circuit_protocol_tests PRIVATE circuit_engine_core)

add_test(NAME circuit_protocol_tests COMMAND circuit_protocol_tests)

# 这些原生测试使用 assert 表达验收条件，Release 构建也必须真正执行断言。
foreach(test_target circuit_engine_tests circuit_model_tests circuit_simulation_tests circuit_protocol_tests)
    if (MSVC)
        target_compile_options(${test_target} PRIVATE /UNDEBUG)
    else()
        target_compile_options(${test_target} PRIVATE -UNDEBUG)
    endif()
endforeach()
