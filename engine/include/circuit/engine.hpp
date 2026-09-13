#pragma once

#include <string_view>

namespace circuit {

struct EngineStatus {
    std::string_view name;
    std::string_view version;
};

class Engine {
public:
    [[nodiscard]] EngineStatus status() const noexcept;
};

}  // namespace circuit
