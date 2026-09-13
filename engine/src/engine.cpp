#include "circuit/engine.hpp"

namespace circuit {

// 当前仅提供引擎身份信息；实际电路仿真能力将在后续阶段加入。
EngineStatus Engine::status() const noexcept {
    return {"CircuitPlatform C++ Engine", "0.1.0"};
}

}  // namespace circuit
