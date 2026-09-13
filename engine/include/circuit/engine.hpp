#pragma once

#include <string_view>

namespace circuit {

struct EngineStatus {
    std::string_view name;
    std::string_view version;
};

class Engine {
public:
    /**
     * 返回仿真引擎的名称和版本。
     * @return 用于启动检查和诊断信息的引擎身份。
     */
    [[nodiscard]] EngineStatus status() const noexcept;
};

}  // namespace circuit
