#pragma once

#include "circuit/circuit.hpp"

#include <cstddef>
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
     * 在一份 Circuit 上建立仿真状态。
     * @param circuit 要仿真的电路。Simulation 只持有引用而不复制结构，结构变更因此不需要重建
     *   仿真；代价是这个 Circuit 必须比 Simulation 活得久。结构变了以后调用 `reconcile`。
     */
    explicit Simulation(const Circuit& circuit);

    /** 禁止绑定临时 Circuit：状态表会跨结构变更持续引用它，绑定一个临时值必然悬空。 */
    explicit Simulation(Circuit&& circuit) = delete;

    /**
     * 结构变更后按元件身份重新推导仿真状态。
     *
     * 仍然存在的 PortId 保留当前值，消失的端口连同它的值一起丢弃，新出现的端口按初始值建立
     * （Clock 的 `out` 为 `0`，其余输出为 `X`）；仍然存在的 DFlipFlop 保留它的 `q` 与它在
     * `clock` 端口上记录的前值，已经消失的 DFlipFlop 不再留下任何残留。已推进的步数不归零——
     * 结构变更不是重置。
     *
     * 调用方必须在修改 Circuit 之后、下一次求值之前调用它；不调用的话状态表会缺掉新元件。
     */
    void reconcile();

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
     * 把这份仿真恢复到刚创建时的状态：全部输出端口回到该元件类型的初值、Clock 回到 0、
     * 每个 DFlipFlop 的 `q` 回到 X、tick 计数归零。Circuit 结构不受影响——元件与连接的
     * 引擎身份属于 Circuit，重置只清运行时状态。
     * @note 与 `Simulation(circuit)` 等价，唯独不重新复制 Circuit；重置后调用方仍需重新
     *       提交 Input 的值并求值到稳定，因为 Input 的输出同样回到了初值 X。
     */
    void reset();

    /**
     * 返回从创建仿真以来成功推进的 tick 次数。
     * @return 当前步数；初始为 0，`reset` 之后同样归零。
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
     * 返回仍在跟踪时钟前值的 DFlipFlop 数量。
     *
     * **这是一个测试观察点，不是仿真契约的一部分。** 它不参与求值，协议层也观察不到它：
     * 表中若有已删除元件的条目，那是一条永远不可达、也永远不会释放的残留——元件身份单调
     * 递增、永不重用，残留既不会误触发上升沿，也不会被后续任何一次推进清掉，因此没有任何
     * 外部行为能区分「裁剪过」与「没裁剪过」。方法名里的 `ForTesting` 就是为了标明这一点，
     * 避免它被当成可供调用方依赖的公开读数。
     * @return `previousClockValues_` 当前的条目数。
     */
    [[nodiscard]] std::size_t trackedClockCountForTesting() const noexcept;

    /**
     * 读取指定端口当前的信号值。
     * @param portId 要读取的端口身份。
     * @return 端口存在时返回信号值；不存在时返回空值。未连接输入返回 Unknown。
     */
    [[nodiscard]] std::optional<SignalValue> signal(PortId portId) const;

private:
    bool setOutputSignal(const PortId& portId, SignalValue value);
    [[nodiscard]] SignalValue outputSignal(const PortId& portId) const;

    /** 按当前 Circuit 重建输出信号表，并把每个输出端口置为该元件类型的初值。 */
    void initializeOutputSignals();

    /** 被仿真的电路；Simulation 不拥有它，因此不能复制、不能绑定临时值。 */
    const Circuit& circuit_;
    std::vector<PortSignal> signals_;
    std::uint64_t step_{0};
    /**
     * 每个 DFlipFlop 在 clock 端口上最近一次观测到的值，即上升沿判定的前值。
     * 前值的含义是「上一 tick 求值稳定之后观测到的值」：它只在首次遇到该 DFlipFlop 时
     * 现读一次，其后由第 ④ 步在每次推进末尾写回，跨 tick 保留。驱动 clock 端口的可能是
     * Input 元件，它的电平变化发生在两次 tick 之间，每次都重新读取当前值会漏掉这类上升沿。
     * 结构变更后由 `reconcile` 裁剪掉已删除 DFlipFlop 的条目，其余原样保留。
     */
    std::vector<PortSignal> previousClockValues_;
};

}  // namespace circuit
