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
    /** 一个输出端口和它当前的信号值；用于读取整份输出快照。 */
    struct PortSignal {
        PortId port;
        SignalValue value;
    };

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
     * 往前推进一个 tick：翻转全部 Clock，把新的时钟电平经组合逻辑传播到稳定，
     * 并在时序元件完成采样后再求值一次。不推进 tick 计数之外的任何引擎侧状态，
     * 也不引入定时器——每一步都由调用方显式驱动。
     * @return 成功时返回 None；任一阶段求值无法稳定时返回 CombinationalLoop。
     */
    [[nodiscard]] SimulationResult tick();

    /**
     * 返回从创建仿真以来成功推进的 tick 次数。
     * @return 当前步数；初始为 0。
     */
    [[nodiscard]] std::uint64_t step() const noexcept;

    /**
     * 返回电路中全部输出端口当前的信号快照，顺序与元件创建顺序一致。
     * @return 覆盖每个输出端口的只读快照，供一次响应带回全部读数。
     */
    [[nodiscard]] const std::vector<PortSignal>& outputSignals() const noexcept;

    /**
     * 返回一次推进后可供一次往返带走的完整信号快照：全部输出端口，外加每个 Output 元件的接收端。
     * 只有输出端口不足以让调用方在一次往返内得到 Output 的读数——`Output` 的值来自它的 `in`，
     * 因此这里把它一并带上，调用方不必再按端口逐条 `get_signal`。
     * @return 覆盖输出端口与 Output 接收端的快照，顺序为先全部输出端口、再按元件顺序的接收端。
     */
    [[nodiscard]] std::vector<PortSignal> signalSnapshot() const;

    /**
     * 读取指定端口当前的信号值。
     * @param portId 要读取的端口身份。
     * @return 端口存在时返回信号值；不存在时返回空值。未连接输入返回 Unknown。
     */
    [[nodiscard]] std::optional<SignalValue> signal(PortId portId) const;

private:
    bool setOutputSignal(const PortId& portId, SignalValue value);
    [[nodiscard]] SignalValue outputSignal(const PortId& portId) const;

    Circuit circuit_;
    std::vector<PortSignal> signals_;
    std::uint64_t step_{0};
    /**
     * 每个 DFlipFlop 在 clock 端口上最近一次观测到的值，即边沿判定的前值。
     * 快照跨 tick 保留，只在上一 tick 结束时更新；驱动 clock 端口的可能是 Input 元件，
     * 它的电平变化发生在两次 tick 之间，重新读取当前值会漏掉这类边沿。
     */
    std::vector<PortSignal> previousClockValues_;
};

}  // namespace circuit
