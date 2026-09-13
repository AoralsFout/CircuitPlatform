#include "circuit/engine.hpp"

namespace circuit {

EngineStatus Engine::status() const noexcept {
    return {"CircuitPlatform C++ Engine", "0.1.0"};
}

}  // namespace circuit
