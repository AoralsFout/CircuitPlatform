#include "circuit/simulation.hpp"

#include <algorithm>
#include <unordered_map>
#include <utility>

namespace circuit {
namespace {

// 在仿真快照中查找元件，供输入校验和端口解析复用。
const Component* findComponent(const std::vector<Component>& components, ComponentId id) {
    const auto found = std::find_if(
        components.begin(), components.end(),
        [id](const Component& component) { return component.id == id; });
    return found == components.end() ? nullptr : &*found;
}

// 根据元件身份和端口名称解析端口；失效引用由调用者解释为未知或悬空。
const Port* findPort(const std::vector<Component>& components, const PortId& portId) {
    const auto* component = findComponent(components, portId.component);
    if (component == nullptr) {
        return nullptr;
    }

    const auto found = std::find_if(
        component->ports.begin(), component->ports.end(),
        [&portId](const Port& port) { return port.name == portId.name; });
    return found == component->ports.end() ? nullptr : &*found;
}

// 比较两个端口身份，避免把端口的字符串和所属元件比较逻辑散落在各处。
bool samePort(const PortId& left, const PortId& right) {
    return left.component == right.component && left.name == right.name;
}

// NOT 门只翻转确定的 0 和 1，未知值仍然保持未知。
SignalValue invert(SignalValue value) {
    switch (value) {
    case SignalValue::Zero:
        return SignalValue::One;
    case SignalValue::One:
        return SignalValue::Zero;
    case SignalValue::Unknown:
        return SignalValue::Unknown;
    }

    return SignalValue::Unknown;
}

// AND 的三值逻辑：0 可以确定结果，只有没有 0 且全部为 1 时结果才是 1。
SignalValue andValue(SignalValue left, SignalValue right) {
    if (left == SignalValue::Zero || right == SignalValue::Zero) {
        return SignalValue::Zero;
    }
    if (left == SignalValue::One && right == SignalValue::One) {
        return SignalValue::One;
    }
    return SignalValue::Unknown;
}

// OR 的三值逻辑：1 可以确定结果，只有没有 1 且全部为 0 时结果才是 0。
SignalValue orValue(SignalValue left, SignalValue right) {
    if (left == SignalValue::One || right == SignalValue::One) {
        return SignalValue::One;
    }
    if (left == SignalValue::Zero && right == SignalValue::Zero) {
        return SignalValue::Zero;
    }
    return SignalValue::Unknown;
}

// XOR 在任一输入未知时无法确定结果；两个确定值相异时输出 1，否则输出 0。
SignalValue xorValue(SignalValue left, SignalValue right) {
    if (left == SignalValue::Unknown || right == SignalValue::Unknown) {
        return SignalValue::Unknown;
    }
    return left == right ? SignalValue::Zero : SignalValue::One;
}

bool isCombinational(ComponentKind kind) {
    switch (kind) {
    case ComponentKind::AndGate:
    case ComponentKind::OrGate:
    case ComponentKind::NandGate:
    case ComponentKind::NorGate:
    case ComponentKind::XorGate:
    case ComponentKind::XnorGate:
    case ComponentKind::NotGate:
        return true;
    default:
        return false;
    }
}

// DFS 的访问状态用于区分尚未访问、当前路径和已经完成的组件。
enum class VisitState {
    Unvisited,
    Visiting,
    Visited,
};

// 集中分派所有二输入门，保持 settle 只负责读取输入和传播输出。
std::optional<SignalValue> evaluateBinaryGate(
    ComponentKind kind, SignalValue left, SignalValue right) {
    switch (kind) {
    case ComponentKind::AndGate:
        return andValue(left, right);
    case ComponentKind::OrGate:
        return orValue(left, right);
    case ComponentKind::NandGate:
        return invert(andValue(left, right));
    case ComponentKind::NorGate:
        return invert(orValue(left, right));
    case ComponentKind::XorGate:
        return xorValue(left, right);
    case ComponentKind::XnorGate:
        return invert(xorValue(left, right));
    default:
        return std::nullopt;
    }
}

}  // namespace

// Clock 的输出初值必须是 0：只有 0 → 1 算上升沿，从 X 起步会永远判不出第一次边沿。
SignalValue initialOutputValue(ComponentKind kind) {
    return kind == ComponentKind::Clock ? SignalValue::Zero : SignalValue::Unknown;
}

// 建立仿真快照，并把每个输出端初始化为该元件类型的初值。
Simulation::Simulation(Circuit circuit) : circuit_(std::move(circuit)) {
    for (const auto& component : circuit_.components_) {
        for (const auto& port : component.ports) {
            if (port.direction == PortDirection::Output) {
                signals_.push_back({{component.id, port.name}, initialOutputValue(component.kind)});
            }
        }
    }
}

// Input 是仿真外部的驱动源，因此只能通过元件身份修改它的输出值。
bool Simulation::setInput(ComponentId inputId, SignalValue value) {
    const auto* component = findComponent(circuit_.components_, inputId);
    if (component == nullptr || component->kind != ComponentKind::Input) {
        return false;
    }

    setOutputSignal({inputId, "out"}, value);
    return true;
}

// 反复计算 NOT 门，直到本轮没有输出变化或达到稳定化上限。
SimulationResult Simulation::settle() {
    // 先检查结构环路，再执行求值，避免把“未变化”误判为“已稳定”。
    std::unordered_map<ComponentId, VisitState> states;
    const auto visitsLoop = [&](auto&& self, ComponentId componentId) -> bool {
        auto& state = states[componentId];
        if (state == VisitState::Visiting) {
            return true;
        }
        if (state == VisitState::Visited) {
            return false;
        }

        state = VisitState::Visiting;
        for (const auto& connection : circuit_.connections_) {
            if (connection.source.component != componentId) {
                continue;
            }

            const auto* target = findComponent(circuit_.components_, connection.target.component);
            if (target != nullptr && isCombinational(target->kind) &&
                self(self, target->id)) {
                return true;
            }
        }

        state = VisitState::Visited;
        return false;
    };

    for (const auto& component : circuit_.components_) {
        if (isCombinational(component.kind) && visitsLoop(visitsLoop, component.id)) {
            return {SimulationError::CombinationalLoop};
        }
    }

    const auto iterationLimit = circuit_.components_.size() + circuit_.connections_.size() + 1;

    for (std::size_t iteration = 0; iteration < iterationLimit; ++iteration) {
        bool changed = false;

        for (const auto& component : circuit_.components_) {
            if (component.kind == ComponentKind::NotGate) {
                const auto input = signal({component.id, "in"}).value_or(SignalValue::Unknown);
                changed = setOutputSignal({component.id, "out"}, invert(input)) || changed;
            } else {
                const auto first = signal({component.id, "in1"}).value_or(SignalValue::Unknown);
                const auto second = signal({component.id, "in2"}).value_or(SignalValue::Unknown);
                const auto output = evaluateBinaryGate(component.kind, first, second);
                if (output.has_value()) {
                    changed = setOutputSignal({component.id, "out"}, *output) || changed;
                }
            }
        }

        if (!changed) {
            return {SimulationError::None};
        }
    }

    return {SimulationError::CombinationalLoop};
}

// 六步顺序本身就是语义：先记前值，再推进时钟，求值到稳定后才判边沿，判完再求值一次。
SimulationResult Simulation::tick() {
    // ① 为还没有前值的 DFlipFlop 建立快照，作为本次 tick 的前值。
    //    已经跟踪过的 DFlipFlop 保留上一 tick 记录的值而不重新读取：驱动 clock 端口的
    //    可能是 Input 元件，它的电平变化发生在两次 tick 之间，只有跨 tick 保留前值才能
    //    认出这类边沿。Phase 5.5 展平 Subcircuit 后外部时钟正是接到内部 Input 元件上。
    for (const auto& component : circuit_.components_) {
        if (component.kind != ComponentKind::DFlipFlop) {
            continue;
        }
        const PortId clockPort{component.id, "clock"};
        const auto tracked = std::any_of(
            previousClockValues_.begin(), previousClockValues_.end(),
            [&clockPort](const PortSignal& signal) { return samePort(signal.port, clockPort); });
        if (!tracked) {
            previousClockValues_.push_back({clockPort, signal(clockPort).value_or(SignalValue::Unknown)});
        }
    }

    // ② 推进每个 Clock 元件：out 在 0 与 1 之间翻转。初值是 0，因此第一次推进必然是 0 → 1。
    for (const auto& component : circuit_.components_) {
        if (component.kind != ComponentKind::Clock) {
            continue;
        }
        const PortId outPort{component.id, "out"};
        const auto next = outputSignal(outPort) == SignalValue::One ? SignalValue::Zero : SignalValue::One;
        setOutputSignal(outPort, next);
    }

    // ③ 组合求值到稳定，让新的时钟电平经组合逻辑传播到 DFlipFlop 的 clock 端口。
    if (const auto advance = settle(); !advance.succeeded()) {
        return advance;
    }

    // ④ DFlipFlop 的边沿采样：比较前值与 clock 端口的当前值。
    //    只有 0 → 1 算上升沿；1 → 0 不采样，任何一端是 X 的跳变也不采样——
    //    X → 1 无法构成可靠的上升沿，因为上一拍可能本来就是 1。
    //    判定只读端口的前后值，与元件类型无关：Clock、Input 或组合逻辑的输出都一样。
    for (auto& previous : previousClockValues_) {
        const auto current = signal(previous.port).value_or(SignalValue::Unknown);
        if (previous.value == SignalValue::Zero && current == SignalValue::One) {
            // 采样的是第 ③ 步求值稳定之后的 d：时钟可以经组合逻辑到达 clock 端口，
            // 数据同样可能经组合逻辑到达 d，两者都必须在采样那一刻处在稳定值上。
            const auto data = signal({previous.port.component, "d"}).value_or(SignalValue::Unknown);
            setOutputSignal({previous.port.component, "q"}, data);
        }

        // 记下本次 tick 观测到的值，作为下一 tick 的前值。
        previous.value = current;
    }

    // ⑤ 再次组合求值到稳定，让采样后的 q 变化传播到下游。
    if (const auto propagated = settle(); !propagated.succeeded()) {
        return propagated;
    }

    // ⑥ tick 计数自增。
    ++step_;
    return {SimulationError::None};
}

std::uint64_t Simulation::step() const noexcept {
    return step_;
}

const std::vector<Simulation::PortSignal>& Simulation::outputSignals() const noexcept {
    return signals_;
}

// 输出端口不足以描述 Output 元件的读数：它的值来自自己的接收端，接收端沿 Connection 推导。
// 把接收端一并放进快照，调用方就能在一次往返里得到全部可展示读数。
std::vector<Simulation::PortSignal> Simulation::signalSnapshot() const {
    std::vector<PortSignal> snapshot = outputSignals();
    for (const auto& component : circuit_.components_) {
        if (component.kind != ComponentKind::Output) {
            continue;
        }
        const PortId receivePort{component.id, "in"};
        snapshot.push_back({receivePort, signal(receivePort).value_or(SignalValue::Unknown)});
    }
    return snapshot;
}

// 输出端直接读取保存值；输入端沿 Connection 读取来源输出值。
std::optional<SignalValue> Simulation::signal(PortId portId) const {
    const auto* port = findPort(circuit_.components_, portId);
    if (port == nullptr) {
        return std::nullopt;
    }

    if (port->direction == PortDirection::Output) {
        return outputSignal(portId);
    }

    const auto connection = std::find_if(
        circuit_.connections_.begin(), circuit_.connections_.end(),
        [&portId](const Connection& candidate) { return samePort(candidate.target, portId); });
    if (connection == circuit_.connections_.end()) {
        return SignalValue::Unknown;
    }

    const auto* sourcePort = findPort(circuit_.components_, connection->source);
    if (sourcePort == nullptr || sourcePort->direction != PortDirection::Output) {
        return SignalValue::Unknown;
    }

    return outputSignal(connection->source);
}

// 只更新已知的输出端，并用返回值告诉稳定化循环是否发生了变化。
bool Simulation::setOutputSignal(const PortId& portId, SignalValue value) {
    const auto found = std::find_if(
        signals_.begin(), signals_.end(),
        [&portId](const PortSignal& signal) { return samePort(signal.port, portId); });
    if (found == signals_.end()) {
        return false;
    }

    if (found->value == value) {
        return false;
    }

    found->value = value;
    return true;
}

// 读取输出端的当前值；不存在的内部状态按 Unknown 处理。
SignalValue Simulation::outputSignal(const PortId& portId) const {
    const auto found = std::find_if(
        signals_.begin(), signals_.end(),
        [&portId](const PortSignal& signal) { return samePort(signal.port, portId); });
    return found == signals_.end() ? SignalValue::Unknown : found->value;
}

}  // namespace circuit
