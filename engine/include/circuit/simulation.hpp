#pragma once

#include "circuit/circuit.hpp"

#include <optional>
#include <vector>

namespace circuit {

enum class SignalValue {
    Zero,
    One,
    Unknown,
};

enum class SimulationError {
    None,
    CombinationalLoop,
};

struct SimulationResult {
    SimulationError error{SimulationError::None};

    /**
     * 判断本次仿真求值是否成功达到稳定状态。
     * @return 没有检测到仿真错误时返回 true。
     */
    [[nodiscard]] bool succeeded() const noexcept {
        return error == SimulationError::None;
    }
};

class Simulation {
public:
    /**
     * 从一份 Circuit 创建独立的组合逻辑仿真。
     * @param circuit 要仿真的电路；Simulation 会保存自己的电路副本。
     */
    explicit Simulation(Circuit circuit);

    /**
     * 设置 Input 元件的输出值。
     * @param inputId 要设置的 Input 元件身份。
     * @param value 要写入的数字信号值。
     * @return 元件存在且确实是 Input 时返回 true，否则返回 false。
     */
    bool setInput(ComponentId inputId, SignalValue value);

    /**
     * 求值并传播组合逻辑，直到所有输出稳定。
     * @return 成功时返回 None；检测到组合逻辑环路时返回 CombinationalLoop。
     */
    [[nodiscard]] SimulationResult settle();

    /**
     * 读取指定端口当前的信号值。
     * @param portId 要读取的端口身份。
     * @return 端口存在时返回信号值；不存在时返回空值。未连接输入返回 Unknown。
     */
    [[nodiscard]] std::optional<SignalValue> signal(PortId portId) const;

private:
    struct PortSignal {
        PortId port;
        SignalValue value;
    };

    bool setOutputSignal(const PortId& portId, SignalValue value);
    [[nodiscard]] SignalValue outputSignal(const PortId& portId) const;

    Circuit circuit_;
    std::vector<PortSignal> signals_;
};

}  // namespace circuit
