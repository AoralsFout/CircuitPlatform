#include "circuit/engine.hpp"

#include <cassert>

int main() {
    const circuit::Engine engine;
    const auto status = engine.status();

    assert(status.name == "CircuitPlatform C++ Engine");
    assert(status.version == CIRCUIT_ENGINE_VERSION);
    return 0;
}
