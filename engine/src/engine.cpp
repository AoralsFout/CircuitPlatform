#include "circuit/engine.hpp"

namespace circuit {

// 发布版本取自 CMake 项目，避免安装器版本升级后健康检查仍返回旧版本。
EngineStatus Engine::status() const noexcept {
    return {"CircuitPlatform C++ Engine", CIRCUIT_ENGINE_VERSION};
}

}  // namespace circuit
