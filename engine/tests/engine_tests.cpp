#include "circuit/engine.hpp"

#include <cassert>

int main() {
    const circuit::Engine engine;
    const auto status = engine.status();

    assert(status.name == "CircuitPlatform C++ Engine");
    assert(status.version == "0.1.0");
    return 0;
}
