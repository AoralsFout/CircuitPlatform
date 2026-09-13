cmake_minimum_required(VERSION 3.20)

project(CircuitPlatformEngine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(circuit_engine_core STATIC
    src/circuit.cpp
    src/engine.cpp
    src/simulation.cpp
)

target_include_directories(circuit_engine_core PUBLIC include)

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
